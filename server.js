#!/usr/bin/env node
/**
 * tommiao-writer 本地排版服务（零依赖）
 *
 * 职责：
 *  1. 静态托管 index.html / assets/*
 *  2. POST /api/ai-format —— 把编辑器里的 Markdown 交给本地 agent CLI（qodercli / codex），
 *     让它按 gzh-design 规则做「一键默认样式优化」，返回带扩展语法的 Markdown 回填编辑器
 *  3. GET /api/presets —— 返回 cli-config.json 里的预设列表，供页面下拉选择
 *
 * 启动：node server.js  （默认 http://localhost:8765）
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 8765;
const CONFIG_PATH = path.join(ROOT, 'cli-config.json');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

// ---------- 配置 ----------

const readConfig = () => {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch (e) {
    return { error: `读取 cli-config.json 失败：${e.message}` };
  }
};

// ---------- AI 排版提示词 ----------

// 结果用哨兵标记包裹，兼容不同 CLI 在 stdout 里混入日志的情况
const MARK_START = '<<<GZH_MD_START>>>';
const MARK_END = '<<<GZH_MD_END>>>';

const buildPrompt = (markdown, themeName) => `你是公众号排版优化助手。对下面的文章 Markdown 做「默认样式优化」，只做标记与结构优化，不改写、不增删文章的实质内容。目标主题：${themeName}。

必须执行的优化（参照 gzh-design skill 的智能处理规则）：
1. 正文关键词标记：只在承载核心观点、结论、关键数据的句子里用 ++短语++ 标记（4-15 字），宁缺毋滥——不要每段都标，普通叙述/铺垫段落不标，全文密度大致每 2-3 段 1 处。已有标记的段落不重复加。
2. 锚点强调：全文挑不超过 5 处最核心的概念/结论用 **文字** 加粗；全文不超过 3 处 ==文字== 高亮，高亮是「全文最想让读者记住的短语」。
3. 被淘汰的旧概念用 ~~文字~~（删除线）；重要概念/专名可用 [[文字]]（背景标签）。
4. 章节结构：正文小节统一用 ## 二级标题（会自动编号 01/02/…）；末章若是总结/结语类，标题建议为「写在最后」。可在标题后用 " | ENGLISH TAG" 附英文标签（如 ## 实测 | TEST）。
5. 文章有明显的开头金句时，把它独立成 "!! 金句内容" 一行（金句卡）。
6. 提示/注意/补充类内容转成容器块：
   :::tip 标题（操作建议/注意事项）/ :::info 标题（背景补充/旁注），内容行放在 ::: 与 ::: 之间。
7. 三步流程可转 :::steps（每行"标题|描述"）；三项并列对比可转 :::cols（每行"标题|描述"）；时间脉络可转 :::timeline（每行"标签|标题|内容"）。仅在内容天然匹配时才转换，不硬造。
8. 无序列表：普通并列内容用 "- " 开头（圆点弱强调）；只有需要重点突出的短要点清单才用 "* " 开头（胶囊强强调）。
9. 正文标点全角化：中文语境下的 , . ! ? : ; " " ' ' ( ) 换成 ，。！？：；""''（）；代码块/行内代码/URL/英文专名内部保持原样。
10. 若文章有 2 个以上 ## 章节且开头没有 [TOC]，在第一个 ## 之前单独一行加 [TOC]。
11. 文末没有签名区时，追加：
:::sign
{{作者名}}
{{一句话简介}}
:::
（原文已有作者签名则把签名内容填进去，不留占位。）

硬性约束：
- 保留原文全部段落、图片、代码块、链接，不得遗漏或改写实质内容。
- 不要输出任何解释。优化后的完整 Markdown 用 ${MARK_START} 和 ${MARK_END} 单独成行包裹输出。

文章 Markdown：
--------------------------------
${markdown}
--------------------------------`;

// ---------- CLI 调用 ----------

const runCli = (preset, prompt, timeoutMs) => new Promise((resolve) => {
  // 占位符替换：{promptFile} 写临时文件；模板里没有任何占位符时走 stdin
  let promptFile = null;
  let usedPlaceholder = false;
  const args = (preset.args || []).map((a) => {
    if (a.includes('{promptFile}')) {
      promptFile = path.join(os.tmpdir(), `gzh-prompt-${Date.now()}.md`);
      fs.writeFileSync(promptFile, prompt, 'utf8');
      usedPlaceholder = true;
      return a.replace('{promptFile}', promptFile);
    }
    if (a.includes('{prompt}')) {
      usedPlaceholder = true;
      return a.replace('{prompt}', prompt);
    }
    return a;
  });

  const child = spawn(preset.command, args, {
    cwd: ROOT,
    env: { ...process.env, ...(preset.env || {}) },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  let settled = false;
  const done = (result) => {
    if (settled) return;
    settled = true;
    if (promptFile) fs.unlink(promptFile, () => {});
    resolve(result);
  };

  const timer = setTimeout(() => {
    child.kill('SIGKILL');
    done({ ok: false, error: `CLI 执行超时（${Math.round(timeoutMs / 1000)}s）`, stdout, stderr });
  }, timeoutMs);

  child.stdout.on('data', (d) => { stdout += d; });
  child.stderr.on('data', (d) => { stderr += d; });
  child.on('error', (e) => {
    clearTimeout(timer);
    done({ ok: false, error: `启动 CLI 失败：${e.message}（命令：${preset.command}）`, stdout, stderr });
  });
  child.on('close', (code) => {
    clearTimeout(timer);
    if (code !== 0 && !stdout.includes(MARK_START)) {
      done({ ok: false, error: `CLI 退出码 ${code}`, stdout, stderr });
    } else {
      done({ ok: true, stdout, stderr });
    }
  });

  if (!usedPlaceholder) {
    child.stdin.write(prompt);
  }
  child.stdin.end();
});

const extractResult = (stdout) => {
  const s = stdout.indexOf(MARK_START);
  const e = stdout.lastIndexOf(MARK_END);
  if (s === -1 || e === -1 || e <= s) return null;
  return stdout.slice(s + MARK_START.length, e).trim();
};

// ---------- HTTP ----------

const json = (res, code, obj) => {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
};

const readBody = (req) => new Promise((resolve, reject) => {
  let buf = '';
  req.on('data', (d) => {
    buf += d;
    if (buf.length > 5 * 1024 * 1024) { reject(new Error('请求体过大')); req.destroy(); }
  });
  req.on('end', () => resolve(buf));
  req.on('error', reject);
});

const serveStatic = (req, res) => {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.join(ROOT, urlPath);
  // 防目录穿越
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end('Forbidden'); return; }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not Found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
};

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/api/presets') {
      const cfg = readConfig();
      if (cfg.error) return json(res, 500, { error: cfg.error });
      return json(res, 200, {
        active: cfg.active,
        presets: Object.entries(cfg.presets || {}).map(([id, p]) => ({ id, label: p.label || id })),
      });
    }

    if (req.method === 'POST' && req.url === '/api/ai-format') {
      const cfg = readConfig();
      if (cfg.error) return json(res, 500, { error: cfg.error });

      let body;
      try { body = JSON.parse(await readBody(req)); }
      catch { return json(res, 400, { error: '请求体不是合法 JSON' }); }

      const markdown = (body.markdown || '').trim();
      if (!markdown) return json(res, 400, { error: '文章内容为空' });

      const presetId = body.preset || cfg.active;
      const preset = (cfg.presets || {})[presetId];
      if (!preset) return json(res, 400, { error: `未知预设：${presetId}` });

      const prompt = buildPrompt(markdown, body.themeName || '默认主题');
      const timeoutMs = cfg.timeoutMs || 300000;
      console.log(`[ai-format] preset=${presetId} 输入 ${markdown.length} 字，调用 ${preset.command} ...`);
      const t0 = Date.now();
      const result = await runCli(preset, prompt, timeoutMs);
      const cost = ((Date.now() - t0) / 1000).toFixed(1);

      if (!result.ok) {
        console.error(`[ai-format] 失败（${cost}s）：${result.error}`);
        return json(res, 502, { error: result.error, stderr: (result.stderr || '').slice(-2000) });
      }
      const md = extractResult(result.stdout);
      if (!md) {
        console.error(`[ai-format] 输出中未找到结果标记（${cost}s）`);
        return json(res, 502, {
          error: 'CLI 输出里没有找到结果标记，可能是模型没按格式输出，可重试',
          raw: result.stdout.slice(-3000),
        });
      }
      console.log(`[ai-format] 成功（${cost}s），输出 ${md.length} 字`);
      return json(res, 200, { markdown: md, preset: presetId, seconds: Number(cost) });
    }

    if (req.method === 'GET') return serveStatic(req, res);
    res.writeHead(405);
    res.end('Method Not Allowed');
  } catch (e) {
    json(res, 500, { error: e.message });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`tommiao-writer 排版服务已启动：http://localhost:${PORT}`);
  console.log(`CLI 预设配置：${CONFIG_PATH}`);
});

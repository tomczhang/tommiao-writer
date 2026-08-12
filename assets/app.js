/**
 * 公众号排版系统 —— 应用逻辑
 *
 * 数据流（源码为准）：
 *   Markdown（扩展语法）→ parse() AST → renderWeChat(ast, theme) → 合规内联 HTML（预览 = 复制产物，含 <span leaf>）
 *
 * 扩展语法（工具条会插入这些标记）：
 *   行内：**加粗** *斜体* ==高亮== ++下划线++ ~~删除线~~ %%荧光笔%% [[标签]] `code` [文](url)
 *   块级：# ## ### > !!金句 - 1. ``` 表格 --- ![](url) [TOC]
 *         :::tip/info 标题 … :::
 *         :::steps（行=标题|描述）  :::cols（行=标题|描述）
 *         :::timeline（行=标签|标题|内容）  :::center  :::cover（键: 值） :::sign
 */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const { themes, order } = window.GZH_THEMES;
  const leaf = window.GZH_THEMES.helpers.leaf;

  const esc = (s) => s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  // ============================================================
  // 行内解析（单遍 tokenizer，不支持标记嵌套）
  // ============================================================

  const INLINE_RE = new RegExp([
    '(`[^`]+`)',                    // 1 code
    '(\\[\\[[^\\]]+\\]\\])',        // 2 [[标签]]
    '(\\[[^\\]]+\\]\\([^)]+\\))',   // 3 [文](url)
    '(==[^=]+==)',                  // 4 高亮
    '(%%[^%]+%%)',                  // 5 荧光笔
    '(\\+\\+[^+]+\\+\\+)',          // 6 下划线
    '(~~[^~]+~~)',                  // 7 删除线
    '(\\*\\*[^*]+\\*\\*)',          // 8 加粗
    '(\\*[^*\\n]+\\*)',             // 9 斜体
  ].join('|'), 'g');

  // renderers: { strong, em, highlight, underline, strike, mark, tag, code, link, plain }
  const renderInlineWith = (text, r) => {
    let out = '';
    let last = 0;
    INLINE_RE.lastIndex = 0;
    let m;
    while ((m = INLINE_RE.exec(text)) !== null) {
      if (m.index > last) out += r.plain(esc(text.slice(last, m.index)));
      const tok = m[0];
      if (m[1]) out += r.code(esc(tok.slice(1, -1)));
      else if (m[2]) out += r.tag(esc(tok.slice(2, -2)));
      else if (m[3]) {
        const lm = tok.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
        out += r.link(esc(lm[1]), esc(lm[2]));
      }
      else if (m[4]) out += r.highlight(esc(tok.slice(2, -2)));
      else if (m[5]) out += r.mark(esc(tok.slice(2, -2)));
      else if (m[6]) out += r.underline(esc(tok.slice(2, -2)));
      else if (m[7]) out += r.strike(esc(tok.slice(2, -2)));
      else if (m[8]) out += r.strong(esc(tok.slice(2, -2)));
      else if (m[9]) out += r.em(esc(tok.slice(1, -1)));
      last = INLINE_RE.lastIndex;
    }
    if (last < text.length) out += r.plain(esc(text.slice(last)));
    return out;
  };

  // 主题行内渲染（纯文本段包 <span leaf>）
  const inlineWx = (text, theme) => renderInlineWith(text, { ...theme.inline, plain: (t) => (t ? leaf(t) : '') });

  // ============================================================
  // 块级解析 → AST
  // ============================================================

  const CONTAINER_KINDS = ['tip', 'info', 'steps', 'cols', 'timeline', 'center', 'cover', 'sign'];

  const parse = (raw) => {
    const lines = raw.replace(/\r\n/g, '\n').split('\n');
    const ast = [];
    let i = 0;

    const isBlockStart = (l) =>
      /^\s*$/.test(l) || /^#{1,3}\s+/.test(l) || /^\s*>\s?/.test(l) || /^\s*!!\s+/.test(l)
      || /^\s*[-*]\s+/.test(l) || /^\s*\d+\.\s+/.test(l) || /^\s*(---|\*\*\*|___)\s*$/.test(l)
      || /^```/.test(l) || /^\s*\|/.test(l) || /^:::/.test(l) || /^\s*\[TOC\]\s*$/i.test(l)
      || /^\s*!\[[^\]]*\]\([^)]+\)\s*$/.test(l);

    while (i < lines.length) {
      const line = lines[i];
      if (/^\s*$/.test(line)) { i++; continue; }
      let m;

      // 代码围栏
      if ((m = line.match(/^```(\S*)\s*$/))) {
        const lang = m[1] || '';
        const buf = [];
        i++;
        while (i < lines.length && !/^```\s*$/.test(lines[i])) { buf.push(lines[i]); i++; }
        i++;
        ast.push({ type: 'fence', lang, lines: buf });
        continue;
      }

      // ::: 容器
      if ((m = line.match(/^:::\s*([a-zA-Z]+)\s*(.*)$/))) {
        const kind = m[1].toLowerCase();
        const title = m[2].trim();
        const buf = [];
        i++;
        while (i < lines.length && !/^:::\s*$/.test(lines[i])) { buf.push(lines[i]); i++; }
        i++;
        if (CONTAINER_KINDS.includes(kind)) ast.push({ type: kind, title, lines: buf.filter((l) => l.trim() !== '') });
        continue;
      }

      // 标题
      if ((m = line.match(/^(#{1,3})\s+(.+)$/))) {
        const level = m[1].length;
        const text = m[2].trim();
        if (level === 1) ast.push({ type: 'title', text });
        else if (level === 2) {
          const parts = text.split('|');
          ast.push({ type: 'chapter', text: parts[0].trim(), tag: (parts[1] || '').trim() });
        } else ast.push({ type: 'sub', text });
        i++; continue;
      }

      if (/^\s*\[TOC\]\s*$/i.test(line)) { ast.push({ type: 'toc' }); i++; continue; }
      if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) { ast.push({ type: 'hr' }); i++; continue; }

      // 独立成行的图片
      if ((m = line.match(/^\s*!\[([^\]]*)\]\(([^)]+)\)\s*$/))) {
        const cap = m[1].trim();
        const src = m[2].trim();
        ast.push({ type: 'image', src, caption: cap, isGif: /\.gif(\?|$)/i.test(src) || /动图/.test(cap) });
        i++; continue;
      }

      // 金句
      if ((m = line.match(/^\s*!!\s+(.+)$/))) { ast.push({ type: 'golden', text: m[1].trim() }); i++; continue; }

      // 引用
      if (/^\s*>\s?/.test(line)) {
        const buf = [];
        while (i < lines.length && /^\s*>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^\s*>\s?/, '')); i++; }
        ast.push({ type: 'quote', paras: buf });
        continue;
      }

      // 列表：- 圆点列表（弱强调），* 胶囊列表（强强调）
      if (/^\s*[-*]\s+/.test(line)) {
        const pill = /^\s*\*\s+/.test(line);
        const marker = pill ? /^\s*\*\s+/ : /^\s*-\s+/;
        const items = [];
        while (i < lines.length && marker.test(lines[i])) { items.push(lines[i].replace(marker, '')); i++; }
        ast.push({ type: 'ul', pill, items });
        continue;
      }
      if (/^\s*\d+\.\s+/.test(line)) {
        const items = [];
        while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*\d+\.\s+/, '')); i++; }
        ast.push({ type: 'ol', items });
        continue;
      }

      // 表格
      if (/^\s*\|/.test(line) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|?\s*$/.test(lines[i + 1])) {
        const parseCells = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
        const head = parseCells(line);
        i += 2;
        const rows = [];
        while (i < lines.length && /^\s*\|/.test(lines[i])) { rows.push(parseCells(lines[i])); i++; }
        ast.push({ type: 'table', head, rows });
        continue;
      }

      // 段落（连续非空且非块起始行合并）
      const buf = [line];
      i++;
      while (i < lines.length && !isBlockStart(lines[i])) { buf.push(lines[i]); i++; }
      ast.push({ type: 'p', linesArr: buf });
    }

    // 元信息：标题 + 章节编号
    const meta = { title: '', chapters: [] };
    const titleNode = ast.find((n) => n.type === 'title');
    if (titleNode) meta.title = titleNode.text.replace(/[*=+~%[\]`_]/g, '');
    const chapters = ast.filter((n) => n.type === 'chapter');
    chapters.forEach((c, idx) => {
      c.index = idx;
      c.isLast = idx === chapters.length - 1 && /写在最后|总结|结语|尾声|最后的话/.test(c.text);
      c.num = c.isLast ? '///' : String(idx + 1).padStart(2, '0');
      if (!c.tag) c.tag = autoTag(c.text);
      meta.chapters.push(c);
    });
    return { ast, meta };
  };

  // 英文标签保持短单词，避免在目录卡（110px）里折行
  const TAG_MAP = [
    [/实测|测评|体验/, 'TEST'], [/教程|上手|怎么|如何/, 'TUTORIAL'],
    [/写在最后|总结|结语|尾声/, 'FINAL'], [/思考|反思|感悟/, 'THOUGHTS'],
    [/工具|清单|盘点/, 'TOOLBOX'], [/方法|方法论|技巧/, 'METHOD'],
    [/背景|起因|缘起/, 'CONTEXT'], [/案例|实战|实践/, 'CASE'],
    [/数据|复盘|回顾/, 'REVIEW'], [/踩坑|避坑|坑/, 'PITFALLS'],
    [/原理|本质|逻辑/, 'INSIGHT'], [/观点|看法/, 'OPINION'],
  ];
  const autoTag = (text) => {
    for (const [re, tag] of TAG_MAP) if (re.test(text)) return tag;
    return 'CHAPTER';
  };

  const parsePipeItems = (linesArr, n) => linesArr
    .filter((l) => !/^\s*>/.test(l))
    .map((l) => {
      const parts = l.split('|').map((s) => s.trim());
      if (n === 3) return { tag: parts[0] || '', title: parts[1] || '', body: parts[2] || '' };
      return { t: parts[0] || '', d: parts[1] || '' };
    });
  const parseNote = (linesArr) => {
    const noteLine = linesArr.find((l) => /^\s*>/.test(l));
    return noteLine ? noteLine.replace(/^\s*>\s?/, '') : '';
  };
  const parseKv = (linesArr) => {
    const kv = {};
    linesArr.forEach((l) => {
      const mm = l.match(/^\s*([^:：]+)[:：]\s*(.*)$/);
      if (mm) kv[mm[1].trim()] = mm[2].trim();
    });
    return kv;
  };

  // ============================================================
  // 渲染：公众号合规 HTML
  // ============================================================

  const FLOW_TYPES = ['p', 'quote', 'golden', 'center', 'ul', 'ol', 'fence', 'table', 'image',
    'tip', 'info', 'steps', 'cols', 'timeline'];

  const renderWeChat = (parsed, theme) => {
    const { ast, meta } = parsed;
    const B = theme.blocks;
    const inl = (t) => inlineWx(t, theme);
    const paras = (arr) => arr.map(inl);
    const out = [];

    for (const node of ast) {
      let html = '';
      switch (node.type) {
        // title 不进正文：公众号文章标题在平台单独设置，# 只供预览头部/封面/贴图用
        case 'chapter': html = B.chapter({ num: node.num, tag: node.tag, title: inl(node.text), isLast: node.isLast, first: node.index === 0 }); break;
        case 'sub': html = B.sub(inl(node.text)); break;
        case 'p': html = B.p(node.linesArr.map(inl).join('<br>')); break;
        case 'quote': html = B.quote(paras(node.paras)); break;
        case 'golden': html = B.golden(inl(node.text)); break;
        case 'center': html = B.center(node.lines.map(inl).join('<br>')); break;
        case 'ul': html = node.pill ? B.ulPill(node.items.map(inl)) : B.ul(node.items.map(inl)); break;
        case 'ol': html = B.ol(node.items.map(inl)); break;
        case 'fence': html = B.fence({ lang: esc(node.lang), lines: node.lines.map((l) => esc(l).replace(/^( +)/, (s) => '　'.repeat(Math.ceil(s.length / 2)))) }); break;
        case 'table': {
          // 单元格内的 <br> 转真换行（先按 <br> 切开再分段行内渲染，避免被转义成文字）
          const cell = (c) => c.split(/<br\s*\/?>/i).map(inl).join('<br>');
          html = B.table({ head: node.head.map(cell), rows: node.rows.map((r) => r.map(cell)) });
          break;
        }
        case 'hr': html = B.hr(); break;
        case 'image': html = B.image({ src: esc(node.src), caption: node.caption, isGif: node.isGif }); break;
        case 'tip': case 'info':
          html = B[node.type]({ title: node.title, paras: paras(node.lines) }); break;
        case 'steps': html = B.steps({ items: parsePipeItems(node.lines, 2), note: parseNote(node.lines) }); break;
        case 'cols': html = B.cols({ items: parsePipeItems(node.lines, 2) }); break;
        case 'timeline': {
          const items = parsePipeItems(node.lines, 3).map((it) => ({ ...it, body: inl(it.body) }));
          html = B.timeline({ items });
          break;
        }
        case 'toc': {
          if (!meta.chapters.length) break;
          const items = meta.chapters.map((c) => ({ num: c.num, title: c.text, sub: c.tag }));
          html = B.toc({ items });
          break;
        }
        case 'cover': {
          const kv = parseKv(node.lines);
          const d = new Date();
          html = B.cover({
            label: kv['标签'] || kv.label || 'FEATURE',
            date: kv['日期'] || kv.date || `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}`,
            old: kv['旧认知'] || kv.old || '',
            line1: kv['标题'] || kv.title || meta.title || '未命名文章',
            green: kv['高亮词'] || kv.green || '',
            line2: kv['标题2'] || kv.line2 || '',
            sub: kv['副标题'] || kv.sub || '',
            brand: kv['品牌'] || kv.brand || '',
            tags: (kv['标签组'] || kv.tags || '').split(/[,，]/).map((s) => s.trim()).filter(Boolean),
          });
          break;
        }
        case 'sign': {
          const ls = node.lines;
          html = B.sign({ name: ls[0] || '{{作者名}}', bio: (ls[1] || '{{一句话简介}}').replace(/。$/, '') });
          break;
        }
      }
      if (!html) continue;
      out.push(FLOW_TYPES.includes(node.type) ? theme.wrapFlow(html) : html);
    }
    return theme.container(out.join('\n'));
  };

  // ============================================================
  // 半角标点检测与修复（中文语境；跳过代码）
  // ============================================================

  const CJK = /[\u4e00-\u9fff\u3400-\u4dbf。，！？：；、""''（）]/;
  const PUNCT_MAP = { ',': '，', '.': '。', '!': '！', '?': '？', ':': '：', ';': '；', '(': '（', ')': '）' };

  // 把一行按行内代码切开，只对非代码片段执行 fn
  const mapOutsideCode = (line, fn) =>
    line.split(/(`[^`]*`)/).map((seg) => (seg.startsWith('`') ? seg : fn(seg))).join('');

  const walkTextLines = (raw, fn) => {
    const lines = raw.split('\n');
    let inFence = false;
    return lines.map((line) => {
      if (/^```/.test(line)) { inFence = !inFence; return line; }
      if (inFence) return line;
      return fn(line);
    }).join('\n');
  };

  const countHalfPunct = (raw) => {
    let count = 0;
    walkTextLines(raw, (line) => {
      mapOutsideCode(line, (seg) => {
        if (/https?:\/\//.test(seg)) return seg;
        for (let k = 1; k < seg.length; k++) {
          if (PUNCT_MAP[seg[k]] && CJK.test(seg[k - 1])) count++;
          if ((seg[k] === '"' || seg[k] === "'") && (CJK.test(seg[k - 1] || '') || CJK.test(seg[k + 1] || ''))) count++;
        }
        return seg;
      });
      return line;
    });
    return count;
  };

  const fixHalfPunct = (raw) => {
    let dq = 0, sq = 0;
    return walkTextLines(raw, (line) => mapOutsideCode(line, (seg) => {
      if (/https?:\/\//.test(seg)) return seg;
      let res = '';
      for (let k = 0; k < seg.length; k++) {
        const ch = seg[k];
        const prev = seg[k - 1] || '';
        const next = seg[k + 1] || '';
        if (PUNCT_MAP[ch] && CJK.test(prev)) {
          // 小数/序号（3.14、1.）不转
          if (ch === '.' && /\d/.test(next)) { res += ch; continue; }
          res += PUNCT_MAP[ch]; continue;
        }
        if (ch === '"' && (CJK.test(prev) || CJK.test(next))) { res += (dq++ % 2 === 0 ? '“' : '”'); continue; }
        if (ch === "'" && (CJK.test(prev) || CJK.test(next))) { res += (sq++ % 2 === 0 ? '‘' : '’'); continue; }
        res += ch;
      }
      return res;
    }));
  };

  // ============================================================
  // UI 状态与主流程
  // ============================================================

  const input = $('input');
  const preview = $('preview');
  const charCount = $('char-count');
  const punctBtn = $('btn-punct');
  const toast = $('toast');

  let currentTheme = localStorage.getItem('gzh-theme') || order[0];
  if (!themes[currentTheme]) currentTheme = order[0];
  let parsed = { ast: [], meta: { title: '', chapters: [] } };

  const showToast = (msg) => {
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => toast.classList.remove('show'), 2000);
  };

  const update = () => {
    const text = input.value;
    parsed = parse(text);
    preview.innerHTML = renderWeChat(parsed, themes[currentTheme]);
    charCount.textContent = `正文约 ${[...preview.innerText.replace(/\s/g, '')].length} 字`;
    const n = countHalfPunct(text);
    punctBtn.textContent = n > 0 ? `半角标点 ${n} 处，点我修复` : '标点 ✓';
    punctBtn.classList.toggle('warn', n > 0);
    const t = parsed.meta.title || '公众号文章';
    $('phone-title').textContent = t.length > 14 ? t.slice(0, 14) + '...' : t;
    localStorage.setItem('gzh-draft', text);
  };

  // ---------- 编辑历史（Ctrl/Cmd+Z 撤销，Shift+Z 或 Ctrl+Y 重做） ----------
  // textarea 的原生撤销会被程序化赋值打断，这里自建快照栈：
  // 输入停顿 400ms 落一次快照；工具条插入/AI 排版/标点修复等程序化改动即时落盘
  const history = { stack: [{ v: '', s: 0 }], idx: 0 };
  let typeTimer = null;
  const commitHistory = () => {
    clearTimeout(typeTimer);
    const v = input.value;
    if (history.stack[history.idx] && history.stack[history.idx].v === v) return;
    history.stack.length = history.idx + 1; // 丢弃重做分支
    history.stack.push({ v, s: input.selectionStart });
    if (history.stack.length > 100) history.stack.shift();
    history.idx = history.stack.length - 1;
  };
  const applyHistory = () => {
    const snap = history.stack[history.idx];
    input.value = snap.v;
    input.focus();
    input.setSelectionRange(snap.s, snap.s);
    update();
  };
  const undoEdit = () => { commitHistory(); if (history.idx > 0) { history.idx--; applyHistory(); } };
  const redoEdit = () => { if (history.idx < history.stack.length - 1) { history.idx++; applyHistory(); } };

  // ---------- 主题切换 ----------
  const themeBar = $('theme-bar');
  const renderThemeBar = () => {
    themeBar.innerHTML = '';
    order.forEach((id) => {
      const th = themes[id];
      const btn = document.createElement('button');
      btn.className = 'theme-chip' + (id === currentTheme ? ' active' : '');
      btn.innerHTML = `<span class="dot" style="background:${th.uiColor}"></span>${th.name}`;
      btn.addEventListener('click', () => {
        currentTheme = id;
        localStorage.setItem('gzh-theme', id);
        renderThemeBar();
        update();
      });
      themeBar.appendChild(btn);
    });
  };

  // ---------- 编辑器工具条 ----------

  const wrapSelection = (before, after) => {
    commitHistory(); // 先落盘未提交的输入
    const s = input.selectionStart;
    const e = input.selectionEnd;
    const sel = input.value.slice(s, e) || '文字';
    input.value = input.value.slice(0, s) + before + sel + after + input.value.slice(e);
    input.focus();
    input.setSelectionRange(s + before.length, s + before.length + sel.length);
    update();
    commitHistory();
  };

  const insertBlock = (tpl) => {
    commitHistory();
    const s = input.selectionStart;
    const before = input.value.slice(0, s);
    const prefix = before === '' || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
    const text = prefix + tpl + '\n';
    input.value = before + text + input.value.slice(input.selectionEnd);
    input.focus();
    const pos = s + text.length;
    input.setSelectionRange(pos, pos);
    update();
    commitHistory();
  };

  const INLINE_TOOLS = [
    ['加粗', '主色加粗（核心概念，全文 ≤5 处）', '**', '**'],
    ['高亮', '渐变高亮（每段 ≤2 处）', '==', '=='],
    ['下划线', '主色下划线（正文关键词默认标记）', '++', '++'],
    ['荧光笔', '黄底荧光笔（重点句）', '%%', '%%'],
    ['标签', '背景标签（概念/专名）', '[[', ']]'],
    ['删除线', '删除线（被淘汰的旧概念）', '~~', '~~'],
    ['行内代码', '行内代码（命令/标识符）', '`', '`'],
  ];

  const BLOCK_TOOLS = [
    ['金句', '!! 这里是核心金句'],
    ['引用', '> 引用内容'],
    ['提示', ':::tip 提示标题\n提示内容\n:::'],
    ['信息', ':::info 补充信息\n信息内容\n:::'],
    ['流程', ':::steps\n第一步|描述\n第二步|描述\n第三步|描述\n> 底部说明（可删）\n:::'],
    ['三列', ':::cols\n方案A|描述\n方案B|描述\n方案C|描述\n:::'],
    ['时间线', ':::timeline\nCASE 01|标题一|内容一\nCASE 02|标题二|内容二\n:::'],
    ['居中金句', ':::center\n居中金句一行\n:::'],
    ['代码块', '```bash\n命令或代码\n```'],
    ['表格', '| 列1 | 列2 | 列3 |\n| --- | --- | --- |\n| 内容 | 内容 | 内容 |'],
    ['图片', '![图片说明](图片URL)'],
    ['目录', '[TOC]'],
    ['封面', ':::cover\n标签：FEATURE\n旧认知：被颠覆的旧观念\n标题：主标题前半\n高亮词：强调词\n标题2：第二行（可删）\n副标题：关键词 · 用点分隔\n品牌：汤姆喵的奇妙旅行\n:::'],
    ['签名', ':::sign\n汤姆喵\n一个重度 AI 使用者的真实观察\n:::'],
  ];

  // ---------- 工具条悬浮样式预览 ----------

  const stylePop = document.createElement('div');
  stylePop.className = 'style-pop';
  document.body.appendChild(stylePop);
  let popTimer = null;
  const popCache = {};

  // 图片预览用的占位图（data URI，不依赖网络）
  const PREVIEW_IMG = "data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='320' height='110'%3E%3Crect width='100%25' height='100%25' fill='%23E5E7EB'/%3E%3C/svg%3E";

  // 个别块组件的插入模板不能直接独立渲染，用专门的预览源码
  const BLOCK_PREVIEW = {
    '目录': { md: '[TOC]\n\n## 先说结论 | OPINION\n\n## 实测过程 | TEST\n\n## 写在最后 | FINAL', pickFirst: true },
    '图片': { md: `![示例图片说明](${PREVIEW_IMG})` },
  };

  const previewHtml = (md, pickFirst) => {
    const html = renderWeChat(parse(md), themes[currentTheme]);
    if (!pickFirst) return html;
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    const cont = tmp.firstElementChild;
    while (cont && cont.children.length > 1) cont.removeChild(cont.lastElementChild);
    return tmp.innerHTML;
  };

  const showPop = (btn, key, mdFactory, pickFirst) => {
    clearTimeout(popTimer);
    popTimer = setTimeout(() => {
      const cacheKey = currentTheme + ':' + key;
      if (!popCache[cacheKey]) {
        popCache[cacheKey] = `<p class="pop-label">样式预览 · ${themes[currentTheme].name}</p>` + previewHtml(mdFactory(), pickFirst);
      }
      stylePop.innerHTML = popCache[cacheKey];
      stylePop.classList.add('show');
      const r = btn.getBoundingClientRect();
      const w = stylePop.offsetWidth;
      stylePop.style.left = Math.min(Math.max(8, r.left), window.innerWidth - w - 8) + 'px';
      stylePop.style.top = (r.bottom + 8) + 'px';
      // 底部放不下就翻到按钮上方
      const h = stylePop.offsetHeight;
      if (r.bottom + 8 + h > window.innerHeight - 8) {
        stylePop.style.top = Math.max(8, r.top - h - 8) + 'px';
      }
    }, 200);
  };
  const hidePop = () => { clearTimeout(popTimer); stylePop.classList.remove('show'); };

  const buildToolbar = () => {
    const inlineBar = $('toolbar-inline');
    INLINE_TOOLS.forEach(([label, tip, b, a]) => {
      const btn = document.createElement('button');
      btn.className = 'tool';
      btn.textContent = label;
      btn.title = tip + `　${b}文字${a}`;
      btn.addEventListener('mousedown', (e) => e.preventDefault()); // 保住 textarea 选区
      btn.addEventListener('click', () => { hidePop(); wrapSelection(b, a); });
      btn.addEventListener('mouseenter', () => showPop(btn, 'i:' + label,
        () => `这段正文里，${b}这几个字${a}是当前样式的效果，其余是普通正文。`));
      btn.addEventListener('mouseleave', hidePop);
      inlineBar.appendChild(btn);
    });
    const blockBar = $('toolbar-block');
    BLOCK_TOOLS.forEach(([label, tpl]) => {
      const btn = document.createElement('button');
      btn.className = 'tool';
      btn.textContent = label;
      btn.title = tpl.split('\n')[0];
      btn.addEventListener('mousedown', (e) => e.preventDefault());
      btn.addEventListener('click', () => { hidePop(); insertBlock(tpl); });
      const pv = BLOCK_PREVIEW[label];
      btn.addEventListener('mouseenter', () => showPop(btn, 'b:' + label, () => (pv ? pv.md : tpl), pv && pv.pickFirst));
      btn.addEventListener('mouseleave', hidePop);
      blockBar.appendChild(btn);
    });
  };

  // ---------- 复制到公众号 ----------

  const copyRich = async () => {
    const html = preview.innerHTML;
    const plain = preview.innerText;
    try {
      if (navigator.clipboard && window.ClipboardItem) {
        await navigator.clipboard.write([
          new ClipboardItem({
            'text/html': new Blob([html], { type: 'text/html' }),
            'text/plain': new Blob([plain], { type: 'text/plain' }),
          }),
        ]);
      } else {
        const range = document.createRange();
        range.selectNodeContents(preview);
        const sel = window.getSelection();
        sel.removeAllRanges(); sel.addRange(range);
        document.execCommand('copy');
        sel.removeAllRanges();
      }
      const n = countHalfPunct(input.value);
      showToast(n > 0 ? `已复制（注意：还有 ${n} 处半角标点建议修复）` : '已复制，去公众号编辑器粘贴吧');
    } catch (e) {
      showToast('复制失败：' + e.message);
    }
  };

  const copyText = async (text) => {
    try { await navigator.clipboard.writeText(text); return true; }
    catch {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.left = '-9999px';
      document.body.appendChild(ta); ta.select();
      const ok = document.execCommand('copy'); ta.remove();
      return ok;
    }
  };

  // ---------- AI 一键排版 ----------

  const aiBtn = $('btn-ai');
  const aiPresetSel = $('ai-preset');
  const aiUndoBtn = $('btn-ai-undo');
  let aiBackup = null;
  let serverOnline = false;

  const initAi = async () => {
    try {
      const res = await fetch('/api/presets');
      if (!res.ok) throw new Error();
      const data = await res.json();
      serverOnline = true;
      aiPresetSel.innerHTML = '';
      data.presets.forEach((p) => {
        const opt = document.createElement('option');
        opt.value = p.id; opt.textContent = p.label;
        if (p.id === data.active) opt.selected = true;
        aiPresetSel.appendChild(opt);
      });
    } catch {
      serverOnline = false;
      aiPresetSel.style.display = 'none';
      aiBtn.textContent = '复制 AI 排版指令';
      aiBtn.title = '未检测到本地服务（node server.js）。点击复制排版指令，粘到任意 agent 对话执行后把结果贴回来。';
    }
  };

  const AI_FALLBACK_PROMPT = (md) => `请对下面的公众号文章 Markdown 做排版标记优化（不改写内容）：只在承载核心观点/结论/关键数据的句子里标 ++关键词++（宁缺毋滥，不要每段都标，全文大致每 2-3 段 1 处）；全文 ≤5 处 **加粗**；全文 ≤3 处 ==高亮==；提示类内容转 :::tip 块，补充信息转 :::info 块；中文语境标点全角化（代码/URL 除外）；2 个以上 ## 章节时开头加 [TOC]；文末补 :::sign 签名块。直接返回优化后的完整 Markdown，不要解释。\n\n${md}`;

  const runAi = async () => {
    const md = input.value.trim();
    if (!md) { showToast('先写点内容再排版'); return; }
    if (!serverOnline) {
      const ok = await copyText(AI_FALLBACK_PROMPT(md));
      showToast(ok ? '已复制指令，粘到 agent 对话里执行' : '复制失败');
      return;
    }
    aiBtn.disabled = true;
    const orig = aiBtn.textContent;
    aiBtn.textContent = 'AI 排版中…（约 1-3 分钟）';
    try {
      const res = await fetch('/api/ai-format', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          markdown: md,
          preset: aiPresetSel.value,
          themeName: themes[currentTheme].name,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
      aiBackup = md;
      input.value = data.markdown;
      update();
      commitHistory();
      aiUndoBtn.style.display = '';
      showToast(`AI 排版完成（${data.seconds}s），不满意可点「还原」`);
    } catch (e) {
      showToast('AI 排版失败：' + e.message);
    } finally {
      aiBtn.disabled = false;
      aiBtn.textContent = orig;
    }
  };

  const undoAi = () => {
    if (aiBackup === null) return;
    input.value = aiBackup;
    aiBackup = null;
    aiUndoBtn.style.display = 'none';
    update();
    commitHistory();
    showToast('已还原到 AI 排版前');
  };

  // ---------- 示例 ----------

  const SAMPLE = `# 这是一篇示例文章

:::cover
标签：HANDS-ON · 实战
旧认知：排版只能手动调？
标题：把“排版”变成
高亮词：一键的事
标题2：手动微调照样不耽误
副标题：双主题 · AI 一键 · 合规校验
品牌：汤姆喵的奇妙旅行
标签组：TOOL, AI
:::

[TOC]

!! 开头金句：真正的效率不是快，而是不用返工

这是第一段正文。**核心概念**用主色加粗，++关键短语++用主色下划线标记，还可以用 ==渐变高亮== 强调一段里最重要的话。~~过时的旧概念~~用删除线，[[新概念]]可以打个标签，行内命令写成 \`npm install\`。

## 先说结论 | OPINION

> 引用块用来放原文摘录或补充说明。

:::tip 一个正面提示
提示块适合放操作建议，标题可以自定义。
:::

:::info 补充信息
信息块适合放背景补充和旁注。
:::

## 实测过程

:::steps
装环境|一条命令搞定
跑起来|本地起服务
验证|贴到公众号看效果
> 三步走完，全程十分钟
:::

\`\`\`bash
node server.js
# 打开 http://localhost:8765
\`\`\`

1. 有序列表第一条
2. 有序列表第二条

- 圆点列表（弱强调，++关键词++照样可标）
- 第二条

* 胶囊列表（强强调，适合并列要点）
* 第二条

| 方案 | 成本 | 效果 |
| --- | --- | --- |
| 手动排版 | 高 | 可控 |
| AI 一键 | 低 | 稳定 |

## 写在最后

:::center
样式是给内容让路的
:::

最后一段正文，说完收工。

:::sign
汤姆喵
一个重度 AI 使用者的真实观察
:::`;

  // ---------- 事件绑定 ----------

  $('btn-sample').addEventListener('click', () => { commitHistory(); input.value = SAMPLE; update(); commitHistory(); });
  $('btn-clear').addEventListener('click', () => { commitHistory(); input.value = ''; update(); commitHistory(); input.focus(); });
  $('btn-copy').addEventListener('click', copyRich);
  punctBtn.addEventListener('click', () => {
    if (!countHalfPunct(input.value)) { showToast('没有需要修复的半角标点'); return; }
    commitHistory();
    input.value = fixHalfPunct(input.value);
    update();
    commitHistory();
    showToast('已把中文语境的半角标点转为全角');
  });
  aiBtn.addEventListener('click', runAi);
  aiUndoBtn.addEventListener('click', undoAi);
  input.addEventListener('input', () => {
    update();
    clearTimeout(typeTimer);
    typeTimer = setTimeout(commitHistory, 400);
  });
  input.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) redoEdit(); else undoEdit();
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      redoEdit();
    }
  });

  // ---------- 左右分栏宽度拖拽 ----------
  const splitHandle = $('split-handle');
  const mainEl = document.querySelector('main');
  const savedSplit = localStorage.getItem('gzh-split');
  if (savedSplit) mainEl.style.setProperty('--split', savedSplit);
  let splitDragging = false;
  splitHandle.addEventListener('mousedown', (e) => {
    splitDragging = true;
    splitHandle.classList.add('dragging');
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
    e.preventDefault();
  });
  window.addEventListener('mousemove', (e) => {
    if (!splitDragging) return;
    const rect = mainEl.getBoundingClientRect();
    const pct = Math.min(75, Math.max(25, ((e.clientX - rect.left) / rect.width) * 100));
    mainEl.style.setProperty('--split', pct.toFixed(1) + '%');
  });
  window.addEventListener('mouseup', () => {
    if (!splitDragging) return;
    splitDragging = false;
    splitHandle.classList.remove('dragging');
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
    localStorage.setItem('gzh-split', mainEl.style.getPropertyValue('--split'));
  });

  // ---------- 时钟 ----------
  const tickClock = () => {
    const d = new Date();
    const s = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    $('phone-time').textContent = s;
    $('phone-time-bar').textContent = s;
  };
  tickClock();
  setInterval(tickClock, 30 * 1000);

  // ---------- 启动 ----------
  renderThemeBar();
  buildToolbar();
  const draft = localStorage.getItem('gzh-draft');
  if (draft) input.value = draft;
  update();
  history.stack = [{ v: input.value, s: input.value.length }];
  history.idx = 0;
  initAi();
})();

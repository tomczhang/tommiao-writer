/**
 * 公众号排版系统 —— 应用逻辑
 *
 * 数据流（源码为准）：
 *   Markdown（扩展语法）→ parse() AST
 *     ├─ renderWeChat(ast, theme) → 合规内联 HTML（预览 = 复制产物，含 <span leaf>）
 *     └─ renderSemantic(ast)     → 语义 HTML（仅供小红书贴图分页渲染）
 *
 * 扩展语法（工具条会插入这些标记）：
 *   行内：**加粗** *斜体* ==高亮== ++下划线++ __红线__ ~~删除线~~ %%荧光笔%% [[标签]] `code` [文](url)
 *   块级：# ## ### > !!金句 - 1. ``` 表格 --- ![](url) [TOC]
 *         :::tip/warn/danger/info 标题 … :::
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
    '(__[^_]+__)',                  // 7 红线
    '(~~[^~]+~~)',                  // 8 删除线
    '(\\*\\*[^*]+\\*\\*)',          // 9 加粗
    '(\\*[^*\\n]+\\*)',             // 10 斜体
  ].join('|'), 'g');

  // renderers: { strong, em, highlight, underline, redline, strike, mark, tag, code, link, plain }
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
      else if (m[7]) out += r.redline(esc(tok.slice(2, -2)));
      else if (m[8]) out += r.strike(esc(tok.slice(2, -2)));
      else if (m[9]) out += r.strong(esc(tok.slice(2, -2)));
      else if (m[10]) out += r.em(esc(tok.slice(1, -1)));
      last = INLINE_RE.lastIndex;
    }
    if (last < text.length) out += r.plain(esc(text.slice(last)));
    return out;
  };

  // 主题行内渲染（纯文本段包 <span leaf>）
  const inlineWx = (text, theme) => renderInlineWith(text, { ...theme.inline, plain: (t) => (t ? leaf(t) : '') });

  // 语义行内渲染（贴图分页用，走 class 样式）
  const SEM_INLINE = {
    plain: (t) => t,
    strong: (t) => `<strong>${t}</strong>`,
    em: (t) => `<em>${t}</em>`,
    highlight: (t) => `<span class="wx-highlight">${t}</span>`,
    mark: (t) => `<span class="wx-highlight">${t}</span>`,
    underline: (t) => `<span class="wx-underline">${t}</span>`,
    redline: (t) => `<span class="wx-underline">${t}</span>`,
    strike: (t) => `<del>${t}</del>`,
    tag: (t) => `<strong>${t}</strong>`,
    code: (t) => `<code>${t}</code>`,
    link: (t, url) => `<a href="${url}">${t}</a>`,
  };
  const inlineSem = (text) => renderInlineWith(text, SEM_INLINE);

  // ============================================================
  // 块级解析 → AST
  // ============================================================

  const CONTAINER_KINDS = ['tip', 'warn', 'danger', 'info', 'steps', 'cols', 'timeline', 'center', 'cover', 'sign'];

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

      // 列表
      if (/^\s*[-*]\s+/.test(line)) {
        const items = [];
        while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*[-*]\s+/, '')); i++; }
        ast.push({ type: 'ul', items });
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
      if (!c.tag) c.tag = autoTag(c.text, c.num);
      meta.chapters.push(c);
    });
    return { ast, meta };
  };

  const TAG_MAP = [
    [/实测|测评|体验/, 'HANDS-ON TEST'], [/教程|上手|怎么|如何/, 'TUTORIAL'],
    [/写在最后|总结|结语|尾声/, 'FINAL THOUGHTS'], [/思考|反思|感悟/, 'THOUGHTS'],
    [/工具|清单|盘点/, 'TOOLBOX'], [/方法|方法论|技巧/, 'METHODOLOGY'],
    [/背景|起因|缘起/, 'BACKGROUND'], [/案例|实战|实践/, 'CASE STUDY'],
    [/数据|复盘|回顾/, 'REVIEW'], [/踩坑|避坑|坑/, 'PITFALLS'],
    [/原理|本质|逻辑/, 'DEEP DIVE'], [/观点|看法/, 'OPINION'],
  ];
  const autoTag = (text, num) => {
    for (const [re, tag] of TAG_MAP) if (re.test(text)) return tag;
    return 'CHAPTER ' + num;
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
    'tip', 'warn', 'danger', 'info', 'steps', 'cols', 'timeline'];

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
        case 'ul': html = B.ul(node.items.map(inl)); break;
        case 'ol': html = B.ol(node.items.map(inl)); break;
        case 'fence': html = B.fence({ lang: esc(node.lang), lines: node.lines.map((l) => esc(l).replace(/^( +)/, (s) => '　'.repeat(Math.ceil(s.length / 2)))) }); break;
        case 'table': html = B.table({ head: node.head.map(inl), rows: node.rows.map((r) => r.map(inl)) }); break;
        case 'hr': html = B.hr(); break;
        case 'image': html = B.image({ src: esc(node.src), caption: node.caption, isGif: node.isGif }); break;
        case 'tip': case 'warn': case 'danger': case 'info':
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
          let items = meta.chapters.map((c) => ({ num: c.num, title: c.text, sub: c.tag }));
          if (items.length > 4) items = items.slice(0, 3).concat(items[items.length - 1]);
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
  // 渲染：语义 HTML（小红书贴图分页用）
  // ============================================================

  const renderSemantic = (parsed) => {
    const out = [];
    const inl = inlineSem;
    for (const node of parsed.ast) {
      switch (node.type) {
        case 'title': out.push(`<h1>${inl(node.text)}</h1>`); break;
        case 'chapter': out.push(`<h2>${node.num !== '///' ? node.num + ' · ' : ''}${inl(node.text)}</h2>`); break;
        case 'sub': out.push(`<h3>${inl(node.text)}</h3>`); break;
        case 'p': out.push(`<p>${node.linesArr.map(inl).join('<br/>')}</p>`); break;
        case 'quote': out.push(`<blockquote>${node.paras.map((t) => `<p>${inl(t)}</p>`).join('')}</blockquote>`); break;
        case 'golden': out.push(`<p class="wx-quote">${inl(node.text)}</p>`); break;
        case 'center': out.push(`<p class="wx-quote">${node.lines.map(inl).join('<br/>')}</p>`); break;
        case 'ul': out.push(`<ul>${node.items.map((t) => `<li>${inl(t)}</li>`).join('')}</ul>`); break;
        case 'ol': out.push(`<ol>${node.items.map((t) => `<li>${inl(t)}</li>`).join('')}</ol>`); break;
        case 'fence': out.push(`<blockquote class="sem-code">${node.lines.map((l) => `<p><code>${esc(l) || '&nbsp;'}</code></p>`).join('')}</blockquote>`); break;
        case 'table': out.push(`<ul>${node.rows.map((r) => `<li>${r.map(inl).join(' · ')}</li>`).join('')}</ul>`); break;
        case 'hr': out.push('<hr/>'); break;
        case 'image': out.push(`<p>🖼 ${esc(node.caption || '（图片）')}</p>`); break;
        case 'tip': case 'warn': case 'danger': case 'info':
          out.push(`<blockquote><p><strong>${esc(node.title || ({ tip: '提示', warn: '踩坑', danger: '警告', info: '旁注' })[node.type])}</strong></p>${node.lines.map((t) => `<p>${inl(t)}</p>`).join('')}</blockquote>`);
          break;
        case 'steps': case 'cols':
          out.push(`<ul>${parsePipeItems(node.lines, 2).map((it) => `<li><strong>${esc(it.t)}</strong>${it.d ? ' — ' + esc(it.d) : ''}</li>`).join('')}</ul>`);
          break;
        case 'timeline':
          out.push(`<ul>${parsePipeItems(node.lines, 3).map((it) => `<li><strong>${esc(it.tag)} ${esc(it.title)}</strong> ${inl(it.body)}</li>`).join('')}</ul>`);
          break;
        case 'sign': {
          const ls = node.lines;
          out.push(`<p>我是 <strong>${esc(ls[0] || '{{作者名}}')}</strong>，${esc(ls[1] || '')}</p>`);
          break;
        }
        // toc / cover 不进贴图
      }
    }
    return out.join('\n');
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
  const semanticHost = $('semantic-host');

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
    const s = input.selectionStart;
    const e = input.selectionEnd;
    const sel = input.value.slice(s, e) || '文字';
    input.value = input.value.slice(0, s) + before + sel + after + input.value.slice(e);
    input.focus();
    input.setSelectionRange(s + before.length, s + before.length + sel.length);
    update();
  };

  const insertBlock = (tpl) => {
    const s = input.selectionStart;
    const before = input.value.slice(0, s);
    const prefix = before === '' || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
    const text = prefix + tpl + '\n';
    input.value = before + text + input.value.slice(input.selectionEnd);
    input.focus();
    const pos = s + text.length;
    input.setSelectionRange(pos, pos);
    update();
  };

  const INLINE_TOOLS = [
    ['B', '加粗（主色）', '**', '**'],
    ['高亮', '渐变高亮（每段≤2处）', '==', '=='],
    ['下划', '主色下划线（关键词标记）', '++', '++'],
    ['红线', '红色下划线（对比/否定）', '__', '__'],
    ['荧光', '黄底荧光笔', '%%', '%%'],
    ['标签', '背景标签', '[[', ']]'],
    ['删', '删除线（旧概念）', '~~', '~~'],
    ['`c`', '行内代码', '`', '`'],
  ];

  const BLOCK_TOOLS = [
    ['金句', '!! 这里是核心金句'],
    ['引用', '> 引用内容'],
    ['提示', ':::tip 提示标题\n提示内容\n:::'],
    ['踩坑', ':::warn 踩坑提示\n坑的内容\n:::'],
    ['警告', ':::danger\n强警告内容\n:::'],
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
    '目录': { md: '[TOC]\n\n## 先说结论\n\n## 实测过程\n\n## 写在最后', pickFirst: true },
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

  const AI_FALLBACK_PROMPT = (md) => `请对下面的公众号文章 Markdown 做排版标记优化（不改写内容）：每段标 1-3 个 ++关键词++；全文 ≤5 处 **加粗**；每段 ≤2 处 ==高亮==；对比/否定用 __文字__；提示类内容转 :::tip/:::warn 块；中文语境标点全角化（代码/URL 除外）；2 个以上 ## 章节时开头加 [TOC]；文末补 :::sign 签名块。直接返回优化后的完整 Markdown，不要解释。\n\n${md}`;

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

这是第一段正文。**核心概念**用主色加粗，++关键短语++用主色下划线标记，还可以用 ==渐变高亮== 强调一段里最重要的话。__被否定的说法__走红色下划线，~~过时的旧概念~~用删除线，[[新概念]]可以打个标签，行内命令写成 \`npm install\`。

## 先说结论 | OPINION

> 引用块用来放原文摘录或补充说明。

:::tip 一个正面提示
提示块适合放操作建议，标题可以自定义。
:::

:::warn 踩坑提示
警告块专门记录踩过的坑，别人不用再踩一遍。
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

- 无序列表（摸鱼绿主题下是胶囊样式）
- 第二条

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

  $('btn-sample').addEventListener('click', () => { input.value = SAMPLE; update(); });
  $('btn-clear').addEventListener('click', () => { input.value = ''; update(); input.focus(); });
  $('btn-copy').addEventListener('click', copyRich);
  punctBtn.addEventListener('click', () => {
    if (!countHalfPunct(input.value)) { showToast('没有需要修复的半角标点'); return; }
    input.value = fixHalfPunct(input.value);
    update();
    showToast('已把中文语境的半角标点转为全角');
  });
  aiBtn.addEventListener('click', runAi);
  aiUndoBtn.addEventListener('click', undoAi);
  input.addEventListener('input', update);

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
  initAi();

  // ============================================================
  // 小红书贴图导出（沿用原逻辑，分页源改为语义渲染）
  // ============================================================

  const AUTHOR = '汤姆喵的奇妙旅行';
  const SLIDE_W = 1242;
  const SLIDE_H = 1656;
  const BODY_INNER_H = SLIDE_H - 220 - 60;

  const overlay = $('exporter');
  const pagesGrid = $('exporter-pages');
  const stage = $('slide-stage');
  const measurerContent = $('slide-measurer-content');

  let heroDataUrl = null;

  const collectBlocks = () => {
    semanticHost.innerHTML = renderSemantic(parsed);
    return Array.from(semanticHost.children).map((el) => el.cloneNode(true));
  };

  const measureFits = (blocks) => {
    measurerContent.innerHTML = '';
    blocks.forEach((b) => measurerContent.appendChild(b.cloneNode(true)));
    return measurerContent.scrollHeight <= BODY_INNER_H;
  };

  const splitLongParagraph = (block) => {
    if (block.tagName !== 'P') return [block];
    const html = block.innerHTML;
    const parts = html.split(/(?<=[。！？!?])/).filter(Boolean);
    if (parts.length <= 1) return [block];
    const pieces = [];
    let buf = '';
    const flush = () => {
      const p = document.createElement('p');
      p.innerHTML = buf;
      pieces.push(p);
      buf = '';
    };
    for (const part of parts) {
      const test = document.createElement('p');
      test.innerHTML = buf + part;
      if (!measureFits([test]) && buf) { flush(); buf = part; }
      else buf += part;
    }
    if (buf) flush();
    return pieces.length ? pieces : [block];
  };

  const paginateBlocks = (blocks) => {
    const pages = [];
    let current = [];
    const isHeading = (el) => /^H[1-3]$/.test(el.tagName);

    for (const block of blocks) {
      if (!measureFits([block])) {
        if (current.length) { pages.push(current); current = []; }
        const splits = splitLongParagraph(block);
        if (splits.length === 1) pages.push([block]);
        else {
          for (const piece of splits) {
            current.push(piece);
            if (!measureFits(current)) {
              current.pop();
              if (current.length) pages.push(current);
              current = [piece];
            }
          }
        }
        continue;
      }
      current.push(block);
      if (!measureFits(current)) {
        current.pop();
        if (current.length >= 1 && isHeading(current[current.length - 1])) {
          const lastHeading = current.pop();
          if (current.length) pages.push(current);
          current = [lastHeading, block];
          if (!measureFits(current)) {
            current.pop();
            pages.push(current);
            current = [block];
          }
        } else {
          if (current.length) pages.push(current);
          current = [block];
        }
      }
    }
    if (current.length) pages.push(current);
    return pages;
  };

  const buildCoverSlide = (title) => {
    const el = document.createElement('div');
    el.className = 'slide cover';
    el.dataset.kind = 'cover';
    const heroHtml = heroDataUrl
      ? `<img class="hero" src="${heroDataUrl}" alt="">`
      : `<div class="hero-placeholder">封面 hero 图位</div>`;
    el.innerHTML = `${heroHtml}
      <div class="cover-title">${esc(title || '未命名文章')}</div>
      <div class="cover-author">作者：${esc(AUTHOR)}</div>
      <div class="cover-divider"></div>`;
    return el;
  };

  const buildBodySlide = (blocks, pageIdx, totalPages) => {
    const el = document.createElement('div');
    el.className = 'slide body';
    el.dataset.kind = 'body';
    const content = document.createElement('div');
    content.className = 'body-content';
    blocks.forEach((b) => content.appendChild(b.cloneNode(true)));
    el.appendChild(content);
    const num = document.createElement('span');
    num.className = 'page-num';
    num.textContent = `${pageIdx} / ${totalPages}`;
    el.appendChild(num);
    return el;
  };

  const buildAllSlides = () => {
    stage.innerHTML = '';
    const title = parsed.meta.title || '未命名文章';
    const blocks = collectBlocks();
    if (blocks.length && blocks[0].tagName === 'H1') blocks.shift();
    const bodyPages = blocks.length ? paginateBlocks(blocks) : [];
    const slides = [];
    const cover = buildCoverSlide(title);
    stage.appendChild(cover);
    slides.push(cover);
    bodyPages.forEach((pageBlocks, i) => {
      const slide = buildBodySlide(pageBlocks, i + 1, bodyPages.length);
      stage.appendChild(slide);
      slides.push(slide);
    });
    return slides;
  };

  const renderThumbs = (slides) => {
    pagesGrid.innerHTML = '';
    slides.forEach((slide, i) => {
      const thumb = document.createElement('div');
      thumb.className = 'thumb';
      const inner = document.createElement('div');
      inner.className = 'thumb-inner';
      inner.appendChild(slide.cloneNode(true));
      thumb.appendChild(inner);
      const idx = document.createElement('span');
      idx.className = 'idx';
      idx.textContent = `${i + 1} / ${slides.length}`;
      thumb.appendChild(idx);
      const kind = document.createElement('span');
      kind.className = 'kind';
      kind.textContent = slide.dataset.kind === 'cover' ? '封面' : '正文';
      thumb.appendChild(kind);
      pagesGrid.appendChild(thumb);
    });
    requestAnimationFrame(() => {
      pagesGrid.querySelectorAll('.thumb').forEach((t) => {
        const scale = t.clientWidth / SLIDE_W;
        t.querySelector('.thumb-inner').style.transform = `scale(${scale})`;
        t.style.height = (SLIDE_W * (4 / 3)) * scale + 'px';
      });
    });
  };

  // hero 上传
  const heroUploader = $('hero-uploader');
  const heroFile = $('hero-file');
  const heroPreview = $('hero-preview');
  const heroPlaceholderText = $('hero-placeholder-text');

  const readAsDataURL = (file) => new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result);
    fr.onerror = () => rej(fr.error);
    fr.readAsDataURL(file);
  });

  const setHero = async (file) => {
    if (!file) return;
    heroDataUrl = await readAsDataURL(file);
    heroPreview.src = heroDataUrl;
    heroPreview.style.display = 'block';
    heroPlaceholderText.style.display = 'none';
    refreshSlides();
  };
  const clearHero = () => {
    heroDataUrl = null;
    heroPreview.removeAttribute('src');
    heroPreview.style.display = 'none';
    heroPlaceholderText.style.display = '';
    heroFile.value = '';
    refreshSlides();
  };
  heroFile.addEventListener('change', (e) => setHero(e.target.files[0]));
  heroUploader.addEventListener('dragover', (e) => { e.preventDefault(); heroUploader.classList.add('drag'); });
  heroUploader.addEventListener('dragleave', () => heroUploader.classList.remove('drag'));
  heroUploader.addEventListener('drop', (e) => {
    e.preventDefault();
    heroUploader.classList.remove('drag');
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (f && f.type.startsWith('image/')) setHero(f);
  });
  $('btn-hero-clear').addEventListener('click', clearHero);

  // caption
  const capSubtitle = $('cap-subtitle');
  const capIntro = $('cap-intro');
  const updateCapMeta = () => {
    const sLen = [...capSubtitle.value].length;
    const iLen = [...capIntro.value].length;
    $('cap-subtitle-meta').textContent = `${sLen} 字`;
    $('cap-subtitle-meta').classList.toggle('warn', sLen > 0 && (sLen < 7 || sLen > 15));
    $('cap-intro-meta').textContent = `${iLen} 字`;
    $('cap-intro-meta').classList.toggle('warn', iLen > 0 && (iLen < 150 || iLen > 200));
  };
  capSubtitle.addEventListener('input', updateCapMeta);
  capIntro.addEventListener('input', updateCapMeta);

  $('btn-copy-skill-prompt').addEventListener('click', async () => {
    const md = input.value.trim() || '（请粘贴文章内容）';
    const ok = await copyText(`请用 tommiao-xiaohongshu-cover skill 处理下面这篇文章，给我封面 hero 图（1024x768）和小红书 caption 文案（副标题 7-15 字 + 简介 150-200 字）。\n\n---\n${md}\n---`);
    showToast(ok ? '已复制 skill 指令，粘到 agent 聊天' : '复制失败');
  });

  $('btn-copy-caption').addEventListener('click', async () => {
    const sub = capSubtitle.value.trim();
    const intro = capIntro.value.trim();
    if (!sub && !intro) { showToast('副标题和简介都还没填'); return; }
    const ok = await copyText([sub, intro].filter(Boolean).join('\n\n'));
    showToast(ok ? '已复制 caption，粘到小红书发布框' : '复制失败');
  });

  // 导出 ZIP
  const slugFromTitle = (title) => {
    const t = (title || 'untitled').replace(/[\\/:*?"<>|\s]/g, '').slice(0, 16);
    const d = new Date();
    const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    return `${ymd}-${t || 'untitled'}`;
  };
  const downloadBlob = (blob, filename) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 200);
  };
  const slideToBlob = (slide) => new Promise((resolve, reject) => {
    html2canvas(slide, {
      width: SLIDE_W, height: SLIDE_H, scale: 1,
      backgroundColor: '#ffffff', useCORS: true, logging: false,
    }).then((canvas) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob 失败'))), 'image/png'))
      .catch(reject);
  });

  const exportZipBtn = $('btn-export-zip');
  exportZipBtn.addEventListener('click', async () => {
    const slides = stage.querySelectorAll('.slide');
    if (!slides.length) { showToast('还没有 slides，先写正文'); return; }
    const origText = exportZipBtn.textContent;
    exportZipBtn.disabled = true;
    try {
      const zip = new JSZip();
      for (let i = 0; i < slides.length; i++) {
        exportZipBtn.textContent = `渲染中 ${i + 1}/${slides.length}...`;
        const blob = await slideToBlob(slides[i]);
        zip.file(`${String(i + 1).padStart(2, '0')}-${slides[i].dataset.kind}.png`, blob);
      }
      const sub = capSubtitle.value.trim();
      const intro = capIntro.value.trim();
      if (sub || intro) {
        zip.file('caption.txt', ['【副标题】', sub || '（未填）', '', '【简介】', intro || '（未填）', '', '【源文章标题】', parsed.meta.title].join('\n'));
      }
      exportZipBtn.textContent = '打包中...';
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      downloadBlob(zipBlob, `xhs-${slugFromTitle(parsed.meta.title)}.zip`);
      showToast(`已导出 ${slides.length} 张图`);
    } catch (e) {
      console.error(e);
      showToast('导出失败：' + e.message);
    } finally {
      exportZipBtn.disabled = false;
      exportZipBtn.textContent = origText;
    }
  });

  // 模态开关
  const refreshSlides = () => {
    if (!overlay.classList.contains('show')) return;
    renderThumbs(buildAllSlides());
  };
  $('btn-export').addEventListener('click', () => { overlay.classList.add('show'); refreshSlides(); });
  $('exporter-close').addEventListener('click', () => overlay.classList.remove('show'));
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.classList.remove('show'); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlay.classList.contains('show')) overlay.classList.remove('show');
  });
  input.addEventListener('input', () => { if (overlay.classList.contains('show')) refreshSlides(); });
})();

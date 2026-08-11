/**
 * 主题渲染器 —— 每套主题 = 设计变量 + 行内样式渲染 + 块级组件渲染
 *
 * 所有产出的 HTML 遵守公众号平台红线（gzh-design skill）：
 *  - 只用内联 style，不用 class/id/div/position/float/grid
 *  - 文字节点一律 <span leaf=""> 包裹；装饰性空元素内放 <span leaf=""><br></span> 占位
 *  - 不把 font-size/border-bottom 打在 <strong> 上；一个 <p> 里只有一个字号
 *
 * 组件体系移植自 gzh-design skill 的 theme-moyu-green.md / common-components.md，
 * 并抽象为「杂志主题工厂」makeMagazineTheme(palette)：同一套组件，按调色板实例化。
 * 当前实例：理智蓝（lizhi）、摸鱼绿（moyu）。新增配色只需加一个 palette。
 */
window.GZH_THEMES = (() => {
  'use strict';

  const leaf = (t) => `<span leaf="">${t}</span>`;
  const FILL = '<span leaf=""><br></span>'; // 装饰空元素占位，防微信剥样式

  // hex -> rgba(r,g,b,a)，供主色的半透明衍生色使用
  const rgba = (hex, a) => {
    const h = hex.replace('#', '');
    const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  };

  // 全主题共用的中性色 + 字体
  const N = {
    yellow: '#FDE68A',
    warnBg: '#FFFBEB',
    warnText: '#92400E',
    red: '#FECACA',
    warnOrange: 'rgb(255,76,0)',
    warnGray: 'rgb(136,136,136)',
    heading: '#111827',
    body: '#374151',
    second: '#4B5563',
    note: '#6B7280',
    aux: '#9CA3AF',
    divider: '#D1D5DB',
    border: '#E5E7EB',
    grayBg: '#F3F4F6',
    palest: '#F9FAFB',
    font: "-apple-system,BlinkMacSystemFont,'PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif",
  };

  // 深色代码块（通用库 1a，全主题共用）
  const darkFence = ({ lang, lines }) => {
    const body = lines.map((l) => `<p style="margin:0;font-family:'SF Mono',Consolas,Monaco,monospace;font-size:13px;line-height:1.6;color:#E2E8F0;">${leaf(l || '&nbsp;')}</p>`).join('');
    const langTag = lang ? `<span style="margin-left:12px;font-size:12px;color:#64748B;font-family:Consolas,Monaco,monospace;letter-spacing:1px;">${leaf(lang)}</span>` : '';
    return `<section style="margin:0 0 20px;border-radius:8px;overflow:hidden;background:#1E293B;box-shadow:0 4px 16px -8px rgba(15,23,42,0.4);">
<section style="display:flex;align-items:center;padding:9px 14px;background:#0F172A;">
<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#FF5F56;margin-right:7px;font-size:0;line-height:0;overflow:hidden;">.</span>
<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#FFBD2E;margin-right:7px;font-size:0;line-height:0;overflow:hidden;">.</span>
<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#27C93F;font-size:0;line-height:0;overflow:hidden;">.</span>
${langTag}
</section>
<section style="padding:11px 14px;">${body}</section>
</section>`;
  };

  // 通用：横排流程/对比卡片（首卡实色，2~4 项）
  function flowCards(items, note, { mainBg, accBorder, accColor, arrow }) {
    const cards = items.map((it, i) => {
      const isFirst = i === 0;
      const isLast = i === items.length - 1;
      let style, tColor, dColor;
      if (isFirst) {
        style = `background:${mainBg};`; tColor = '#ffffff'; dColor = 'rgba(255,255,255,0.8)';
      } else if (isLast && arrow) {
        style = `background:#ffffff;border:1px solid ${accBorder};`; tColor = accColor; dColor = '#9CA3AF';
      } else {
        style = 'background:#ffffff;border:1px solid #E5E7EB;'; tColor = '#111827'; dColor = '#9CA3AF';
      }
      const card = `<section style="flex:1;text-align:center;padding:10px 8px;${style}border-radius:8px;">
<p style="font-size:13px;font-weight:800;color:${tColor};margin:0 0 3px;">${leaf(it.t)}</p>
${it.d ? `<p style="font-size:10px;color:${dColor};margin:0;line-height:1.5;">${leaf(it.d)}</p>` : ''}
</section>`;
      const sep = (arrow && i < items.length - 1)
        ? `<section style="display:flex;align-items:center;color:#D1D5DB;font-size:14px;padding:0 4px;">${leaf(arrow)}</section>` : '';
      return card + sep;
    }).join('');
    return `<section style="background:#F9FAFB;padding:16px;border-radius:12px;border:1px solid #F3F4F6;margin:0 0 24px;">
<section style="display:flex;align-items:stretch;justify-content:center;gap:6px;">${cards}</section>
${note ? `<p style="font-size:12px;color:#9CA3AF;text-align:center;margin:12px 0 0;letter-spacing:0.5px;">${leaf(note)}</p>` : ''}
</section>`;
  }

  // 通用：时间线（最后一个节点不带竖线）
  function timelineBlock(items, color) {
    return items.map((it, i) => {
      const isLast = i === items.length - 1;
      const line = isLast ? '' : `<section style="width:2px;background:#E5E7EB;flex:1;margin-top:4px;min-height:40px;">${FILL}</section>`;
      return `<section style="display:flex;margin-bottom:${isLast ? '28px' : '0'};">
<section style="display:flex;flex-direction:column;align-items:center;margin-right:16px;flex-shrink:0;">
<section style="width:14px;height:14px;border-radius:50%;border:3px solid ${color};background:#ffffff;margin-top:4px;box-shadow:0 0 0 2px #ffffff;">${FILL}</section>
${line}
</section>
<section style="flex:1;padding-bottom:12px;">
<section style="display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap;">
<span style="display:inline-block;background:#111827;color:#ffffff;font-size:10px;font-weight:700;padding:2px 8px;border-radius:12px;">${leaf(it.tag)}</span>
<h4 style="font-size:15px;font-weight:800;color:#111827;margin:0;">${leaf(it.title)}</h4>
</section>
<p style="font-size:14px;margin:0 0 8px;color:#4B5563;line-height:1.8;text-align:justify;">${it.body}</p>
</section>
</section>`;
    }).join('');
  }

  // ============================================================
  // 杂志主题工厂：同一套组件体系，按调色板实例化
  // palette: { id, name, main, sub, deco, lightLine, lightBorder, lightBg, lighterBg, deepText }
  // ============================================================
  function makeMagazineTheme(P) {
    const grad = `linear-gradient(135deg,${P.main},${P.sub})`;

    const theme = {
      id: P.id,
      name: P.name,
      uiColor: P.main,

      container(inner) {
        return `<section style="max-width:677px;margin:0 auto;background:#ffffff;font-family:${N.font};color:${N.body};line-height:1.75;letter-spacing:0.5px;overflow-x:hidden;">${inner}</section>`;
      },

      inline: {
        strong: (t) => `<strong style="color:${P.main};">${leaf(t)}</strong>`,
        em: (t) => `<em style="font-style:italic;color:${N.body};">${leaf(t)}</em>`,
        highlight: (t) => `<span style="background:linear-gradient(120deg,${N.yellow} 0%,rgba(255,255,255,0) 100%);padding:0 4px;border-radius:2px;font-weight:600;color:${N.heading};">${leaf(t)}</span>`,
        underline: (t) => `<span style="border-bottom:2px solid ${P.lightLine};font-weight:600;">${leaf(t)}</span>`,
        redline: (t) => `<span style="border-bottom:2px solid ${N.red};">${leaf(t)}</span>`,
        strike: (t) => `<span style="background:${N.grayBg};color:${N.note};padding:2px 6px;border-radius:4px;font-size:13px;text-decoration:line-through;font-weight:600;">${leaf(t)}</span>`,
        mark: (t) => `<span style="color:${N.heading};font-weight:bold;border-bottom:3px solid ${N.yellow};">${leaf(t)}</span>`,
        tag: (t) => `<strong style="color:${P.main};background:${rgba(P.main, 0.1)};padding:0 4px;border-radius:2px;">${leaf(t)}</strong>`,
        code: (t) => `<span style="background:${N.grayBg};color:#1F2937;padding:2px 6px;border-radius:4px;font-size:13px;font-weight:600;">${leaf(t)}</span>`,
        link: (t, url) => `<a href="${url}" style="color:${P.main};text-decoration:underline;text-underline-offset:3px;">${leaf(t)}</a>`,
      },

      blocks: {
        chapter({ num, tag, title, isLast, first }) {
          const mt = first ? '16px' : '48px';
          const partWord = isLast ? 'LAST' : 'PART';
          return `<section style="margin-top:${mt};margin-bottom:24px;padding:0 20px;">
<section style="display:flex;align-items:center;gap:16px;">
<section style="text-align:center;flex-shrink:0;">
<p style="margin:0;font-size:28px;font-weight:900;color:${P.main};line-height:1;letter-spacing:-2px;">${leaf(num)}</p>
<p style="margin:0;font-size:8px;font-weight:700;color:${N.divider};letter-spacing:2px;">${leaf(partWord)}</p>
</section>
<span style="width:1px;height:36px;background:${N.border};flex-shrink:0;">${FILL}</span>
<section>
<p style="margin:0 0 1px;font-size:17px;font-weight:900;color:${N.heading};letter-spacing:0.3px;">${title}</p>
<p style="margin:0;font-size:11px;font-weight:600;color:${N.aux};letter-spacing:1.5px;">${leaf(tag)}</p>
</section>
</section>
</section>`;
        },
        sub(html) {
          return `<p style="font-size:15px;font-weight:900;color:${N.heading};margin:32px 0 16px;"><span style="background:linear-gradient(180deg,transparent 65%,${N.yellow} 65%);padding:0 4px;">${html}</span></p>`;
        },
        p(html) {
          return `<p style="margin-bottom:16px;font-size:14px;line-height:1.9;text-align:justify;color:${N.body};">${html}</p>`;
        },
        quote(paras) {
          const inner = paras.map((h) => `<p style="font-size:13px;color:${N.body};margin:0 0 4px;line-height:1.6;">${h}</p>`).join('');
          return `<section style="background:${N.palest};border:1px dashed ${N.divider};border-radius:8px;padding:12px 16px;margin-bottom:24px;text-align:justify;">${inner}</section>`;
        },
        golden(html) {
          return `<section style="background:#FFFFFF;border:1px dashed ${P.lightBorder};border-radius:8px;padding:14px 16px;margin-bottom:24px;text-align:center;">
<p style="margin:0;line-height:1.6;"><span style="font-size:15px;color:${P.main};font-weight:bold;border-bottom:3px solid ${N.yellow};padding-bottom:2px;">${html}</span></p>
</section>`;
        },
        center(html) {
          return `<p style="font-size:14px;margin-bottom:20px;text-align:center;color:${P.main};font-weight:700;letter-spacing:1px;border-top:1px solid ${N.grayBg};border-bottom:1px solid ${N.grayBg};padding:12px 0;">${html}</p>`;
        },
        ul(items) {
          const rows = items.map((h) => `<section style="margin-bottom:10px;">
<p style="margin:0;"><span style="display:inline-block;font-size:13px;font-weight:700;color:${P.main};background:${rgba(P.main, 0.08)};padding:3px 10px;border-radius:999px;"><span style="display:inline-block;width:6px;height:6px;background:${P.main};border-radius:50%;margin-right:5px;vertical-align:middle;">${FILL}</span>${h}</span></p>
</section>`).join('');
          return `<section style="margin-bottom:14px;">${rows}</section>`;
        },
        ol(items) {
          const rows = items.map((h, i) => `<section style="display:flex;align-items:flex-start;gap:10px;margin-bottom:12px;">
<span style="display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;background:${P.main};color:#ffffff;font-size:11px;font-weight:700;border-radius:50%;flex-shrink:0;margin-top:2px;">${leaf(String(i + 1))}</span>
<p style="font-size:14px;color:${N.body};margin:0;line-height:1.9;flex:1;">${h}</p>
</section>`).join('');
          return `<section style="margin-bottom:24px;">${rows}</section>`;
        },
        fence: darkFence,
        table({ head, rows }) {
          const th = head.map((h) => `<th style="background:${P.main};color:#ffffff;font-weight:700;padding:8px 12px;text-align:left;font-size:13px;">${h}</th>`).join('');
          const trs = rows.map((r, i) => {
            const bg = i % 2 === 1 ? 'background:#F9FAFB;' : '';
            return `<tr>${r.map((c) => `<td style="padding:8px 12px;border-bottom:1px solid ${N.border};color:${N.body};font-size:13px;${bg}">${c}</td>`).join('')}</tr>`;
          }).join('');
          return `<section style="margin-bottom:24px;overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:13px;"><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table></section>`;
        },
        hr() {
          return `<section style="margin:32px 20px;height:1px;background:linear-gradient(to right,${rgba(P.main, 0.25)},transparent);overflow:hidden;">${FILL}</section>`;
        },
        image({ src, caption, isGif }) {
          const img = `<section style="background:#FFFFFF;border-radius:12px;padding:6px;border:1px solid ${N.border};box-shadow:0 4px 12px -2px rgba(0,0,0,0.08);margin-bottom:8px;">
<section style="margin:0;border-radius:8px;overflow:hidden;"><span leaf=""><img src="${src}" style="max-width:100%;height:auto;display:block;margin:0 auto;"></span></section>
</section>`;
          if (isGif) {
            return img + `<p style="text-align:center;margin:0 0 24px;">
<span style="display:inline-block;background:${P.lightBg};color:${P.deepText};font-size:11px;font-weight:700;padding:1px 8px;border-radius:4px;margin-right:6px;">${leaf('GIF 动图')}</span>
${caption ? `<span style="font-size:12px;color:${N.aux};">${leaf(caption)}</span>` : ''}
</p>`;
          }
          if (caption) {
            return img + `<p style="font-size:12px;color:${N.aux};text-align:center;margin:0 0 24px;">${leaf('— ' + caption)}</p>`;
          }
          return img.replace('margin-bottom:8px;', 'margin-bottom:24px;');
        },
        tip({ title, paras }) {
          return `<section style="padding:6px 0 4px;margin-bottom:16px;">
<p style="margin-bottom:6px;font-size:12px;font-weight:700;color:${N.aux};letter-spacing:1px;"><span style="color:${P.main};">${leaf('✦ ' + (title || '提示'))}</span></p>
${paras.map((h) => `<p style="font-size:13px;color:${N.body};margin:0 0 4px;line-height:1.7;">${h}</p>`).join('')}
</section>`;
        },
        warn({ title, paras }) {
          return `<section style="padding:6px 0 4px;margin-bottom:16px;">
<p style="margin-bottom:6px;font-size:12px;font-weight:700;color:${N.aux};letter-spacing:1px;"><span style="color:${N.warnOrange};">${leaf('！' + (title || '踩坑提示') + ' 🕳')}</span></p>
${paras.map((h) => `<p style="font-size:13px;margin:0 0 4px;line-height:1.7;"><span style="color:${N.warnGray};font-weight:bold;">${h}</span></p>`).join('')}
</section>`;
        },
        danger({ title, paras }) {
          return `<section style="background:${N.warnBg};border:1px solid ${N.yellow};border-radius:12px;padding:12px 16px;margin-bottom:20px;">
${title ? `<p style="font-size:13px;color:${N.warnText};margin:0 0 4px;font-weight:800;">${leaf(title)}</p>` : ''}
${paras.map((h) => `<p style="font-size:13px;color:${N.warnText};margin:0;font-weight:700;line-height:1.7;">${h}</p>`).join('')}
</section>`;
        },
        info({ title, paras }) {
          return `<section style="background:${P.lighterBg};padding:12px 16px;border-radius:8px;border:1px solid ${P.lightBorder};margin-bottom:20px;">
${title ? `<p style="font-size:12px;color:${P.main};margin:0 0 6px;font-weight:700;letter-spacing:1px;">${leaf('✦ ' + title)}</p>` : ''}
${paras.map((h) => `<p style="font-size:13px;color:${N.body};margin:0;line-height:1.7;text-align:justify;">${h}</p>`).join('')}
</section>`;
        },
        steps({ items, note }) {
          return flowCards(items, note, { mainBg: grad, accBorder: P.lightLine, accColor: P.main, arrow: '→' });
        },
        cols({ items }) {
          return flowCards(items, '', { mainBg: grad, accBorder: N.border, accColor: N.heading, arrow: '' });
        },
        timeline({ items }) {
          return timelineBlock(items, P.main);
        },
        toc({ items }) {
          const cards = items.map((it, i) => {
            const first = i === 0;
            const bg = first
              ? `background:${grad};`
              : `background:#ffffff;border:1px solid ${N.border};box-shadow:0 2px 6px rgba(0,0,0,0.04);`;
            const numColor = first ? 'rgba(255,255,255,0.7)' : N.aux;
            const titleColor = first ? '#ffffff' : N.heading;
            const subColor = first ? 'rgba(255,255,255,0.7)' : N.aux;
            return `<section style="display:inline-block;white-space:normal;vertical-align:top;width:110px;min-height:64px;${bg}border-radius:12px;padding:12px;margin-right:8px;">
<p style="font-size:9px;font-weight:700;color:${numColor};letter-spacing:1px;margin:0 0 5px;">${leaf('PART ' + it.num)}</p>
<p style="font-size:13px;font-weight:800;color:${titleColor};margin:0 0 3px;">${leaf(it.title)}</p>
${it.sub ? `<p style="font-size:10px;color:${subColor};margin:0;">${leaf(it.sub)}</p>` : ''}
</section>`;
          }).join('');
          return `<section style="margin:0 20px 32px;">
<section style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
<p style="font-size:10px;color:${N.aux};margin:0;text-transform:uppercase;letter-spacing:2px;font-weight:600;">${leaf('📦 ' + items.length + ' Parts')}</p>
<p style="font-size:10px;color:${N.aux};margin:0;">${leaf('👉 滑动')}</p>
</section>
<section style="overflow-x:scroll;-webkit-overflow-scrolling:touch;white-space:nowrap;padding-bottom:8px;">${cards}</section>
</section>`;
        },
        cover(f) {
          return `<section style="margin:0 0 32px;background:#fff;border:1.5px solid ${rgba(P.main, 0.15)};border-radius:20px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.06);width:100%;">
<section style="padding:32px 28px 28px;">
<section style="display:flex;align-items:center;gap:8px;margin-bottom:28px;">
<span style="width:6px;height:6px;background:${P.main};border-radius:50%;">${FILL}</span>
<span style="font-size:11px;font-weight:700;letter-spacing:3px;color:${P.main};">${leaf(f.label)}</span>
<section style="flex:1;height:1px;overflow:hidden;background:linear-gradient(to right,${rgba(P.main, 0.12)},transparent);">${FILL}</section>
<span style="font-size:10px;color:${N.divider};font-weight:600;">${leaf(f.date)}</span>
</section>
<section>
${f.old ? `<p style="font-size:15px;color:${N.divider};margin:0 0 6px;text-decoration:line-through;letter-spacing:0.5px;">${leaf(f.old)}</p>` : ''}
<p style="font-size:24px;font-weight:900;color:${N.heading};margin:0;line-height:1.05;letter-spacing:-2px;">${leaf(f.line1)}${f.green ? `<span style="color:${P.main};">${leaf(f.green)}</span>` : ''}</p>
${f.line2 ? `<p style="font-size:24px;font-weight:900;color:${P.main};margin:0 0 16px;line-height:1.05;letter-spacing:-2px;">${leaf(f.line2)}</p>` : ''}
<section style="width:48px;height:3px;background:linear-gradient(to right,${P.main},${P.deco});border-radius:2px;margin-bottom:12px;">${FILL}</section>
${f.sub ? `<p style="font-size:13px;color:${N.aux};margin:0;line-height:1.7;letter-spacing:0.5px;">${leaf(f.sub)}</p>` : ''}
</section>
</section>
${f.brand ? `<section style="background:${grad};padding:12px 28px;display:flex;align-items:center;justify-content:space-between;">
<p style="font-size:12px;color:rgba(255,255,255,0.9);margin:0;font-weight:600;letter-spacing:0.5px;">${leaf(f.brand)}</p>
<section style="display:flex;gap:4px;">
${(f.tags || []).map((t) => `<span style="background:rgba(255,255,255,0.2);padding:1px 6px;border-radius:3px;font-size:8px;color:#fff;font-weight:600;">${leaf(t)}</span>`).join('')}
</section>
</section>` : ''}
</section>`;
        },
        sign({ name, bio }) {
          const intro = `<section style="padding:0 20px;"><p style="margin-bottom:16px;font-size:14px;line-height:1.9;text-align:justify;color:${N.body};">${leaf('我是 ')}<strong style="color:${P.main};">${leaf(name)}</strong>${leaf('，' + bio + '。')}</p></section>`;
          return intro + `<section style="background:radial-gradient(circle at center,${N.palest} 0%,#FFFFFF 100%);border:1px solid ${N.border};border-radius:16px;padding:32px 20px;text-align:center;box-shadow:0 4px 12px rgba(0,0,0,0.03);margin:0 0 24px;">
<p style="font-size:13px;font-weight:bold;color:${N.heading};margin-bottom:20px;line-height:1.6;">${leaf('既然看到这里了，如果觉得有用，随手点个赞、转发、推荐三连吧。')}</p>
<section style="display:flex;justify-content:center;gap:24px;margin-bottom:16px;">
<section style="text-align:center;color:${N.second};">
<section style="width:40px;height:40px;display:flex;align-items:center;justify-content:center;margin:0 auto 6px;background:#fff;border-radius:12px;box-shadow:0 2px 4px rgba(0,0,0,0.05);border:1px solid ${N.grayBg};"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"></path></svg></section>
<span style="font-size:10px;font-weight:600;">${leaf('点赞')}</span>
</section>
<section style="text-align:center;color:${N.second};">
<section style="width:40px;height:40px;display:flex;align-items:center;justify-content:center;margin:0 auto 6px;background:#fff;border-radius:12px;box-shadow:0 2px 4px rgba(0,0,0,0.05);border:1px solid ${N.grayBg};"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 18v-4a8 8 0 0 1 8-8h8"></path><polyline points="16 2 20 6 16 10"></polyline></svg></section>
<span style="font-size:10px;font-weight:600;">${leaf('转发')}</span>
</section>
<section style="text-align:center;color:${P.main};">
<section style="width:40px;height:40px;display:flex;align-items:center;justify-content:center;margin:0 auto 6px;background:${P.lightBg};border-radius:12px;box-shadow:0 2px 4px ${rgba(P.main, 0.15)};border:1px solid ${P.lightLine};"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg></section>
<span style="font-size:10px;font-weight:600;">${leaf('推荐')}</span>
</section>
</section>
<p style="font-size:10px;color:${N.aux};letter-spacing:1px;margin:0;">${leaf('THANKS FOR READING')}</p>
</section>`;
        },
      },
    };

    // 正文流式块统一包 0 20px 边距容器（杂志骨架特征）
    theme.wrapFlow = (html) => `<section style="padding:0 20px;">${html}</section>`;
    return theme;
  }

  // ============================================================
  // 主题实例
  // ============================================================

  // 理智蓝：主色 #2563EB（取自参考文章实测色值），专业理性、科技感
  const lizhi = makeMagazineTheme({
    id: 'lizhi',
    name: '理智蓝',
    main: '#2563EB',      // blue-600 主色
    sub: '#3B82F6',       // blue-500 渐变副色
    deco: '#60A5FA',      // blue-400 装饰渐变尾色
    lightLine: '#BFDBFE', // blue-200 正文关键词下划线
    lightBorder: '#BFDBFE',
    lightBg: '#EFF6FF',   // blue-50
    lighterBg: '#F5F9FF',
    deepText: '#1E40AF',  // blue-800 浅底上的深字
  });

  // 摸鱼绿：移植自 gzh-design theme-moyu-green.md
  const moyu = makeMagazineTheme({
    id: 'moyu',
    name: '摸鱼绿',
    main: '#059669',      // emerald-600
    sub: '#10B981',       // emerald-500
    deco: '#34D399',      // emerald-400
    lightLine: '#A7F3D0', // emerald-200
    lightBorder: '#BBF7D0',
    lightBg: '#ECFDF5',
    lighterBg: '#F0FDF4',
    deepText: '#065F46',
  });

  return {
    themes: { lizhi, moyu },
    order: ['lizhi', 'moyu'],
    helpers: { leaf, FILL },
  };
})();

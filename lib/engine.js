'use strict';
/**
 * 渲染引擎：把「主题定义」+「数据」渲染成最终的状态栏文本。
 *
 * 主题只描述内容（有哪些段、什么图标颜色、怎么折行），
 * 宽度计算、折行、上色这些都由这里统一处理。
 *
 * ── 主题文件格式 ──────────────────────────────────────────────
 * module.exports = {
 *   name: 'emoji-line',
 *   description: '一句话说明',
 *   separator: ' | ',        // 段与段之间的分隔符（会被 dim 上色）
 *   wrap: 'auto',            // 'auto' 按终端宽度自动折行 | 'never' 单行
 *                            // 或显式分行：[[0,1,2],[3,4]]（下标对应 segments）
 *                            // 或 [[seg,seg],[seg]] 直接给分好的数组
 *   segments: [
 *     {
 *       icon: '🤖',           // 可选，段首图标
 *       iconColor: 'brightCyan',
 *       when: (d) => !!d.model.name,   // 可选，返回 false 则整段不显示
 *       parts: [                       // 段内片段
 *         { text: (d) => d.model.name, color: 'brightCyan' },
 *       ],
 *       innerSep: ' ',        // 段内片段之间的连接符（默认空格）
 *       innerSepColor: 'dim',
 *     },
 *   ],
 * };
 */

const { paint, stripAnsi } = require('./palette');
const { displayWidth } = require('./width');

/** 把段定义渲染成 { text, width, blank } —— blank 表示这段是纯留白 */
function renderSegment(seg, data, ctx) {
  let parts = seg.parts;
  if (typeof parts === 'function') parts = parts(data, ctx);
  if (!Array.isArray(parts)) parts = parts ? [parts] : [];

  const rendered = [];
  for (const part of parts) {
    if (!part) continue;
    const raw = typeof part.text === 'function' ? part.text(data, ctx) : part.text;
    if (raw === null || raw === undefined || raw === '') continue;
    rendered.push(paint(part.color ?? seg.color, raw));
  }
  if (rendered.length === 0 && !seg.icon) return null;

  // 段内分隔符默认不上色 —— 上了色就会插一个 reset，把 powerline 的背景色冲掉。
  // 需要上色的主题请显式写 innerSepColor。
  const innerSep = seg.innerSep ?? ' ';
  const sepPainted = seg.innerSepColor ? paint(seg.innerSepColor, innerSep) : innerSep;
  let body = rendered.join(innerSep ? sepPainted : '');

  if (seg.icon) {
    const icon = paint(seg.iconColor ?? seg.color, seg.icon);
    body = body ? `${icon} ${body}` : icon;
  }

  // 段尾附加内容（比如 git 的状态点）
  if (typeof seg.suffix === 'function') {
    const extra = seg.suffix(data, ctx);
    if (extra) body += ` ${extra}`;
  }

  if (body === '') return null;
  return { text: body, width: displayWidth(body), grow: seg.grow === true, bg: seg.bg, fg: seg.fg };
}

/**
 * powerline 模式：每段渲染成一块背景色，块与块之间用箭头过渡。
 * 箭头的「左半」继承前一块的背景色，「右半」是下一块的背景色，
 * 这样才有拼接的观感。需要 Nerd Font。
 */
function renderPowerline(lines, theme) {
  const arrow = theme.powerlineArrow || '';
  const bgCode = (name) => require('./palette').code(name) || '';

  return lines
    .map((line) => {
      let out = '';
      line.forEach((seg, i) => {
        const bg = bgCode(seg.bg);
        const fg = bgCode(seg.fg) || '\x1b[30m'; // 默认黑字
        out += `${fg}${bg}${seg.text} `;

        // 当前块的背景色，作为箭头左半边的前景色
        const curBg = bg;
        const nextBg = bgCode(line[i + 1]?.bg) || '';
        out += `${curBg}${nextBg}${arrow}`;
        if (!nextBg) out += '\x1b[0m'; // 最后一块收尾
        else out += '\x1b[0m';
      });
      return out;
    })
    .join('\n');
}

/** 按显示宽度贪心折行；每行之间的分隔符不计入行尾 */
function wrapSegments(segments, separator, width) {
  if (!Number.isFinite(width) || width <= 0) return [segments];
  const sepW = displayWidth(separator);
  const lines = [];
  let line = [];
  let used = 0;

  for (const seg of segments) {
    const add = line.length === 0 ? seg.width : sepW + seg.width;
    if (line.length > 0 && used + add > width) {
      lines.push(line);
      line = [seg];
      used = seg.width;
    } else {
      line.push(seg);
      used += add;
    }
  }
  if (line.length) lines.push(line);
  return lines;
}

/**
 * @param {object} theme  主题模块
 * @param {object} data   buildData() 的产物
 * @param {object} opts   { width }
 * @returns {string} 可能包含 \n 的多行文本
 */
function render(theme, data, opts = {}) {
  const ctx = { width: opts.width };
  const separator = theme.separator ?? ' | ';
  const sepText = paint(theme.separatorColor ?? 'dim', separator);

  // 1. 渲染每一段（过滤掉不显示的）
  const segs = [];
  for (const seg of theme.segments || []) {
    if (typeof seg.when === 'function' && !seg.when(data, ctx)) continue;
    const r = renderSegment(seg, data, ctx);
    if (r) segs.push(r);
  }
  if (segs.length === 0) return '';

  // 2. 决定分行
  let lines;
  if (Array.isArray(theme.wrap)) {
    // 显式分行：既支持下标数组，也支持直接给渲染好的段
    if (theme.wrap.every((g) => Array.isArray(g) && g.every((x) => typeof x === 'number'))) {
      lines = theme.wrap.map((idx) => idx.map((i) => segs[i]).filter(Boolean)).filter((l) => l.length);
    } else {
      lines = [segs];
    }
  } else if (theme.wrap === 'auto') {
    lines = wrapSegments(segs, separator, opts.width);
  } else {
    lines = [segs];
  }

  // 3. 拼字符串
  if (theme.powerline) return renderPowerline(lines, theme);

  return lines
    .map((line) => line.map((s) => s.text).join(sepText))
    .join('\n');
}

module.exports = { render, wrapSegments, renderSegment, displayWidth, stripAnsi };

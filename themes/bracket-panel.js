'use strict';
/**
 * bracket-panel —— 方括号分段 + 多行信息面板风格
 *
 *  [ 🔵 deepseek-v4-pro[1m] ] - [ v2.1.177 ] - [ ⚡ max ] - [ Thinking ] - [ 🌿 master +3 ✖9 ?6 ] - [ 🐍 Env: base 3.13.9 ] - [ ⏱ 你已经工作了:00小时 03分钟 52秒 ]
 *  [ 晚上好 ] - [ Matri@~\Desktop\ODPlatform-stu ] - [ 2026-06-13 20:31:28 ]
 *  [ 📝 CTX 0%·100% Fresh ] - [ Size: 1M ] - [ In: 0 Out: 0 ] - [ Crt: 0 Rd: 0 ] - [ ⌨ Claude酱正在努力工作中 (｀・ω・´) ]
 *
 * 固定三行，不随终端宽度变化。
 * ⚠ 所有中文 / 日式文案都在下面的 TEXTS 里，改文案只动这一块，不用碰段定义。
 * ⚠ CPU / RAM / Disk 三段已留好位置但值为 null 会自动隐藏，
 *    实现方法见 lib/sysinfo.js，实现后这三段会自动出现，本文件不用改。
 */

const { paint } = require('../lib/palette');

// ═══════════════════════════════════════════════════════════════════
//  文案配置 —— 想改说法改这里
// ═══════════════════════════════════════════════════════════════════
const TEXTS = {
  // 按小时区间取问候语，[起始小时, 文案]
  greetings: [
    [0, '夜深了'],
    [5, '早上好'],
    [9, '上午好'],
    [12, '中午好'],
    [14, '下午好'],
    [18, '晚上好'],
  ],

  thinking: 'Thinking', // 开启思考时显示的词（也可以换成「思考中」）
  working: 'Claude酱正在努力工作中 (｀・ω・´)', // 末尾状态文案

  // 工作时长，参数是 时 / 分 / 秒
  duration: (h, m, s) => `你已经工作了:${pad(h)}小时 ${pad(m)}分钟 ${pad(s)}秒`,

  // git 三个计数的前缀符号
  gitMarks: { staged: '+', modified: '✖', untracked: '?' },

  labels: {
    env: 'Env:', // Python 环境
    size: 'Size:', // 上下文窗口
  },
};

function pad(n) {
  return String(n).padStart(2, '0');
}

// ═══════════════════════════════════════════════════════════════════
//  颜色
// ═══════════════════════════════════════════════════════════════════
const C = {
  bracket: 'brightBlack', // 方括号和分隔符
  model: 'brightCyan',
  version: 'brightBlack',
  effort: 'brightYellow',
  thinking: 'brightMagenta',
  branch: 'brightGreen',
  gitMark: 'brightYellow',
  env: 'brightYellow',
  duration: 'brightWhite',
  greeting: 'brightGreen',
  path: 'brightCyan',
  ctxLabel: 'brightWhite',
  ctxValue: 'brightCyan',
  size: 'brightMagenta',
  tokens: 'brightWhite',
  cache: 'brightGreen',
  status: 'brightYellow',
};

// 每一段外面套的方括号。用 paint 上色，不然它们会是终端默认色。
const OPEN = paint(C.bracket, '[') + ' ';
const CLOSE = ' ' + paint(C.bracket, ']');

// ── 小工具 ──────────────────────────────────────────────────────────

/**
 * 按当前小时取问候语：找区间起点 <= 当前小时的最后一条。
 *
 * 注意先复制一份按小时升序排 —— 判定用的是「最后一条命中的胜出」，
 * 如果 TEXTS.greetings 的条目不是升序，就会静默取到错误的文案（不报错，只是显示不对）。
 * 排一下之后，你在那个数组里随便插一条、放哪个位置都不会算错。
 */
function greeting(hour) {
  const buckets = [...TEXTS.greetings].sort((a, b) => a[0] - b[0]);
  let text = buckets.length ? buckets[0][1] : '';
  for (const [from, t] of buckets) {
    if (hour >= from) text = t;
  }
  return text;
}

/**
 * 含缓存的输入总量 = 未缓存输入 + 缓存写入 + 缓存读取。
 * 只显示 tokens.in 会让人误以为上下文只有几 k —— 实际上绝大部分走了缓存。
 */
function totalInput(d) {
  return d.tokens.in + (d.tokens.cacheCreation || 0) + (d.tokens.cacheRead || 0);
}

/**
 * 缓存命中率 = 缓存读取 / 输入总量。
 * 值得盯的指标：DeepSeek 缓存命中 $0.145/M，未命中 $1.74/M，差 12 倍。
 * 拿不到 token 细分时（transcript 读不到）返回 null，整段隐藏 ——
 * 这种情况算出来的命中率是假的。
 */
function cacheHitRate(d) {
  if (!d.tokens.exact) return null;
  const total = totalInput(d);
  if (total <= 0) return null;
  return d.tokens.cacheRead / total;
}

/** 把毫秒拆成 时/分/秒 */
function splitDuration(ms) {
  const total = Math.max(0, Math.floor((ms || 0) / 1000));
  return {
    h: Math.floor(total / 3600),
    m: Math.floor((total % 3600) / 60),
    s: total % 60,
  };
}

/**
 * git 计数拼接，为 0 的不显示。
 * 返回值不加前导空格 —— 引擎拼 suffix 时会自己补一个，
 * 这里再加就会变成两个空格（之前就是这样）。
 */
function gitCounts(d) {
  const g = d.git;
  const m = TEXTS.gitMarks;
  const out = [];
  if (g.staged) out.push(paint(C.gitMark, `${m.staged}${g.staged}`));
  if (g.modified) out.push(paint(C.gitMark, `${m.modified}${g.modified}`));
  if (g.untracked) out.push(paint(C.gitMark, `${m.untracked}${g.untracked}`));
  return out.join(' ');
}

// ═══════════════════════════════════════════════════════════════════
//  段定义
// ═══════════════════════════════════════════════════════════════════
module.exports = {
  name: 'bracket-panel',
  description: '方括号分段 + 三行信息面板（固定三行，含时长/环境/缓存状态）',

  separator: ' - ',
  separatorColor: C.bracket,
  segmentPrefix: OPEN,
  segmentSuffix: CLOSE,

  // 固定三行。下标对应下面 segments 的位置；
  // 被 when 隐藏的段会在渲染后过滤掉，不会让后面的段串位。
  wrap: [
    [0, 1, 2, 3, 4, 5, 6], // 第一行
    [7, 8, 9, 10, 11], // 第二行（9/10/11 是 CPU/RAM/Disk，默认隐藏）
    [12, 13, 14, 15, 16], // 第三行
  ],

  segments: [
    // ── 第一行 ────────────────────────────────────────────────────
    // 0 模型。用 raw 而不是 name —— 像 deepseek-v4-pro[1m] 这种带 [1m] 后缀的
    //   名字是有意义的（告诉 Claude Code 上下文是 1M），不能被 prettyModel 改掉。
    {
      when: (d) => !!d.model.raw,
      icon: '🔵',
      iconColor: C.model,
      parts: [{ text: (d) => d.model.raw, color: C.model }],
    },

    // 1 Claude Code 版本
    {
      when: (d) => !!d.version,
      icon: '📦',
      iconColor: C.version,
      parts: [{ text: (d) => `v${d.version}`, color: C.version }],
    },

    // 2 推理强度
    {
      when: (d) => !!d.effort,
      icon: '⚡',
      iconColor: C.effort,
      parts: [{ text: (d) => d.effort, color: C.effort }],
    },

    // 3 思考开关
    {
      when: (d) => d.thinking,
      icon: '🧠',
      iconColor: C.thinking,
      parts: [{ text: () => TEXTS.thinking, color: C.thinking }],
    },

    // 4 git 分支 + 三个计数
    {
      when: (d) => !!(d.git && d.git.branch),
      icon: '🌿',
      iconColor: C.branch,
      parts: [{ text: (d) => d.git.branch, color: C.branch }],
      suffix: (d) => gitCounts(d),
    },

    // 5 Python 虚拟环境（没在用 conda/venv 时自动隐藏）
    {
      when: (d) => !!(d.python && d.python.name),
      icon: '🐍',
      iconColor: C.env,
      parts: [
        { text: () => TEXTS.labels.env, color: C.env },
        { text: (d) => [d.python.name, d.python.version].filter(Boolean).join(' '), color: C.env },
      ],
    },

    // 6 已工作时长
    {
      when: (d) => d.cost.durationMs > 0,
      icon: '⏱',
      iconColor: C.duration,
      parts: [{ text: (d) => TEXTS.duration(...Object.values(splitDuration(d.cost.durationMs))), color: C.duration }],
    },

    // ── 第二行 ────────────────────────────────────────────────────
    // 7 时间问候
    {
      parts: [{ text: (d) => greeting(d.now.hour), color: C.greeting }],
    },

    // 8 用户名 @ 缩写路径
    {
      when: (d) => !!d.user,
      parts: [{ text: (d) => `${d.user}@${d.path}`, color: C.path }],
    },

    // 9 / 10 / 11 —— CPU / RAM / Disk，位置先留着。
    //    lib/sysinfo.js 现在一律返回 null，所以这三段会自动隐藏。
    //    按那里的说明实现后它们会自动出现，本文件一个字都不用改。
    {
      when: (d) => !!(d.system && d.system.cpu),
      icon: '🔥',
      iconColor: C.ctxValue,
      parts: [
        { text: () => 'CPU:', color: C.ctxLabel },
        { text: (d) => `${d.system.cpu.percent}%`, color: C.ctxValue },
      ],
    },
    {
      when: (d) => !!(d.system && d.system.ram),
      icon: '🧮',
      iconColor: C.ctxValue,
      parts: [
        { text: () => 'RAM:', color: C.ctxLabel },
        { text: (d) => d.system.ram.text, color: C.ctxValue },
      ],
    },
    {
      when: (d) => !!(d.system && d.system.disk),
      icon: '💾',
      iconColor: C.ctxValue,
      parts: [
        { text: () => 'Disk:', color: C.ctxLabel },
        { text: (d) => d.system.disk.text, color: C.ctxValue },
      ],
    },

    // ── 第三行 ────────────────────────────────────────────────────
    // 12 上下文占用。只显示已用百分比 —— 之前写成 "9%·91% Warm"，
    //    剩余百分比是 100 减出来的、缓存状态另有所指，三样挤在一起太冗杂。
    {
      icon: '📝',
      iconColor: C.ctxLabel,
      when: (d) => d.context.usedPct !== null,
      innerSep: ' ',
      parts: [
        { text: () => 'CTX', color: C.ctxLabel },
        { text: (d) => `${Math.round(d.context.usedPct)}%`, color: C.ctxValue },
      ],
    },

    // 13 上下文窗口大小
    {
      when: (d) => !!d.model.window,
      icon: '📐',
      iconColor: C.size,
      parts: [
        { text: () => TEXTS.labels.size, color: C.size },
        { text: (d) => d.model.window, color: C.size },
      ],
    },

    // 14 输入 / 输出 token
    //    In 显示的是**含缓存的输入总量**，不是 tokens.in 那一个字段 ——
    //    tokens.in 只是未命中缓存的部分，单独显示会小得让人误判上下文。
    {
      when: (d) => totalInput(d) > 0 || d.tokens.out > 0,
      icon: '📥',
      iconColor: C.tokens,
      innerSep: ' ',
      parts: [
        { text: (d) => `In: ${d.fmt.tokens(totalInput(d))}`, color: C.tokens },
        { text: (d) => `Out: ${d.fmt.tokens(d.tokens.out)}`, color: C.tokens },
      ],
    },

    // 15 缓存命中率。拿不到 token 细分时整段隐藏 —— 那种情况下算出来的是假值。
    {
      when: (d) => cacheHitRate(d) !== null,
      icon: '🗄',
      iconColor: C.cache,
      parts: [
        { text: () => 'Cache:', color: C.cache },
        { text: (d) => `${Math.round(cacheHitRate(d) * 100)}%`, color: C.cache },
      ],
    },

    // 16 状态文案
    {
      icon: '⌨',
      iconColor: C.status,
      parts: [{ text: () => TEXTS.working, color: C.status }],
    },
  ],
};

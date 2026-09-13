'use strict';
/**
 * 调色板：把颜色名翻译成 ANSI 序列。
 *
 * 主题里请用**颜色名**（'brightCyan'、'dim' …），不要写裸转义序列，
 * 这样换终端主题时只改这一个文件就行。
 *
 * 三种写法都支持：
 *   paint('brightCyan', 'x')   // 内置名字
 *   paint('38;5;213', 'x')     // 256 色
 *   paint('\x1b[38;2;255;0;0m', 'x')  // 直接给 ANSI
 */

const NAMED = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[90m',

  black: '\x1b[30m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',

  brightRed: '\x1b[91m',
  brightGreen: '\x1b[92m',
  brightYellow: '\x1b[93m',
  brightBlue: '\x1b[94m',
  brightMagenta: '\x1b[95m',
  brightCyan: '\x1b[96m',
  brightWhite: '\x1b[97m',

  // 背景色（powerline 主题用）
  bgBlack: '\x1b[40m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgBlue: '\x1b[44m',
  bgMagenta: '\x1b[45m',
  bgCyan: '\x1b[46m',
  bgWhite: '\x1b[47m',
  bgBrightBlack: '\x1b[100m',
  bgBrightRed: '\x1b[101m',
  bgBrightGreen: '\x1b[102m',
  bgBrightYellow: '\x1b[103m',
  bgBrightBlue: '\x1b[104m',
  bgBrightMagenta: '\x1b[105m',
  bgBrightCyan: '\x1b[106m',
  bgBrightWhite: '\x1b[107m',
};

const RESET = NAMED.reset;

/** 把颜色名解析成 ANSI 前缀；解析不出来返回 null（表示不上色） */
function code(color) {
  if (!color || typeof color !== 'string') return null;
  if (color.startsWith('\x1b')) return color; // 已经是 ANSI
  if (/^\d+(;\d+)*$/.test(color)) return `\x1b[${color}m`; // 256 色 / 组合属性
  return NAMED[color] ?? null;
}

/** 给文本上色。color 为空或未知则原样返回 */
function paint(color, text) {
  if (text === null || text === undefined) return '';
  const s = String(text);
  if (s === '') return '';
  const c = code(color);
  if (!c) return s;
  return `${c}${s}${RESET}`;
}

/** 去掉字符串里的 ANSI 序列（算显示宽度前必须调用） */
function stripAnsi(s) {
  // eslint-disable-next-line no-control-regex
  return String(s).replace(/\x1b\[[0-9;]*m/g, '');
}

module.exports = { NAMED, RESET, code, paint, stripAnsi };

'use strict';
/**
 * 主题的查找 / 校验 / 读写。
 *
 * 之前这段逻辑在 render.js 和 switch.js 里各写了一份，结果两边对「没有 active
 * 文件时用哪个主题」的说法不一致：render.js 兜底成 DEFAULT_THEME 正常渲染，
 * switch.js 却显示 "(未设置)"。新克隆的用户因此会以为坏了。
 * 现在统一收在这里，两边都调它。
 */

const fs = require('fs');
const path = require('path');

const SELF_DIR = path.join(__dirname, '..');
const THEMES_DIR = path.join(SELF_DIR, 'themes');
const ACTIVE_FILE = path.join(SELF_DIR, 'active');
const DEFAULT_THEME = 'emoji-line';

/** 只允许安全的名字，挡住 ../ 之类跑出 themes 目录 */
function safeName(name) {
  return typeof name === 'string' && /^[a-z0-9][a-z0-9-]*$/i.test(name) ? name : null;
}

function listThemes() {
  try {
    return fs
      .readdirSync(THEMES_DIR)
      .filter((f) => f.endsWith('.js'))
      .map((f) => f.replace(/\.js$/, ''))
      .sort();
  } catch {
    return [];
  }
}

function themeExists(name) {
  const n = safeName(name);
  return !!n && listThemes().includes(n);
}

/** active 文件的原始内容；文件不存在或内容不合法都返回 null */
function readActiveTheme() {
  try {
    return safeName(fs.readFileSync(ACTIVE_FILE, 'utf8').trim());
  } catch {
    return null;
  }
}

function writeActiveTheme(name) {
  const n = safeName(name);
  if (!n) throw new Error(`主题名不合法: ${name}`);
  fs.mkdirSync(SELF_DIR, { recursive: true });
  fs.writeFileSync(ACTIVE_FILE, n + '\n');
}

/**
 * 解析出真正生效的主题，并说明依据 —— 这是全项目唯一的裁决点。
 *
 *   { name, reason }
 *     reason: 'active'    —— active 文件指定且存在
 *             'default'   —— 没有 active 文件，用默认主题
 *             'fallback'  —— active 文件里的主题不存在，退回默认（带 requested）
 */
function resolveActiveTheme() {
  const requested = readActiveTheme();

  if (!requested) {
    return { name: DEFAULT_THEME, reason: 'default' };
  }
  if (themeExists(requested)) {
    return { name: requested, reason: 'active' };
  }
  // 文件里写了个不存在的主题（名字打错、或者主题被删了）
  return { name: DEFAULT_THEME, reason: 'fallback', requested };
}

/**
 * 加载主题模块。任何失败都静默降级到默认主题 ——
 * 绝不往 stderr 写东西（多行报错可能漏进状态栏显示），也绝不返回空，
 * 否则状态栏会整块消失。
 */
function loadTheme(name) {
  const tryLoad = (n) => {
    if (!themeExists(n)) return null;
    try {
      const theme = require(path.join(THEMES_DIR, `${n}.js`));
      if (theme && Array.isArray(theme.segments)) return theme;
    } catch {}
    return null;
  };
  const n = safeName(name);
  if (n && n !== DEFAULT_THEME) {
    const t = tryLoad(n);
    if (t) return t;
  }
  return tryLoad(DEFAULT_THEME) || {
    name: 'fallback',
    segments: [{ parts: [{ text: (d) => d.model.name, color: 'brightCyan' }] }],
  };
}

function describeTheme(name) {
  try {
    return require(path.join(THEMES_DIR, `${safeName(name)}.js`)).description || '';
  } catch {
    return '';
  }
}

module.exports = {
  SELF_DIR,
  THEMES_DIR,
  ACTIVE_FILE,
  DEFAULT_THEME,
  safeName,
  listThemes,
  themeExists,
  readActiveTheme,
  writeActiveTheme,
  resolveActiveTheme,
  loadTheme,
  describeTheme,
};

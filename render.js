#!/usr/bin/env node
'use strict';
/**
 * 状态栏入口。Claude Code 通过 stdin 传入 JSON，这里输出（可能多行的）带色文本。
 *
 *   node render.js                  # 用 active 文件里指定的主题
 *   node render.js --theme=minimal  # 临时指定主题
 *   node render.js --list           # 列出所有主题
 *   node render.js --width=100      # 临时指定终端宽度（调试折行用）
 *
 * 换主题请用 switch.js，不要改 settings.json。
 */

const fs = require('fs');
const path = require('path');

const { SELF_DIR, buildData, readCache, writeCache } = require('./lib/data');
const { getTerminalWidth } = require('./lib/width');
const engine = require('./lib/engine');

const THEMES_DIR = path.join(SELF_DIR, 'themes');
const ACTIVE_FILE = path.join(SELF_DIR, 'active');
const DEFAULT_THEME = 'emoji-line';

/** 只允许安全的名字，避免 ../ 之类跑出 themes 目录 */
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

function activeThemeName() {
  try {
    const n = safeName(fs.readFileSync(ACTIVE_FILE, 'utf8').trim());
    if (n) return n;
  } catch {}
  return DEFAULT_THEME;
}

function tryLoad(name) {
  try {
    const theme = require(path.join(THEMES_DIR, `${name}.js`));
    if (theme && Array.isArray(theme.segments)) return theme;
  } catch {}
  return null;
}

/**
 * 加载主题。任何一步失败都**静默**降级到默认主题 ——
 * 这里绝不能往 stderr 写东西（多行报错可能漏进状态栏显示），
 * 也绝不能返回空，否则状态栏会整块消失。
 */
function loadTheme(name) {
  const n = safeName(name); // 名字不合法（含 ../ 等）直接当作没指定
  if (n && n !== DEFAULT_THEME) {
    const theme = tryLoad(n);
    if (theme) return theme;
  }
  return tryLoad(DEFAULT_THEME) || {
    name: 'fallback',
    segments: [{ parts: [{ text: (d) => d.model.name, color: 'brightCyan' }] }],
  };
}

function parseArgs(argv) {
  const out = { theme: null, width: null, preview: false, list: false };
  for (const a of argv) {
    if (a === '--list') out.list = true;
    else if (a === '--preview') out.preview = true;
    else if (a.startsWith('--theme=')) out.theme = a.slice(8);
    else if (a.startsWith('--width=')) out.width = parseInt(a.slice(8), 10);
  }
  return out;
}

function readStdin() {
  try {
    const raw = fs.readFileSync(0, 'utf8');
    if (raw && raw.trim()) return JSON.parse(raw);
  } catch {}
  return {};
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.list) {
    const active = activeThemeName();
    for (const n of listThemes()) {
      let desc = '';
      try {
        desc = require(path.join(THEMES_DIR, `${n}.js`)).description || '';
      } catch {}
      process.stdout.write(`${n === active ? '*' : ' '} ${n}${desc ? `  — ${desc}` : ''}\n`);
    }
    return;
  }

  const themeName = args.theme || activeThemeName();
  const theme = loadTheme(themeName);

  let payload;
  if (args.preview) {
    try {
      payload = require('./fixture').payload();
    } catch {
      payload = {};
    }
  } else {
    payload = readStdin();
  }

  const cache = readCache();
  let data;
  try {
    data = buildData(payload, cache);
  } catch (err) {
    process.stdout.write(`statusline: 数据解析失败 ${err.message}`);
    return;
  }

  // 宽度：命令行 > 环境变量 > 探测
  const width = Number.isFinite(args.width) ? args.width : getTerminalWidth(cache, 20000);
  writeCache(cache);

  try {
    const out = engine.render(theme, data, { width });
    process.stdout.write(out);
  } catch (err) {
    process.stdout.write(`statusline: 渲染失败 ${err.message}`);
  }
}

main();

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

const { buildData, readCache, writeCache } = require('./lib/data');
const { getTerminalWidth } = require('./lib/width');
const themes = require('./lib/themes');
const engine = require('./lib/engine');

function parseArgs(argv) {
  const out = { theme: null, width: null, preview: false, list: false };
  for (const a of argv) {
    if (a === '--list') out.list = true;
    else if (a === '--preview') out.preview = true;
    else if (a.startsWith('--theme=')) out.theme = a.slice('--theme='.length);
    else if (a.startsWith('--width=')) out.width = parseInt(a.slice('--width='.length), 10);
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
    const { name: current } = themes.resolveActiveTheme();
    for (const n of themes.listThemes()) {
      const desc = themes.describeTheme(n);
      process.stdout.write(`${n === current ? '*' : ' '} ${n}${desc ? `  — ${desc}` : ''}\n`);
    }
    return;
  }

  const { name: themeName } = themes.resolveActiveTheme();
  const theme = themes.loadTheme(args.theme || themeName);

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

  // 宽度：命令行 > 环境变量 > 探测。
  // TTL 给 60 秒 —— 终端宽度几乎不变，而探测一次要 78ms（cmd /c mode con）。
  // 代价是拖拽改变终端宽度后，折行最多 60 秒才跟上。
  // 想彻底免掉这个开销，设 CLAUDE_STATUSLINE_WIDTH 写死宽度即可。
  const width = Number.isFinite(args.width) ? args.width : getTerminalWidth(cache, 60000);
  writeCache(cache);

  try {
    process.stdout.write(engine.render(theme, data, { width }));
  } catch (err) {
    process.stdout.write(`statusline: 渲染失败 ${err.message}`);
  }
}

main();

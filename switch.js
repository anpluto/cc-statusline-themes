#!/usr/bin/env node
'use strict';
/**
 * 主题切换器。
 *
 *   node switch.js                 # 看当前主题 + 所有可选主题
 *   node switch.js minimal         # 切到 minimal
 *   node switch.js --preview       # 用假数据预览当前主题
 *   node switch.js minimal --preview
 *
 * 切换只写 ~/.claude/statusline/active 这一个文件，
 * 不用改 settings.json，也不用重启 Claude Code（下一个刷新周期就生效）。
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const SELF_DIR = __dirname;
const THEMES_DIR = path.join(SELF_DIR, 'themes');
const ACTIVE_FILE = path.join(SELF_DIR, 'active');
const RENDER = path.join(SELF_DIR, 'render.js');

function themes() {
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

function active() {
  try {
    return fs.readFileSync(ACTIVE_FILE, 'utf8').trim();
  } catch {
    return '(未设置)';
  }
}

function describe(name) {
  try {
    const t = require(path.join(THEMES_DIR, `${name}.js`));
    return t.description || '';
  } catch {
    return '';
  }
}

function preview(name, width) {
  const args = ['--preview', `--theme=${name}`];
  if (width) args.push(`--width=${width}`);
  try {
    return execFileSync(process.execPath, [RENDER, ...args], {
      encoding: 'utf8',
      timeout: 5000,
    });
  } catch (err) {
    return `(预览失败: ${err.message})`;
  }
}

/** 列出所有主题，每个都带实际渲染效果，方便直接挑 */
function listWithPreviews(width, compact) {
  const all = themes();
  const current = active();

  console.log(`当前主题: ${current}\n`);
  for (const t of all) {
    const mark = t === current ? '→' : ' ';
    const tag = t === current ? '  (当前)' : '';
    console.log(`${mark} ${t}${tag}`);
    if (describe(t)) console.log(`    ${describe(t)}`);
    if (!compact) console.log(`    ${preview(t, width).replace(/\n/g, '\n    ')}`);
    console.log('');
  }
  console.log('切换:  node switch.js <主题名>');
}

function main() {
  const argv = process.argv.slice(2);
  const compact = argv.includes('--list'); // 只要名单，不要预览
  const wantPreview = argv.includes('--preview');
  const widthArg = argv.find((a) => a.startsWith('--width='));
  const width = widthArg ? parseInt(widthArg.slice(8), 10) : null;
  const name = argv.find((a) => !a.startsWith('--'));

  const all = themes();
  const current = active();

  // 不带参数（或者 --list / --preview）：列出所有主题
  if (!name) {
    if (wantPreview) {
      console.log(preview(current, width));
    } else {
      listWithPreviews(width, compact);
    }
    return;
  }

  if (!all.includes(name)) {
    console.error(`没有主题 "${name}"。可用: ${all.join(', ')}`);
    process.exit(1);
  }

  fs.writeFileSync(ACTIVE_FILE, name + '\n');
  console.log(`已切换到主题: ${name}\n`);
  console.log(preview(name, width));
}

main();

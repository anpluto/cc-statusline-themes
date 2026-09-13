#!/usr/bin/env node
'use strict';
/**
 * 交互式主题选择器 —— 上下箭头选，回车确认。
 *
 *   node pick.js          # 在终端里交互选择
 *   node pick.js --list   # 非交互，直接列出来（和 switch.js --list 一样）
 *
 * 为什么单独做这个：让 Claude 来切主题，一次要花掉两三千输出 token
 * （实测约 87% 是模型自己的推理和文字，不是数据），而且有延迟。
 * 这个脚本在你自己的终端里跑，**零 token、零延迟**。
 *
 * 通过 Claude Code 的 `!` 前缀跑不了 —— 那里 stdin 不是 TTY，收不到方向键。
 * 请在普通终端窗口里跑，或者在 Claude Code 里跑不带参数的版本看列表。
 *
 * 不是 TTY 时（被管道接走、被 `!` 调用）自动降级成直接打印列表，
 * 所以 Claude 那边调它也不会卡住。
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const themes = require('./lib/themes');

const RENDER = path.join(__dirname, 'render.js');

function preview(name) {
  try {
    return execFileSync(process.execPath, [RENDER, '--preview', `--theme=${name}`], {
      encoding: 'utf8',
      timeout: 10000,
    }).replace(/\s+$/, '');
  } catch {
    return '  (预览失败)';
  }
}

function plainList() {
  const current = themes.resolveActiveTheme().name;
  for (const t of themes.listThemes()) {
    const desc = themes.describeTheme(t);
    process.stdout.write(`${t === current ? '*' : ' '} ${t}${desc ? `  — ${desc}` : ''}\n`);
  }
}

function interactive() {
  const all = themes.listThemes();
  if (all.length === 0) {
    process.stderr.write('没有找到任何主题。\n');
    return 1;
  }

  const current = themes.resolveActiveTheme().name;
  let index = Math.max(0, all.indexOf(current));
  let drawn = 0; // 上次画了多少行，用于擦除
  let previewCache = {};

  const out = process.stdout;
  const stdin = process.stdin;

  function render() {
    // 光标回到上次绘制的起点并清屏
    if (drawn > 0) out.write(`\x1b[${drawn}A\x1b[0J`);

    const lines = [];
    lines.push('\x1b[1m选择状态栏主题\x1b[0m   ↑/↓ 移动 · Enter 确认 · Esc 取消\n');

    for (let i = 0; i < all.length; i++) {
      const t = all[i];
      const selected = i === index;
      const desc = themes.describeTheme(t);
      const tag = t === current ? ' \x1b[90m(当前)\x1b[0m' : '';
      const label = `${t}${tag}`;
      // 选中项用反显，一眼能看出光标在哪
      lines.push(selected ? `\x1b[7m ❯ ${label} \x1b[0m` : `   ${label}`);
      if (desc) lines.push(`     \x1b[90m${desc}\x1b[0m`);
    }

    const name = all[index];
    if (!(name in previewCache)) previewCache[name] = preview(name);
    lines.push('');
    lines.push('\x1b[90m── 预览 ─────────────────────────────────\x1b[0m');
    for (const l of previewCache[name].split('\n')) lines.push(`  ${l}`);

    const text = lines.join('\n') + '\n';
    out.write(text);
    drawn = text.split('\n').length - 1;
  }

  function cleanup() {
    if (drawn > 0) out.write(`\x1b[${drawn}A\x1b[0J`);
    out.write('\x1b[?25h'); // 恢复光标
    if (stdin.isTTY) stdin.setRawMode(false);
    stdin.pause();
  }

  out.write('\x1b[?25l'); // 隐藏光标
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding('utf8');

  render();

  return new Promise((resolve) => {
    stdin.on('data', (key) => {
      // 方向键在大多数终端里是 ESC [ A / ESC [ B
      if (key === '\x1b[A' || key === 'k') {
        index = (index - 1 + all.length) % all.length;
        render();
      } else if (key === '\x1b[B' || key === 'j') {
        index = (index + 1) % all.length;
        render();
      } else if (key === '\r' || key === '\n') {
        const chosen = all[index];
        cleanup();
        themes.writeActiveTheme(chosen);
        process.stdout.write(`\n已切换到主题: \x1b[1m${chosen}\x1b[0m\n`);
        resolve(0);
      } else if (key === '\x1b' || key === 'q' || key === '\x03') {
        cleanup();
        process.stdout.write('\n已取消，主题未改变。\n');
        resolve(0);
      }
    });
  });
}

async function main() {
  const argv = process.argv.slice(2);
  // 不是 TTY（被管道接走 / 被 Claude Code 的 ! 调用）就退化成列表，
  // 否则 setRawMode 会直接抛错
  if (argv.includes('--list') || !process.stdin.isTTY || !process.stdout.isTTY) {
    plainList();
    return 0;
  }
  return interactive();
}

main().then((code) => process.exit(code));

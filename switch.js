#!/usr/bin/env node
'use strict';
/**
 * 主题切换器。
 *
 *   node switch.js                 # 列出所有主题 + 每个的实际渲染效果
 *   node switch.js --list          # 只要名单，不要预览
 *   node switch.js minimal         # 切到 minimal
 *   node switch.js --preview       # 只预览当前主题
 *
 * 切换只写 active 这一个文件，不用改 settings.json，也不用重启 Claude Code
 * （主动指定主题时下一个刷新周期生效）。active 被 gitignore 掉了，所以
 * 别人 clone 下来没有这个文件是正常的 —— resolveActiveTheme() 会兜底到默认主题。
 */

const { execFileSync } = require('child_process');
const path = require('path');

const themes = require('./lib/themes');

const RENDER = path.join(__dirname, 'render.js');

/** 用假数据渲染某个主题，拿到它的实际样子 */
function preview(name, width) {
  const args = ['--preview', `--theme=${name}`];
  if (width) args.push(`--width=${width}`);
  try {
    return execFileSync(process.execPath, [RENDER, ...args], {
      encoding: 'utf8',
      timeout: 10000,
    });
  } catch (err) {
    return `(预览失败: ${err.message})`;
  }
}

/** 把当前生效状态描述成一句话，说清楚依据 */
function currentLabel() {
  const { name, reason, requested } = themes.resolveActiveTheme();
  if (reason === 'active') return { name, text: `当前主题: ${name}` };
  if (reason === 'default') {
    return { name, text: `当前主题: ${name}（默认；还没有 active 文件）` };
  }
  return {
    name,
    text: `当前主题: ${name}（默认；active 里写的 "${requested}" 不存在）`,
  };
}

function listWithPreviews(width, compact) {
  const { name: current } = themes.resolveActiveTheme();
  const all = themes.listThemes();

  console.log(currentLabel().text + '\n');
  for (const t of all) {
    const isCurrent = t === current;
    console.log(`${isCurrent ? '→' : ' '} ${t}${isCurrent ? '  (当前)' : ''}`);
    const desc = themes.describeTheme(t);
    if (desc) console.log(`    ${desc}`);
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
  const width = widthArg ? parseInt(widthArg.slice('--width='.length), 10) : null;
  const name = argv.find((a) => !a.startsWith('--'));

  const all = themes.listThemes();

  if (!name) {
    if (wantPreview) {
      console.log(preview(themes.resolveActiveTheme().name, width));
    } else {
      listWithPreviews(width, compact);
    }
    return;
  }

  if (!all.includes(name)) {
    console.error(`没有主题 "${name}"。可用: ${all.join(', ')}`);
    process.exit(1);
  }

  themes.writeActiveTheme(name);
  console.log(`已切换到主题: ${name}\n`);
  console.log(preview(name, width));
}

main();

'use strict';
/**
 * pick.js 的交互逻辑测试。用完即删。
 *
 * 这里没有 TTY，所以伪造 process.stdin / process.stdout：
 *   - stdin 换成 PassThrough 并标记 isTTY（但保持 setRawMode 可用）
 *   - stdout 换成收集器，把画出来的内容存起来
 * 然后按顺序喂方向键，检查最终写到 active 的主题对不对。
 *
 * 跑之前会备份 active，跑完还原。
 */

const fs = require('fs');
const path = require('path');
const { PassThrough } = require('stream');

const DIR = __dirname;
const ACTIVE = path.join(DIR, 'active');
const backup = fs.existsSync(ACTIVE) ? fs.readFileSync(ACTIVE, 'utf8') : null;

const tick = () => new Promise((r) => setTimeout(r, 30));

async function run(keys, startTheme) {
  // 先把 active 设成指定起点
  fs.writeFileSync(ACTIVE, startTheme + '\n');

  const outChunks = [];
  const fakeIn = new PassThrough();
  fakeIn.isTTY = true;
  // 只需要让 setRawMode 变成空操作 —— 真实 TTY 上它才存在。
  // 注意**不要** stub resume/pause/setEncoding，否则流不流动，data 事件永远不来，
  // 测试会全部误判成「按键没反应」（第一版就是这么错的）。
  fakeIn.setRawMode = () => {};

  const fakeOut = {
    isTTY: true,
    write: (s) => {
      outChunks.push(String(s));
      return true;
    },
    columns: 120,
  };

  const realIn = process.stdin;
  const realOut = process.stdout;
  Object.defineProperty(process, 'stdin', { value: fakeIn, configurable: true });
  Object.defineProperty(process, 'stdout', { value: fakeOut, configurable: true });

  // 清掉 require 缓存，让 pick.js 重新执行
  delete require.cache[require.resolve('./pick.js')];

  const origExit = process.exit;
  process.exit = () => {};

  require('./pick.js');

  // 逐个喂按键；每次让事件循环转一圈，data 事件才会派发
  for (const k of keys) {
    fakeIn.write(k);
    await tick();
  }

  // 还原
  Object.defineProperty(process, 'stdin', { value: realIn, configurable: true });
  Object.defineProperty(process, 'stdout', { value: realOut, configurable: true });
  process.exit = origExit;

  const after = fs.readFileSync(ACTIVE, 'utf8').trim();
  const screen = outChunks.join('');
  return { after, screen };
}

const ALL = require('./lib/themes').listThemes();
console.log('可用主题:', ALL.join(', '));
console.log();

let pass = 0;
let fail = 0;
function check(label, got, want) {
  const ok = got === want;
  console.log(`${ok ? '✓' : '✗'} ${label}   得到 ${got}，期望 ${want}`);
  ok ? pass++ : fail++;
}

// 起点统一用第一个主题
const start = ALL[0];

(async () => {
  let r = await run(['\x1b[B', '\r'], start);
  check('按下箭头一次 → 第二个主题', r.after, ALL[1]);

  r = await run(['\x1b[B', '\x1b[B', '\r'], start);
  check('按下箭头两次 → 第三个主题', r.after, ALL[2]);

  r = await run(['\x1b[A', '\r'], start);
  check('在第一个按上箭头 → 回环到最后一个', r.after, ALL[ALL.length - 1]);

  r = await run(['\x1b[B', '\x1b[A', '\r'], start);
  check('下再上 → 回到起点', r.after, start);

  r = await run(['j', 'j', '\r'], start);
  check('j 键等效于下箭头', r.after, ALL[2]);

  r = await run(['\x1b[B', '\x1b'], start);
  check('Esc 取消 → 主题不变', r.after, start);

  r = await run(['\x1b[B', '\x03'], start);
  check('Ctrl+C 取消 → 主题不变', r.after, start);

  r = await run(['\r'], start);
  check('直接回车 → 保持当前', r.after, start);

  // 检查屏幕输出里确实做了重绘（有光标上移擦除序列）
  r = await run(['\x1b[B', '\x1b[B', '\r'], start);
  const redraws = (r.screen.match(/\x1b\[\d+A\x1b\[0J/g) || []).length;
  console.log(`${redraws >= 2 ? '✓' : '✗'} 每次按键都重绘（检测到 ${redraws} 次擦除序列）`);
  redraws >= 2 ? pass++ : fail++;

  // 检查预览确实渲染了
  const hasPreview = /── 预览/.test(r.screen);
  console.log(`${hasPreview ? '✓' : '✗'} 显示了预览区`);
  hasPreview ? pass++ : fail++;

  // 还原 active
  if (backup !== null) fs.writeFileSync(ACTIVE, backup);

  console.log(`\n${fail === 0 ? '全部通过' : '有失败'}：${pass} 通过 / ${fail} 失败`);
  console.log('active 已还原为:', fs.readFileSync(ACTIVE, 'utf8').trim());
})();

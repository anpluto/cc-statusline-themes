'use strict';
/**
 * 两类「宽度」：
 *   1. displayWidth(str)  —— 一段文字在终端里占几列（emoji / 中文算 2 列）
 *   2. getTerminalWidth() —— 终端总宽度有几列
 *
 * 关于第 2 点：状态栏是被 Claude Code 当子进程拉起来的，stdout 是管道，
 * 所以 process.stdout.columns 永远是 undefined。ccstatusline 在 Windows 上
 * 干脆放弃了（源码里直接 `if (process.platform === "win32") return null`）。
 *
 * 这里用 `cmd /c mode con` 探测，能拿到真实控制台宽度（实测 120）。
 * 代价约 130ms，所以结果会缓存；PowerShell 的写法要 1100ms，太慢，没用。
 */

const { execFileSync } = require('child_process');
const { stripAnsi } = require('./palette');

// 宽字符区段：CJK、全角、以及常见 emoji
function isWide(cp) {
  return (
    (cp >= 0x1100 && cp <= 0x115f) ||
    // 0x2600–0x26FF 里的 ⚡ ⚠ ☀ 等基本都是 emoji 呈现（占 2 列）；
    // 而 0x2700–0x27BF 的 ✓ ✔ ✗ ✘ 是文字呈现（占 1 列），所以不能一起算宽。
    (cp >= 0x2600 && cp <= 0x26ff) ||
    (cp >= 0x2e80 && cp <= 0x303e) ||
    (cp >= 0x3041 && cp <= 0x33ff) ||
    (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0x4e00 && cp <= 0x9fff) ||
    (cp >= 0xa000 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe6f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1f64f) ||
    (cp >= 0x1f680 && cp <= 0x1f6ff) ||
    (cp >= 0x1f900 && cp <= 0x1f9ff) ||
    (cp >= 0x1fa70 && cp <= 0x1faff) ||
    cp >= 0x20000
  );
}

/** 文字占几列（先剥 ANSI） */
function displayWidth(str) {
  let w = 0;
  for (const ch of stripAnsi(str)) {
    const cp = ch.codePointAt(0);
    // 变体选择符 FE0F 不占位
    if (cp === 0xfe0f || cp === 0x200d) continue;
    w += isWide(cp) ? 2 : 1;
  }
  return w;
}

/** 截断到 n 列，超出加省略号 */
function truncate(str, n) {
  if (displayWidth(str) <= n) return str;
  let out = '';
  let w = 0;
  for (const ch of stripAnsi(str)) {
    const cw = isWide(ch.codePointAt(0)) ? 2 : 1;
    if (w + cw > n - 1) break;
    out += ch;
    w += cw;
  }
  return out + '…';
}

/**
 * 探测真实控制台宽度。
 *
 * 解析 `mode con` 的输出。**不能取最后一个数字** —— 完整输出是：
 *     设备状态 CON:
 *     ---------
 *         行:        9001
 *         列:        120      ← 这个才是宽度
 *         键盘速度:   31
 *         键盘延迟:   1
 *         代码页:     936      ← 936 是 GBK 代码页，不是宽度
 * 所以显式匹配「列 / Columns」那一行；匹配不到再退回第 2 个整数
 * （前两个整数固定是「行、列」，与语言无关）。
 */
function probeConsoleWidth() {
  const ok = (n) => Number.isFinite(n) && n >= 20 && n <= 1000;

  if (process.platform !== 'win32') {
    // macOS / Linux：stdout 是管道时 tput cols 会失败，必须显式从控制终端读，
    // 所以统一用 `... < /dev/tty`。stty size 输出 "行 列"，取第二个数。
    const probes = [
      { bin: 'sh', args: ['-c', 'stty size < /dev/tty 2>/dev/null'] },
      { bin: 'sh', args: ['-c', 'tput cols < /dev/tty 2>/dev/null'] },
    ];
    for (const { bin, args } of probes) {
      try {
        const out = execFileSync(bin, args, {
          encoding: 'utf8',
          timeout: 800,
          stdio: ['ignore', 'pipe', 'ignore'],
        }).trim();
        const nums = (out.match(/\d+/g) || []).map((s) => parseInt(s, 10));
        // stty size 给 "24 120"，tput cols 只给 "120"
        const cols = nums.length >= 2 ? nums[1] : nums[0];
        if (ok(cols)) return cols;
      } catch {}
    }
    return null;
  }

  try {
    const out = execFileSync('cmd.exe', ['/c', 'mode', 'con'], {
      encoding: 'utf8',
      timeout: 1500,
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    });

    // 1) 显式匹配「列」或「Columns」那一行
    const line = out.match(/^[ \t]*(?:列|Columns?)[ \t]*[:：]?[ \t]*(\d+)[ \t]*$/im);
    if (line) {
      const n = parseInt(line[1], 10);
      if (ok(n)) return n;
    }

    // 2) 退回第 2 个整数（行、列 固定在前两位）
    const nums = (out.match(/\d+/g) || []).map((s) => parseInt(s, 10));
    if (nums.length >= 2 && ok(nums[1])) return nums[1];
  } catch {}
  return null;
}

/**
 * 取终端宽度。优先级：
 *   1. CLAUDE_STATUSLINE_WIDTH 环境变量（想固定就设它，零开销）
 *   2. process.stdout.columns（万一将来 Claude Code 给的是 tty）
 *   3. cache.width —— 上次探测结果且未过期
 *   4. 现场探测
 * 拿不到就返回 null，由调用方决定不折行。
 */
function getTerminalWidth(cache, ttlMs = 20000) {
  const override = parseInt(process.env.CLAUDE_STATUSLINE_WIDTH || '', 10);
  if (Number.isFinite(override) && override >= 20) return override;

  if (process.stdout.isTTY && process.stdout.columns) return process.stdout.columns;

  if (cache && typeof cache.width === 'number' && Date.now() - (cache.widthAt || 0) < ttlMs) {
    return cache.width;
  }

  const probed = probeConsoleWidth();
  if (cache && probed !== null) {
    cache.width = probed;
    cache.widthAt = Date.now();
  }
  return probed;
}

module.exports = { displayWidth, truncate, probeConsoleWidth, getTerminalWidth, isWide };

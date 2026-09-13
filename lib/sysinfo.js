'use strict';
/**
 * 系统信息（CPU / RAM / Disk）—— 占位模块。
 *
 * 参考截图第二行有 [CPU: 15%] [RAM:28/48G] [Disk: 178/519G]，目前**故意不实现**，
 * 一律返回 null，对应主题段会自动隐藏（主题里用 when 判断不为 null）。
 *
 * 想启用的话，按下面的说明实现，然后把 getSystemInfo 的返回值换掉即可 ——
 * 主题那边不用改。
 *
 * ── RAM（最简单，建议先做这个）──────────────────────────────
 *   const os = require('os');
 *   const total = os.totalmem();
 *   const used  = total - os.freemem();
 *   格式化成 "28/48G"。纯 Node 内置，无子进程，零开销。
 *   注意 os.freemem() 在 Linux 上是 "free" 而不是 "available"，
 *   会比 `free -h` 报的可用内存偏小，介意的话去读 /proc/meminfo 的 MemAvailable。
 *
 * ── Disk ─────────────────────────────────────────────────
 *   必须调系统命令，且各平台不同：
 *     win32 : wmic logicaldisk get size,freespace,caption   （wmic 已废弃）
 *             或 powershell -NoProfile -Command "Get-PSDrive -PSProvider FileSystem | ..."
 *     darwin: df -k /
 *     linux : df -k /
 *   实测这类调用要 100~500ms，**必须缓存**（塞进 .cache.json，TTL 建议 ≥ 60 秒），
 *   否则每次刷新都会卡。
 *
 * ── CPU ──────────────────────────────────────────────────
 *   最麻烦的一个。os.cpus() 返回的是各核**累计**的 user/nice/sys/idle 时间，
 *   要算使用率必须拿两个时间点的差值 —— 但状态栏每次刷新都是一个全新进程，
 *   进程内没法保留上一次的采样。所以只能：
 *     1. 把本次的 os.cpus() 快照（各核 times 之和）存进 .cache.json
 *     2. 下次刷新时读出来，和本次相减，除以时间间隔 × 核数
 *     3. 首次运行没有上一次采样，只能返回 null（这一段第一次会空着，下次刷新才出现）
 *   另外 Windows 上第一次读 os.cpus() 的开销比 Linux 大。
 */

/** 形状固定，主题按这个取字段；实现后把 null 换成真实值即可 */
function getSystemInfo() {
  return {
    cpu: null, // { percent: 15 }         -> [CPU: 15%]
    ram: null, // { usedBytes, totalBytes, text: '28/48G' }
    disk: null, // { usedBytes, totalBytes, text: '178/519G' }
  };
}

module.exports = { getSystemInfo };

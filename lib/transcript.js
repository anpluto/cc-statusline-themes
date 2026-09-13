'use strict';
/**
 * 从会话 transcript（.jsonl）里读出最后一次请求的 token 细分。
 *
 * 为什么需要它：statusline payload 里的 context_window 只给了
 *   total_input_tokens  = input + cache_creation + cache_read
 *   total_output_tokens = output
 * 加总后的值，拆不出「未缓存输入 / 缓存写入 / 缓存读取」三项。
 * 而 transcript 里每条 assistant 消息的 message.usage 四个字段都是全的：
 *   input_tokens, output_tokens,
 *   cache_creation_input_tokens, cache_read_input_tokens
 *
 * 性能：transcript 可以很大（几百 KB 到几 MB），而状态栏每 10 秒跑一次，
 * 所以只读**文件末尾**一小段，从后往前找第一条带 usage 的行。
 * 若末尾一小段里没有（极少见），再读一大段兜底。
 */

const fs = require('fs');

const SMALL_TAIL = 64 * 1024; // 常规情况够用
const BIG_TAIL = 2 * 1024 * 1024; // 兜底

/** 读文件末尾 n 字节，返回按行拆分的结果（首行可能是半截，调用方要丢掉） */
function readTail(file, n) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - n);
    const len = size - start;
    if (len <= 0) return { lines: [], truncated: false };

    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, start);
    const text = buf.toString('utf8');
    const lines = text.split('\n');
    // 只有从文件中间开始读时，第一行才是残缺的
    const truncated = start > 0;
    if (truncated) lines.shift();
    return { lines, truncated };
  } finally {
    fs.closeSync(fd);
  }
}

function emptyUsage() {
  return { input: 0, output: 0, cacheCreation: 0, cacheRead: 0, found: false };
}

/**
 * @param {string} file  transcript 路径
 * @returns {{input:number, output:number, cacheCreation:number, cacheRead:number, found:boolean}}
 */
function lastUsage(file) {
  if (!file) return emptyUsage();

  for (const size of [SMALL_TAIL, BIG_TAIL]) {
    let lines;
    try {
      ({ lines } = readTail(file, size));
    } catch {
      return emptyUsage();
    }

    // 从后往前找第一条带 usage 的 assistant 消息
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (!line || line.indexOf('"usage"') === -1) continue;
      try {
        const j = JSON.parse(line);
        const u = j?.message?.usage;
        if (!u) continue;
        return {
          input: u.input_tokens || 0,
          output: u.output_tokens || 0,
          cacheCreation: u.cache_creation_input_tokens || 0,
          cacheRead: u.cache_read_input_tokens || 0,
          found: true,
        };
      } catch {
        // 半截行 / 非法 JSON，继续往前找
      }
    }

    // 这次读的尾部没找到，扩大到 BIG_TAIL 再试一次
  }

  return emptyUsage();
}

module.exports = { lastUsage };

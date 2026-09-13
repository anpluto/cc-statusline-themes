'use strict';
/**
 * 测试用 payload —— 不想依赖真实会话就能预览主题。
 *
 *   node render.js --preview                  # 用当前主题渲染假数据
 *   node render.js --preview --theme=minimal
 *
 * transcript_path 指向一份**现场生成的**小 transcript（写在系统临时目录），
 * 这样 In/Out/Crt/Rd 那几个只有 transcript 才有的字段在预览里也能显示出来，
 * 顺便也算是对 lib/transcript.js 的一个测试。
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const FAKE_TRANSCRIPT = path.join(os.tmpdir(), 'ccstatusline-preview-transcript.jsonl');

/** 造一份最小可用的 transcript，最后一行带 usage */
function writeFakeTranscript() {
  const lines = [
    { type: 'user', message: { role: 'user', content: 'hello' } },
    {
      type: 'assistant',
      message: {
        role: 'assistant',
        model: 'deepseek-v4-pro',
        content: [{ type: 'text', text: 'hi' }],
        usage: {
          input_tokens: 2169,
          output_tokens: 2238,
          cache_creation_input_tokens: 4096,
          cache_read_input_tokens: 88320,
        },
      },
    },
  ];
  try {
    fs.writeFileSync(FAKE_TRANSCRIPT, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  } catch {}
  return FAKE_TRANSCRIPT;
}

function payload() {
  return {
    session_id: 'preview-session',
    transcript_path: writeFakeTranscript(),
    cwd: process.cwd(),
    model: { id: 'deepseek-v4-pro', display_name: 'deepseek-v4-pro' },
    workspace: {
      current_dir: process.cwd(),
      project_dir: process.cwd(),
      added_dirs: [],
    },
    version: '2.1.177',
    output_style: { name: 'default' },
    cost: {
      total_cost_usd: 0.0123,
      total_duration_ms: 232000, // 3 分 52 秒
      total_api_duration_ms: 2300,
      total_lines_added: 156,
      total_lines_removed: 23,
    },
    context_window: {
      total_input_tokens: 94585,
      total_output_tokens: 2238,
      context_window_size: 1000000,
      current_usage: null,
      used_percentage: 9.0,
      remaining_percentage: 91.0,
    },
    exceeds_200k_tokens: false,
    fast_mode: false,
    effort: { level: 'max' },
    thinking: { enabled: true },
    prompt_cache: {
      warm: true,
      caching_observed: true,
      ttl: 300,
      expires_at: null,
      requests: 12,
      misses: 1,
      expected_rebuilds: 0,
      hit_ratio: 0.92,
      cache_write_tokens: 4096,
      miss_recache_tokens: 0,
      last_miss_at: null,
      recache_tokens_if_cold: 0,
    },
  };
}

module.exports = { payload, FAKE_TRANSCRIPT };

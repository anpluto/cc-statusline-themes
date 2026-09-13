'use strict';
/**
 * 测试用 payload —— 不想依赖真实会话就能预览主题。
 *
 *   node render.js --preview                  # 用当前主题渲染假数据
 *   node render.js --preview --theme=minimal
 *
 * 想调假数据（比如试试超长模型名会不会折行），直接改下面返回值。
 */

const os = require('os');
const path = require('path');

function payload() {
  return {
    session_id: 'preview-session',
    transcript_path: path.join(os.homedir(), '.claude', 'projects', 'D--ClaudeCode', 'preview.jsonl'),
    cwd: process.cwd(),
    model: { id: 'deepseek-v4-pro', display_name: 'deepseek-v4-pro' },
    workspace: {
      current_dir: process.cwd(),
      project_dir: process.cwd(),
      added_dirs: [],
    },
    version: '2.1.270',
    output_style: { name: 'default' },
    cost: {
      total_cost_usd: 0.0123,
      total_duration_ms: 45000,
      total_api_duration_ms: 2300,
      total_lines_added: 156,
      total_lines_removed: 23,
    },
    context_window: {
      total_input_tokens: 180000,
      total_output_tokens: 9700,
      context_window_size: 1000000,
      current_usage: null,
      used_percentage: 19.0,
      remaining_percentage: 81.0,
    },
    exceeds_200k_tokens: false,
    fast_mode: false,
    effort: { level: 'max' },
    thinking: { enabled: true },
  };
}

module.exports = { payload };

'use strict';
/**
 * 数据层：把 Claude Code 的 stdin payload + 磁盘扫描结果，整理成一个
 * 干净的对象交给主题使用。主题只读这个对象的字段，不碰原始 payload。
 *
 * payload 字段是从 claude.exe (v2.1.270) 里挖出来的，形如：
 *   { session_id, transcript_path, cwd, model:{id,display_name},
 *     workspace:{current_dir,project_dir,added_dirs},
 *     version, output_style:{name},
 *     cost:{total_cost_usd,total_duration_ms,total_lines_added,total_lines_removed},
 *     context_window:{total_input_tokens,total_output_tokens,context_window_size,
 *                     used_percentage,remaining_percentage},
 *     exceeds_200k_tokens, fast_mode, effort:{level}, thinking:{enabled},
 *     rate_limits:{five_hour,seven_day,spend_limit}, vim:{mode}, agent:{name} }
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const HOME = os.homedir();
const CLAUDE_DIR = path.join(HOME, '.claude');
const SELF_DIR = path.join(CLAUDE_DIR, 'statusline');
const CACHE_FILE = path.join(SELF_DIR, '.cache.json');
const COUNTS_TTL_MS = 30000;

// Windows 上 execFileSync 不会自动补 .exe
const GIT_BIN = process.platform === 'win32' ? 'git.exe' : 'git';

// ---------------------------------------------------------------------------
// 数值格式化
// ---------------------------------------------------------------------------

/** 189700 -> "189.7k"；1250000 -> "1.3M" */
function fmtTokens(n) {
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(Math.round(n));
}

/** 上下文窗口：1000000 -> "1M"，200000 -> "200k" */
function fmtWindow(n) {
  if (!Number.isFinite(n) || n <= 0) return '';
  if (n >= 1_000_000) {
    const m = n / 1_000_000;
    return `${Number.isInteger(m) ? m : m.toFixed(1)}M`;
  }
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}

/** 毫秒 -> "12m34s" / "45s" */
function fmtDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '0s';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rest = s % 60;
  if (m < 60) return rest ? `${m}m${rest}s` : `${m}m`;
  return `${Math.floor(m / 60)}h${m % 60}m`;
}

// 想让模型名显示成别的写法，改这里（键是 model id 里的片段）
const BRAND_CASE = {
  deepseek: 'DeepSeek',
  claude: 'Claude',
  gpt: 'GPT',
  glm: 'GLM',
  qwen: 'Qwen',
  kimi: 'Kimi',
  minimax: 'MiniMax',
  llama: 'Llama',
  gemini: 'Gemini',
};

/** "deepseek-v4-pro" -> "DeepSeek-V4-Pro" */
function prettyModel(name) {
  if (!name) return '';
  if (!/^[a-z0-9.-]+$/.test(name)) return name;
  return name
    .split('-')
    .filter(Boolean)
    .map((part) =>
      BRAND_CASE[part] ? BRAND_CASE[part] : /^[a-z]/.test(part) ? part[0].toUpperCase() + part.slice(1) : part
    )
    .join('-');
}

// ---------------------------------------------------------------------------
// Git
// ---------------------------------------------------------------------------
function gitInfo(cwd) {
  if (!cwd) return null;
  try {
    const out = execFileSync(GIT_BIN, ['status', '--porcelain=v1', '--branch', '-uno'], {
      cwd,
      timeout: 1200,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    });
    const lines = out.split('\n').filter((l) => l.length > 0);
    const head = lines.shift() || '';

    // 可能形态：
    //   ## main...origin/main [ahead 1, behind 2]
    //   ## main                       （无上游）
    //   ## No commits yet on master   （空仓库）
    //   ## Initial commit on master
    //   ## HEAD (no branch)           （detached）
    let branch = '';
    if (/^## HEAD \(no branch\)/.test(head)) {
      branch = 'detached';
    } else {
      const m = head.match(/^## (?:No commits yet on |Initial commit on )?(.+?)(?:\.\.\.|\s|$)/);
      branch = m ? m[1] : '';
    }

    let ahead = 0;
    let behind = 0;
    const ab = head.match(/\[(.*?)\]/);
    if (ab) {
      const a = ab[1].match(/ahead (\d+)/);
      const b = ab[1].match(/behind (\d+)/);
      if (a) ahead = parseInt(a[1], 10);
      if (b) behind = parseInt(b[1], 10);
    }

    const conflict = lines.some((l) => /^(DD|AU|UD|UA|DU|AA|UU)/.test(l));
    return { branch, dirty: lines.length > 0, conflict, ahead, behind, changed: lines.length };
  } catch {
    // git 不存在 / 超时 / 不是仓库 —— 退回直接读 .git/HEAD
    try {
      const head = fs.readFileSync(path.join(cwd, '.git', 'HEAD'), 'utf8').trim();
      const m = head.match(/^ref: refs\/heads\/(.+)$/);
      return { branch: m ? m[1] : 'detached', dirty: false, conflict: false, ahead: 0, behind: 0, changed: 0 };
    } catch {
      return null;
    }
  }
}

// ---------------------------------------------------------------------------
// 磁盘计数：mem / skills / mcp / plugins
// ---------------------------------------------------------------------------

/** 技能目录里可能有符号链接（~/.claude/skills 常软链到别处），用 stat 而不是 dirent */
function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/**
 * 只数得到**本地**技能。Claude Code 内置的那些（dataviz、code-review…）
 * 是编译进 claude.exe 的，磁盘上不存在，任何外部脚本都数不到。
 */
function countSkills() {
  const dirs = [path.join(CLAUDE_DIR, 'skills')];
  let n = 0;
  for (const dir of dirs) {
    try {
      for (const name of fs.readdirSync(dir)) {
        const full = path.join(dir, name);
        if (isDir(full) && fs.existsSync(path.join(full, 'SKILL.md'))) n++;
      }
    } catch {}
  }
  return n;
}

function countMcp(cwd) {
  let n = 0;
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(HOME, '.claude.json'), 'utf8'));
    n += Object.keys(cfg.mcpServers || {}).length;
    const proj = cwd && cfg.projects ? cfg.projects[cwd] : null;
    if (proj) n += Object.keys(proj.mcpServers || {}).length;
  } catch {}
  try {
    const local = JSON.parse(fs.readFileSync(path.join(cwd, '.mcp.json'), 'utf8'));
    n += Object.keys(local.mcpServers || {}).length;
  } catch {}
  return n;
}

function countPlugins() {
  const dir = path.join(CLAUDE_DIR, 'plugins');
  for (const file of ['installed_plugins.json', 'config.json']) {
    try {
      const cfg = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
      const list = cfg.plugins ?? cfg.installed ?? cfg;
      if (Array.isArray(list)) return list.length;
      if (list && typeof list === 'object') return Object.keys(list).length;
    } catch {}
  }
  try {
    return fs.readdirSync(dir).filter((f) => isDir(path.join(dir, f))).length;
  } catch {
    return 0;
  }
}

/** 项目自动记忆条数（不含索引 MEMORY.md） */
function countMemories(cwd) {
  if (!cwd) return 0;
  const slug = cwd.replace(/[:\\/]/g, '-');
  const dir = path.join(CLAUDE_DIR, 'projects', slug, 'memory');
  try {
    return fs.readdirSync(dir).filter((f) => f.endsWith('.md') && f !== 'MEMORY.md').length;
  } catch {
    return 0;
  }
}

/** 项目/全局 CLAUDE.md 是否加载 */
function countClaudeMd(cwd) {
  let n = 0;
  for (const p of [path.join(CLAUDE_DIR, 'CLAUDE.md'), cwd && path.join(cwd, 'CLAUDE.md'), cwd && path.join(cwd, '.claude', 'CLAUDE.md')]) {
    try {
      if (p && fs.statSync(p).isFile()) n++;
    } catch {}
  }
  return n;
}

// ---------------------------------------------------------------------------
// 缓存（磁盘扫描 + 宽度探测都是几十上百毫秒，不能每次刷新都跑）
// ---------------------------------------------------------------------------
function readCache() {
  try {
    const c = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    return c && typeof c === 'object' ? c : {};
  } catch {
    return {};
  }
}

function writeCache(cache) {
  try {
    fs.mkdirSync(SELF_DIR, { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache));
  } catch {}
}

function getCounts(cwd, cache) {
  const hit = cache.counts;
  if (hit && hit.cwd === cwd && Date.now() - hit.at < COUNTS_TTL_MS) return hit.data;
  const data = {
    mem: countMemories(cwd),
    claudeMd: countClaudeMd(cwd),
    skills: countSkills(),
    mcp: countMcp(cwd),
    plugins: countPlugins(),
  };
  cache.counts = { cwd, at: Date.now(), data };
  return data;
}

// ---------------------------------------------------------------------------
// 组装
// ---------------------------------------------------------------------------
function buildData(payload, cache) {
  const cwd = payload.workspace?.current_dir || payload.cwd || process.cwd();
  const ctx = payload.context_window || {};
  const modelName = prettyModel(payload.model?.display_name || payload.model?.id || '');

  const inputTokens = ctx.total_input_tokens || 0;
  const outputTokens = ctx.total_output_tokens || 0;
  const totalTokens = inputTokens + outputTokens;
  const windowSize = ctx.context_window_size || 0;
  const usedPct = Number.isFinite(ctx.used_percentage) ? ctx.used_percentage : null;

  return {
    // 模型
    model: {
      name: modelName,
      raw: payload.model?.display_name || payload.model?.id || '',
      id: payload.model?.id || '',
      window: fmtWindow(windowSize),
      windowSize,
    },
    effort: payload.effort?.level || '',
    thinking: payload.thinking?.enabled !== false,
    style: payload.output_style?.name || '',

    git: gitInfo(cwd),

    context: {
      usedPct,
      remainingPct: Number.isFinite(ctx.remaining_percentage) ? ctx.remaining_percentage : null,
      inputTokens,
      outputTokens,
      totalTokens,
      windowSize,
      tokensText: fmtTokens(totalTokens),
      exceeds200k: !!payload.exceeds_200k_tokens,
    },

    cost: {
      usd: payload.cost?.total_cost_usd || 0,
      usdText: (payload.cost?.total_cost_usd || 0).toFixed(2),
      durationMs: payload.cost?.total_duration_ms || 0,
      durationText: fmtDuration(payload.cost?.total_duration_ms || 0),
      linesAdded: payload.cost?.total_lines_added || 0,
      linesRemoved: payload.cost?.total_lines_removed || 0,
    },

    counts: getCounts(cwd, cache),

    // 环境
    cwd,
    dirName: path.basename(cwd) || cwd,
    version: payload.version || '',
    sessionId: payload.session_id || '',
    agent: payload.agent?.name || '',
    vimMode: payload.vim?.mode || '',
    fastMode: !!payload.fast_mode,

    // 工具函数，主题里可以直接用
    fmt: { tokens: fmtTokens, window: fmtWindow, duration: fmtDuration, model: prettyModel },
  };
}

module.exports = {
  HOME,
  CLAUDE_DIR,
  SELF_DIR,
  CACHE_FILE,
  buildData,
  readCache,
  writeCache,
  fmtTokens,
  fmtWindow,
  fmtDuration,
  prettyModel,
};

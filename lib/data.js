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

const { lastUsage } = require('./transcript');
const { getSystemInfo } = require('./sysinfo');

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
/**
 * 统计暂存 / 已改 / 未跟踪的文件数。
 * porcelain 每行格式是 "XY path"：
 *   X = 索引（暂存区）状态，Y = 工作区状态
 *   ?? = 未跟踪，!! = 被忽略，XY 在冲突集合里 = 冲突
 * 注意：不带 -uno 时 git 要扫描未跟踪文件，大仓库会慢，所以结果要缓存。
 */
function countChanges(lines) {
  const CONFLICT = /^(DD|AU|UD|UA|DU|AA|UU)$/;
  let staged = 0;
  let modified = 0;
  let untracked = 0;
  let conflict = false;

  for (const line of lines) {
    const xy = line.slice(0, 2);
    if (xy === '??') {
      untracked++;
      continue;
    }
    if (CONFLICT.test(xy)) {
      conflict = true;
      staged++;
      modified++;
      continue;
    }
    if (xy[0] !== ' ') staged++;
    if (xy[1] !== ' ') modified++;
  }
  return { staged, modified, untracked, conflict };
}

function gitInfo(cwd) {
  if (!cwd) return null;
  try {
    const out = execFileSync(GIT_BIN, ['status', '--porcelain=v1', '--branch'], {
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

    const counts = countChanges(lines);
    return {
      branch,
      dirty: lines.length > 0,
      conflict: counts.conflict,
      ahead,
      behind,
      changed: lines.length,
      staged: counts.staged,
      modified: counts.modified,
      untracked: counts.untracked,
    };
  } catch {
    // git 不存在 / 超时 / 不是仓库 —— 退回直接读 .git/HEAD
    try {
      const head = fs.readFileSync(path.join(cwd, '.git', 'HEAD'), 'utf8').trim();
      const m = head.match(/^ref: refs\/heads\/(.+)$/);
      return {
        branch: m ? m[1] : 'detached',
        dirty: false,
        conflict: false,
        ahead: 0,
        behind: 0,
        changed: 0,
        staged: 0,
        modified: 0,
        untracked: 0,
      };
    } catch {
      return null;
    }
  }
}

/**
 * statusLine.refreshInterval（毫秒）。读一次 settings.json，失败就按 10 秒算。
 * 每个进程只读一次；调用方是短命进程，所以不需要更复杂的缓存。
 */
function refreshIntervalMs() {
  try {
    const s = JSON.parse(fs.readFileSync(path.join(CLAUDE_DIR, 'settings.json'), 'utf8'));
    const sec = s.statusLine?.refreshInterval;
    if (Number.isFinite(sec) && sec > 0) return sec * 1000;
  } catch {}
  return 10000;
}

/**
 * 带上 TTL 的 git 查询缓存 —— 去掉 -uno 后大仓库会明显变慢。
 *
 * TTL **从刷新间隔推导**，而不是写死一个常数。
 * 写死过一次就踩了坑：TTL 给 4 秒、刷新间隔 10 秒，每次刷新时缓存都已过期
 * 6 秒，于是 git status 每次都真跑 —— 那段缓存等于没写。
 * 后来又差点重演：把刷新间隔改成 30 秒时，20 秒的 TTL 又不够了。
 * 所以改成 1.5 倍刷新间隔（下限 15 秒）：保证每两次刷新里至少命中一次，
 * 以后无论刷新间隔怎么改都不会再失效。
 *
 * 换算：间隔 30 秒 → TTL 45 秒 → git 实际每 60 秒跑一次，
 *       代价是 git 计数最多滞后 60 秒。
 */
function getGit(cwd, cache) {
  const ttlMs = Math.max(15000, Math.round(refreshIntervalMs() * 1.5));
  const hit = cache.git;
  if (hit && hit.cwd === cwd && Date.now() - hit.at < ttlMs) return hit.data;
  const data = gitInfo(cwd);
  cache.git = { cwd, at: Date.now(), data };
  return data;
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
    const next = JSON.stringify(cache);
    // 内容没变就不落盘 —— 状态栏每 10 秒跑一次，没必要每次都写一遍同样的内容
    try {
      if (fs.readFileSync(CACHE_FILE, 'utf8') === next) return;
    } catch {}
    fs.writeFileSync(CACHE_FILE, next);
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
// 其它数据源
// ---------------------------------------------------------------------------

/** 把 home 目录缩写成 ~，其余保持原样（图上显示的是 Matri@~\Desktop\ODPlatform-stu） */
function shortPath(p) {
  if (!p) return '';
  const home = os.homedir();
  if (p === home) return '~';
  for (const sep of ['/', '\\']) {
    if (p.startsWith(home + sep)) return '~' + p.slice(home.length);
  }
  return p;
}

/** 字节数格式化成 28/48G 那种写法 */
function fmtBytes(n) {
  if (!Number.isFinite(n) || n <= 0) return '0';
  const units = ['B', 'K', 'M', 'G', 'T'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 10 || i === 0 ? Math.round(v) : v.toFixed(1)}${units[i]}`;
}

/** 当前时间拆成便于主题取用的字段（问候语的具体文案交给主题决定） */
function nowInfo(ts = Date.now()) {
  const d = new Date(ts);
  const p2 = (x) => String(x).padStart(2, '0');
  return {
    hour: d.getHours(),
    minute: d.getMinutes(),
    second: d.getSeconds(),
    date: `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`,
    time: `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`,
    datetime: `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`,
  };
}

/**
 * Python 虚拟环境（图上 [Env: base 3.13.9]）。
 * 只有确实处在 conda / venv 里才去调 python --version —— 否则这个段会一直是空的，
 * 而没在用 Python 的人不该为它付一次子进程开销。
 * 版本号五分钟内不会变，缓存 TTL 给 5 分钟。
 */
function pythonEnv(cache) {
  const hit = cache.python;
  if (hit && Date.now() - hit.at < 300000) return hit.data;

  const name = process.env.CONDA_DEFAULT_ENV || (process.env.VIRTUAL_ENV ? path.basename(process.env.VIRTUAL_ENV) : '');
  let data = null;
  if (name) {
    let version = '';
    for (const bin of process.platform === 'win32' ? ['python.exe', 'python'] : ['python3', 'python']) {
      try {
        const out = execFileSync(bin, ['--version'], {
          encoding: 'utf8',
          timeout: 1500,
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
        });
        const m = String(out).match(/(\d+\.\d+\.\d+)/);
        if (m) {
          version = m[1];
          break;
        }
      } catch {}
    }
    data = { name, version };
  }
  cache.python = { at: Date.now(), data };
  return data;
}

/**
 * prompt cache 状态。payload.prompt_cache 里字段不少，这里只取主题要用的：
 *   warm              —— 缓存还热着
 *   caching_observed  —— 观察到过缓存命中
 *   expires_at        —— 过期时间（秒）
 *   hit_ratio         —— 命中率
 */
function cacheInfo(payload) {
  const pc = payload.prompt_cache || null;
  if (!pc) return null;
  return {
    warm: !!pc.warm,
    observed: !!pc.caching_observed,
    ttl: pc.ttl || 0,
    expiresAt: pc.expires_at || null,
    hitRatio: typeof pc.hit_ratio === 'number' ? pc.hit_ratio : null,
    requests: pc.requests || 0,
    misses: pc.misses || 0,
    writeTokens: pc.cache_write_tokens || 0,
  };
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

    git: getGit(cwd, cache),

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

    /**
     * token 细分（未缓存输入 / 输出 / 缓存写入 / 缓存读取）。三级来源：
     *   1. context_window.current_usage —— payload 直接给的四个字段，**首选**。
     *      零 IO，而且是 Claude Code 自己算 used_percentage 用的那份数据，最权威。
     *   2. transcript 尾部最后一条 assistant 消息的 usage —— current_usage 为 null
     *      时（会话刚开始、还没有 assistant 消息）的兜底。实测两者数值完全一致。
     *   3. payload 的加总值（total_input_tokens 是三项之和，拆不开）—— 只能标
     *      exact: false，主题据此隐藏依赖细分的段，而不是显示一个假数字。
     */
    tokens: (() => {
      const cu = ctx.current_usage;
      if (cu && typeof cu === 'object') {
        return {
          in: cu.input_tokens || 0,
          out: cu.output_tokens || 0,
          cacheCreation: cu.cache_creation_input_tokens || 0,
          cacheRead: cu.cache_read_input_tokens || 0,
          exact: true,
          source: 'payload',
        };
      }
      const u = lastUsage(payload.transcript_path);
      if (u.found) {
        return {
          in: u.input,
          out: u.output,
          cacheCreation: u.cacheCreation,
          cacheRead: u.cacheRead,
          exact: true,
          source: 'transcript',
        };
      }
      return { in: inputTokens, out: outputTokens, cacheCreation: null, cacheRead: null, exact: false, source: 'totals' };
    })(),

    // 系统信息：CPU / RAM / Disk 目前一律返回 null，段会自动隐藏。
    // 想启用见 lib/sysinfo.js 里的说明，主题那边不用改。
    system: getSystemInfo(),

    // Python 虚拟环境（没在用 conda/venv 时是 null）
    python: pythonEnv(cache),

    // prompt cache 状态（payload.prompt_cache）
    cache: cacheInfo(payload),

    // 环境
    cwd,
    dirName: path.basename(cwd) || cwd,
    path: shortPath(cwd),
    user: os.userInfo().username || '',
    now: nowInfo(),
    version: payload.version || '',
    sessionId: payload.session_id || '',
    // 会话名（/rename 或自动生成的标题），没设置时是空串
    sessionName: payload.session_name || '',
    agent: payload.agent?.name || '',
    vimMode: payload.vim?.mode || '',
    fastMode: !!payload.fast_mode,

    // 工具函数，主题里可以直接用
    fmt: { tokens: fmtTokens, window: fmtWindow, duration: fmtDuration, model: prettyModel, bytes: fmtBytes },
  };
}

module.exports = {
  // 只导出真正被别的文件用到的。
  // fmtTokens / fmtWindow / fmtDuration 这些在模块内部还在用（挂在 d.fmt 上给主题调），
  // 但对外的顶层导出没人引用 —— 删的是导出，不是函数本身。
  SELF_DIR,
  buildData,
  readCache,
  writeCache,
  prettyModel,
};

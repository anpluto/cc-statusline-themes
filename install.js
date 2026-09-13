#!/usr/bin/env node
'use strict';
/**
 * 安装脚本：把本目录接到 Claude Code 的 settings.json 上。
 *
 *   node install.js                               # 安装
 *   node install.js --context-tokens=1000000      # 顺带设置上下文窗口（DeepSeek 用）
 *   node install.js --dry-run                     # 只看会改什么，不落盘
 *   node install.js --uninstall                   # 卸载
 *
 * 可选参数：
 *   --claude-dir=<路径>   默认 ~/.claude
 *   --node=<路径|名字>    写进 command 的 node，默认用当前跑安装脚本的这个
 *   --refresh=<秒>        状态栏刷新间隔，默认 10
 *
 * 安全：settings.json 里可能有密钥，本脚本只读改写、绝不打印它的内容，
 * 改动前会先备份成 settings.json.bak-statusline。
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const SELF_DIR = __dirname;
const RENDER = path.join(SELF_DIR, 'render.js');
const ACTIVE_FILE = path.join(SELF_DIR, 'active');
const DEFAULT_THEME = 'emoji-line';
const BACKUP_SUFFIX = '.bak-statusline';

// ---------------------------------------------------------------------------
// 参数
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const o = { uninstall: false, dryRun: false, help: false, contextTokens: null, refresh: null, claudeDir: null, node: null };
  for (const a of argv) {
    if (a === '--uninstall') o.uninstall = true;
    else if (a === '--dry-run') o.dryRun = true;
    else if (a === '--help' || a === '-h') o.help = true;
    else if (a.startsWith('--context-tokens=')) o.contextTokens = parseInt(a.slice('--context-tokens='.length), 10);
    else if (a.startsWith('--refresh=')) o.refresh = parseInt(a.slice('--refresh='.length), 10);
    else if (a.startsWith('--claude-dir=')) o.claudeDir = a.slice('--claude-dir='.length);
    else if (a.startsWith('--node=')) o.node = a.slice('--node='.length);
  }
  return o;
}

function usage() {
  console.log(`用法:
  node install.js [选项]

选项:
  --context-tokens=<n>   写入 CLAUDE_CODE_MAX_CONTEXT_TOKENS（DeepSeek V4 用 1000000）
  --refresh=<秒>         状态栏刷新间隔，默认 10
  --claude-dir=<路径>    配置目录，默认 ~/.claude
  --node=<路径|名字>     写进 command 的 node 可执行文件
  --dry-run              只显示将要做的改动，不写文件
  --uninstall            还原 settings.json，移除状态栏配置
  -h, --help             显示本帮助`);
}

/**
 * 解析配置目录。故意**不**自动采信 CLAUDE_CONFIG_DIR ——
 * Claude Code 新版本里这个变量的语义变过（二进制里有
 * "CLAUDE_CONFIG_DIR no longer names …" 的提示），贸然跟随可能写错地方。
 * 只有在它确实指向一个存在的目录时才用。
 */
function resolveClaudeDir(arg) {
  if (arg) return path.resolve(arg);
  const env = process.env.CLAUDE_CONFIG_DIR;
  if (env) {
    try {
      if (fs.statSync(env).isDirectory()) return path.resolve(env);
    } catch {}
  }
  return path.join(os.homedir(), '.claude');
}

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------
function toPosix(p) {
  return p.split(path.sep).join('/');
}

/** Claude Code 用 shell 执行 command，路径有空格必须加引号 */
function quote(p) {
  return `"${toPosix(p)}"`;
}

function readJson(file) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const v = JSON.parse(raw);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

function fileExists(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

const ok = (s) => console.log(`  \x1b[32m✓\x1b[0m ${s}`);
const warn = (s) => console.log(`  \x1b[33m!\x1b[0m ${s}`);
const info = (s) => console.log(`  ${s}`);

// ---------------------------------------------------------------------------
// 卸载
// ---------------------------------------------------------------------------
function uninstall(settingsPath, dryRun) {
  console.log('\n卸载状态栏配置\n');

  const backup = settingsPath + BACKUP_SUFFIX;
  if (fileExists(backup)) {
    if (dryRun) {
      info(`会把 ${path.basename(backup)} 还原回 settings.json`);
    } else {
      fs.copyFileSync(backup, settingsPath);
      ok(`已从 ${path.basename(backup)} 还原 settings.json`);
    }
    console.log('\n本目录（主题、脚本）没有删除。不需要的话手动删掉即可:');
    console.log(`  ${SELF_DIR}\n`);
    return 0;
  }

  const settings = readJson(settingsPath);
  if (!settings || !settings.statusLine) {
    warn('settings.json 里没有 statusLine 配置，也没找到备份，无需卸载');
    return 0;
  }
  if (dryRun) {
    info('会从 settings.json 里删掉 statusLine 这一段');
    return 0;
  }
  delete settings.statusLine;
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
  ok('已从 settings.json 里删除 statusLine');
  return 0;
}

// ---------------------------------------------------------------------------
// 安装
// ---------------------------------------------------------------------------
function install(opts, claudeDir) {
  const settingsPath = path.join(claudeDir, 'settings.json');

  if (!fileExists(RENDER)) {
    console.error(`找不到 ${RENDER} —— 请确认本目录完整（是不是只复制了一部分文件？）`);
    return 1;
  }

  const nodeBin = opts.node || process.execPath;
  const command = `${quote(nodeBin)} ${quote(RENDER)}`;

  console.log('\n安装 Claude Code 状态栏\n');
  console.log(`  配置目录   ${claudeDir}`);
  console.log(`  状态栏命令 ${command}\n`);

  if (opts.dryRun) {
    console.log('  --dry-run，以下改动不会真的写入：');
    info(`备份 settings.json -> settings.json${BACKUP_SUFFIX}（若尚不存在）`);
    info('设置 statusLine = { type: command, command, padding: 0, refreshInterval: ' + (opts.refresh ?? 10) + ' }');
    if (opts.contextTokens) info(`设置 env.CLAUDE_CODE_MAX_CONTEXT_TOKENS = ${opts.contextTokens}`);
    return 0;
  }

  // 确保配置目录存在
  fs.mkdirSync(claudeDir, { recursive: true });

  // 备份（只在第一次备份，避免把已经改过的内容又存成"原始"版本）
  const backup = settingsPath + BACKUP_SUFFIX;
  if (fileExists(settingsPath) && !fileExists(backup)) {
    fs.copyFileSync(settingsPath, backup);
    ok(`已备份 settings.json -> settings.json${BACKUP_SUFFIX}`);
  } else if (fileExists(backup)) {
    info(`备份已存在，保留不覆盖（settings.json${BACKUP_SUFFIX}）`);
  }

  const settings = readJson(settingsPath);
  if (fileExists(settingsPath) && settings === null) {
    console.error(`\n${settingsPath} 存在但不是合法 JSON，为了避免弄坏它，已中止。`);
    console.error('请先修好它的语法，或手动挪开再重跑。');
    return 1;
  }

  const next = settings || {};
  const prev = next.statusLine;
  if (prev && prev.command && prev.command !== command) {
    warn(`覆盖已有的状态栏命令（原：${prev.command}）`);
  }

  next.statusLine = {
    ...(prev || {}),
    type: 'command',
    command,
    padding: 0,
    refreshInterval: opts.refresh ?? prev?.refreshInterval ?? 10,
  };

  if (opts.contextTokens) {
    next.env = { ...(next.env || {}) };
    next.env.CLAUDE_CODE_MAX_CONTEXT_TOKENS = String(opts.contextTokens);
    ok(`env.CLAUDE_CODE_MAX_CONTEXT_TOKENS = ${opts.contextTokens}`);
  }

  fs.writeFileSync(settingsPath, JSON.stringify(next, null, 2) + '\n');
  ok('已更新 settings.json 的 statusLine');

  // 主题文件：缺 active 就给个默认
  if (!fileExists(ACTIVE_FILE)) {
    fs.writeFileSync(ACTIVE_FILE, DEFAULT_THEME + '\n');
    ok(`已设置默认主题 ${DEFAULT_THEME}`);
  } else {
    info(`当前主题 ${fs.readFileSync(ACTIVE_FILE, 'utf8').trim()}`);
  }

  // 自检：真跑一遍渲染
  console.log('\n自检（用假数据渲染一遍）:\n');
  try {
    const { execFileSync } = require('child_process');
    const out = execFileSync(process.execPath, [RENDER, '--preview'], { encoding: 'utf8', timeout: 10000 });
    console.log(out.split('\n').map((l) => '    ' + l).join('\n'));
  } catch (err) {
    warn(`渲染失败：${err.message}`);
    return 1;
  }

  console.log('\n装好了。重启 Claude Code 后生效。\n');
  console.log('接下来：');
  console.log('  切换主题  node ' + toPosix(path.join(SELF_DIR, 'switch.js')));
  console.log('  改主题    ' + toPosix(path.join(SELF_DIR, 'themes')));
  if (!opts.contextTokens) {
    console.log('\n如果用的是 DeepSeek（1M 上下文），建议补一条，否则占用百分比会虚高：');
    console.log('  node ' + toPosix(path.join(SELF_DIR, 'install.js')) + ' --context-tokens=1000000');
  }
  console.log('');
  return 0;
}

// ---------------------------------------------------------------------------
function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    usage();
    return 0;
  }
  const claudeDir = resolveClaudeDir(opts.claudeDir);
  const settingsPath = path.join(claudeDir, 'settings.json');
  return opts.uninstall ? uninstall(settingsPath, opts.dryRun) : install(opts, claudeDir);
}

process.exit(main());

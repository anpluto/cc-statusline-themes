# cc-statusline-themes

给 Claude Code 用的**可切换主题**终端状态栏。零依赖，只要装了 Node。

主题就是主题目录下的一个 `.js` 文件 —— 加一个文件就多一个主题，不用碰引擎。

```
🤖 DeepSeek-V4-Pro 1M | 🧠 max | 📖 default | 🌿 main ● | ⚡ 9.0% · 90.5k tokens
🛠 6 mem · 1 skills · 0 mcp · 0 plugins
```

超宽会自动折行，不会从右边被切掉。

## 特性

- **主题即文件** —— 主题只描述「有哪些段、什么图标颜色、怎么折行」，渲染逻辑和主题解耦
- **自动折行** —— 按终端实际宽度把内容分到多行，段永远不会被切成两半
- **零依赖** —— 只用 Node 内置模块，没有 `node_modules`
- **跨平台** —— Windows / macOS / Linux 都测过
- **幂等安装** —— 安装脚本改 `settings.json` 前先备份，`--uninstall` 一键还原
- **绝不含密钥** —— 仓库里只有状态栏代码，安装脚本从不打印 `settings.json` 的内容

## 安装

```bash
git clone https://github.com/anpluto/cc-statusline-themes.git ~/.claude/statusline
node ~/.claude/statusline/install.js
```

Windows PowerShell 里把 `~` 换成 `$HOME`，cmd 里换成 `%USERPROFILE%`：

```powershell
git clone https://github.com/anpluto/cc-statusline-themes.git $HOME\.claude\statusline
node $HOME\.claude\statusline\install.js
```

装完**重启 Claude Code** 生效。安装脚本最后会用假数据渲染一遍自检，看到效果就说明成功了。

### 安装脚本做了什么

1. 备份 `~/.claude/settings.json` → `settings.json.bak-statusline`
2. 写入 `statusLine = { type: "command", command: "<node> <render.js>", padding: 0, refreshInterval: 10 }`
3. 缺 `active` 文件时写入默认主题

先看看会改什么：

```bash
node ~/.claude/statusline/install.js --dry-run
```

### 用的是 DeepSeek / 其他非 Claude 模型？

Claude Code 只认识自家的模型，遇到 `deepseek-v4-pro` 这类未知模型时，**上下文窗口会兜底成 200k**，于是占用百分比虚高好几倍（真实 9% 会显示成 44%），而且会话涨到 200k 就开始自动压缩。

装的时候一起修掉：

```bash
node ~/.claude/statusline/install.js --context-tokens=1000000
```

换成别的模型时，把 `1000000` 改成该模型的真实窗口。

**另一种办法**：把模型名写成 `deepseek-v4-pro[1m]` —— Claude Code 认这个后缀，
见到就直接按 1M 算，不必设环境变量。两种方式等价，选一种即可。

## 日常使用

```bash
node ~/.claude/statusline/switch.js              # 列出所有主题 + 每个的实际渲染效果
node ~/.claude/statusline/switch.js minimal      # 切换（立即生效，不用重启）
node ~/.claude/statusline/switch.js --list       # 只要名单，不要预览
node ~/.claude/statusline/render.js --width=80   # 临时按 80 列渲染，调试折行用
```

切换只写 `active` 这一个文件，下一个刷新周期（默认 10 秒）就生效。

## 更新 / 卸载

```bash
git -C ~/.claude/statusline pull                  # 更新
node ~/.claude/statusline/install.js --uninstall  # 卸载（还原 settings.json）
```

卸载不会删除本目录，不需要了手动删掉即可。

## 内置主题

| 主题 | 效果 |
| --- | --- |
| `emoji-line` | `🤖 模型 1M \| 🧠 强度 \| 📖 风格 \| 🌿 分支 ● \| ⚡ 9.0% · 90.5k tokens \| 🛠 6 mem · 1 skills · 0 mcp · 0 plugins` |
| `minimal` | `DeepSeek-V4-Pro  main ✓  9%  $0.01` |
| `powerline` | 背景色块 + 箭头过渡（需要 Nerd Font） |
| `bracket-panel` | 方括号分段 + 三行信息面板，见下 |

`bracket-panel` 固定三行，不随终端宽度变化：

```
[ 🔵 deepseek-v4-pro ] - [ 📦 v2.1.177 ] - [ ⚡ max ] - [ 🧠 Thinking ] - [ 🌿 main +3 ✖9 ?6 ] - [ 🐍 Env: base 3.13.9 ] - [ ⏱ 你已经工作了:00小时 03分钟 52秒 ]
[ 晚上好 ] - [ anpluto@~/Projects/demo ] - [ 2026-09-13 20:31:28 ]
[ 📝 CTX 9%·91% Warm ] - [ 📐 Size: 1M ] - [ 📥 In: 2169 Out: 2238 ] - [ 🗄 Crt: 4096 Rd: 88320 ] - [ ⌨ Claude酱正在努力工作中 (｀・ω・´) ]
```

**所有中文 / 日式文案都集中在文件顶部的 `TEXTS` 块**，改文案只动那一块，
不用碰段定义。问候语按小时切换、时长格式、git 计数的符号都在里面。

CPU / RAM / Disk 三段**已留好位置但默认不显示** —— `lib/sysinfo.js` 现在一律返回
`null`，段自动隐藏；按那个文件里的说明实现后它们会自动出现，主题文件一个字都不用改。

## 自定义主题

在 `themes/` 下新建 `<名字>.js`：

```js
'use strict';
const { paint } = require('../lib/palette');

module.exports = {
  name: 'my-theme',
  description: '一句话说明，会出现在 switch.js 的列表里',

  separator: ' | ',        // 段与段之间的分隔符
  separatorColor: 'dim',
  wrap: 'auto',            // 'auto' 按宽度折行 | 'never' 永远单行
                           // 或写死：[[0,1,2],[3,4]]（数字是 segments 下标）

  segments: [
    {
      when: (d) => !!d.model.name,   // 返回 false 整段消失
      icon: '🤖',
      iconColor: 'brightCyan',

      innerSep: ' · ',               // 段内片段的连接符
      innerSepColor: 'dim',          // 不写就不上色（powerline 主题必须不写）
      parts: [
        { text: (d) => d.model.name, color: 'brightCyan' },
        { text: (d) => d.model.window, color: 'brightCyan' },
      ],

      suffix: (d) => (d.git.dirty ? paint('brightYellow', '●') : ''),  // 段尾附加
    },
  ],
};
```

要点：

- `text` 可以是函数（收到数据对象 `d`）也可以是固定字符串
- `color` 用**颜色名**（`'brightCyan'`、`'dim'`…），别写裸 ANSI；可选值见 `lib/palette.js`，
  也支持 256 色（`'38;5;213'`）
- 任何一个 `text` 返回空字符串，那个片段自动消失，不用自己判断
- `wrap: 'auto'` 时折行只发生在段与段之间

## 数据对象 `d`

| 字段 | 说明 |
| --- | --- |
| `d.model.name` | 模型名，已做品牌大小写（`deepseek-v4-pro` → `DeepSeek-V4-Pro`） |
| `d.model.window` | 上下文窗口徽标，如 `1M` / `200k` |
| `d.effort` | 推理强度，如 `max` / `high` |
| `d.style` | 输出风格名 |
| `d.git.branch` / `.dirty` / `.conflict` | 分支名 / 有无改动 / 有无冲突；还有 `.ahead` `.behind` `.changed` |
| `d.context.usedPct` | 上下文占用百分比（可能是 `null`） |
| `d.context.totalTokens` / `.tokensText` | token 数 / 已格式化的 `90.5k` |
| `d.context.windowSize` | 窗口大小，如 `1000000` |
| `d.cost.usd` / `.usdText` / `.durationText` / `.durationMs` | 花费 / 时长 |
| `d.tokens.in` / `.out` / `.cacheCreation` / `.cacheRead` / `.exact` | token 细分（拆自 transcript） |
| `d.cache.warm` / `.observed` / `.hitRatio` / `.expiresAt` | prompt cache 状态 |
| `d.counts.mem` / `.skills` / `.mcp` / `.plugins` / `.claudeMd` | 各项数量 |
| `d.system.cpu` / `.ram` / `.disk` | 系统信息，目前恒为 `null`（见 `lib/sysinfo.js`） |
| `d.python.name` / `.version` | 当前 conda / venv 环境，没在用则为 `null` |
| `d.cwd` / `d.dirName` / `d.path` | 目录全路径 / 目录名 / home 缩写成 `~` 的路径 |
| `d.user` / `d.now.hour` / `.date` / `.time` / `.datetime` | 用户名 / 当前时间各字段 |
| `d.version` / `d.sessionId` / `d.agent` / `d.vimMode` / `d.fastMode` | 环境信息 |
| `d.fmt.tokens(n)` / `.window(n)` / `.duration(ms)` / `.bytes(n)` | 格式化工具 |

## 常见问题

**终端宽度是怎么拿到的？**
状态栏是 Claude Code 拉起的子进程，stdout 是管道，`process.stdout.columns` 永远是
`undefined`。本项目在 Windows 上用 `cmd /c mode con` 探测（约 130ms，结果缓存 20 秒），
在 macOS / Linux 上用 `stty size < /dev/tty`。想固定宽度跳过探测，设环境变量
`CLAUDE_STATUSLINE_WIDTH=120`。

解析 `mode con` 有个坑：它输出的最后一行是**代码页**（中文 Windows 是 936），
不是宽度，所以必须显式匹配「列 / Columns」那一行。

**`skills` 数量为什么这么少？**
只数得到 `~/.claude/skills/` 下的**本地**技能。Claude Code 内置的那些
（`dataviz`、`code-review` 等）是编译进 `claude.exe` 的，磁盘上不存在，
任何外部脚本都数不到。

**状态栏整块消失了 / 显示报错？**
先手工跑一遍看错误：

```bash
node ~/.claude/statusline/render.js --preview
```

主题文件写坏了不会让状态栏消失 —— 引擎会静默降级到 `emoji-line`。

**`powerline` 主题的箭头显示成方块？**
需要装 Nerd Font 并在终端里启用。

## License

MIT

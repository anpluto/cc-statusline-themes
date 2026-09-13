'use strict';
/**
 * emoji-line —— 截图同款风格
 *
 *   🤖 DeepSeek-V4-Pro 1M | 🧠 max | 📖 default | 🌿 master ● | ⚡ 44.0% · 88.1k tokens | 🛠 3 mem · 1 skills · 0 mcp · 0 plugins
 *
 * 放不下时按终端宽度自动折成多行（不会从右边被切掉）。
 */

const { paint } = require('../lib/palette');

module.exports = {
  name: 'emoji-line',
  description: 'emoji + 竖线分隔，超宽自动折行',
  separator: ' | ',
  separatorColor: 'dim',
  wrap: 'auto', // 关键：超宽自动折行

  segments: [
    // 🤖 模型 + 上下文窗口大小
    {
      icon: '🤖',
      iconColor: 'brightCyan',
      when: (d) => !!d.model.name,
      parts: [
        { text: (d) => d.model.name, color: 'brightCyan' },
        { text: (d) => d.model.window, color: 'brightCyan' },
      ],
    },

    // 🧠 推理强度（来自 payload.effort.level）
    {
      icon: '🧠',
      iconColor: 'brightMagenta',
      when: (d) => !!d.effort,
      parts: [{ text: (d) => d.effort, color: 'brightMagenta' }],
    },

    // 📖 输出风格名（payload.output_style.name）
    //    想改成显示当前目录名，把 text 换成 (d) => d.dirName 即可
    {
      icon: '📖',
      iconColor: 'brightGreen',
      when: (d) => !!d.style,
      parts: [{ text: (d) => d.style, color: 'brightGreen' }],
    },

    // 🌿 分支 + 状态点（● 冲突红 / 有改动黄 / 干净蓝）
    {
      icon: '🌿',
      iconColor: 'brightGreen',
      when: (d) => !!(d.git && d.git.branch),
      parts: [{ text: (d) => d.git.branch, color: 'brightGreen' }],
      suffix: (d) =>
        d.git.conflict
          ? paint('brightRed', '●')
          : d.git.dirty
            ? paint('brightYellow', '●')
            : paint('brightBlue', '●'),
    },

    // ⚡ 上下文占用：百分比 · token 数（中间的点是 dim 色）
    {
      icon: '⚡',
      iconColor: 'brightYellow',
      when: (d) => d.context.totalTokens > 0,
      innerSep: ' · ',
      innerSepColor: 'dim',
      parts: [
        { text: (d) => (d.context.usedPct === null ? '' : `${d.context.usedPct.toFixed(1)}%`), color: 'brightMagenta' },
        { text: (d) => `${d.context.tokensText} tokens`, color: 'brightMagenta' },
      ],
    },

    // 🛠 记忆 / 技能 / MCP / 插件 数量
    {
      icon: '🛠',
      iconColor: 'brightWhite',
      innerSep: ' · ',
      innerSepColor: 'dim',
      parts: [
        { text: (d) => `${d.counts.mem} mem`, color: 'brightWhite' },
        { text: (d) => `${d.counts.skills} skills`, color: 'brightWhite' },
        { text: (d) => `${d.counts.mcp} mcp`, color: 'brightWhite' },
        { text: (d) => `${d.counts.plugins} plugins`, color: 'brightWhite' },
      ],
    },
  ],
};

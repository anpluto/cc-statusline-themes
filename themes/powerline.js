'use strict';
/**
 * powerline —— 背景色块 + 箭头过渡
 *
 *    DeepSeek-Flash     master     44%     $0.01
 *
 * 需要终端装了 Nerd Font / Powerline 字体，否则末端的箭头字形（U+E0B0）会显示成方块。
 *
 * 注意：powerline 模式下**不要**给段内的 part 单独设 color，也不要用 suffix ——
 * 它们会插入 reset 序列，把色块的背景色冲掉。颜色统一由段上的 bg / fg 控制。
 */

module.exports = {
  name: 'powerline',
  description: '色块箭头风格（需要 Nerd Font）',
  powerline: true,
  separator: '',
  wrap: 'auto',

  segments: [
    // 模型
    {
      when: (d) => !!d.model.name,
      bg: 'bgBrightBlack',
      fg: 'brightCyan',
      parts: [
        { text: (d) => d.model.name },
        { text: (d) => d.model.window, innerSep: ' ' },
      ],
      innerSep: ' ',
    },

    // 分支
    {
      when: (d) => !!(d.git && d.git.branch),
      bg: 'bgBlue',
      fg: 'brightWhite',
      parts: [{ text: (d) => d.git.branch }],
    },

    // 上下文占用
    {
      when: (d) => d.context.usedPct !== null,
      bg: 'bgGreen',
      fg: 'black',
      parts: [{ text: (d) => `${Math.round(d.context.usedPct)}%` }],
    },

    // 花费
    {
      when: (d) => d.cost.usd > 0,
      bg: 'bgMagenta',
      fg: 'brightWhite',
      parts: [{ text: (d) => `$${d.cost.usdText}` }],
    },
  ],
};

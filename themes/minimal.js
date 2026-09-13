'use strict';
/**
 * minimal —— 无 emoji，低噪音，只留最关键的几项，永远单行
 *
 *   deepseek-v4-pro  master ●  44%  │  $0.01
 */

const { paint } = require('../lib/palette');

module.exports = {
  name: 'minimal',
  description: '无 emoji 极简单行：模型 / 分支 / 上下文 / 花费',
  separator: '  ',
  separatorColor: 'dim',
  wrap: 'never',

  segments: [
    {
      when: (d) => !!d.model.name,
      parts: [{ text: (d) => d.model.name, color: 'cyan' }],
    },
    {
      when: (d) => !!(d.git && d.git.branch),
      parts: [{ text: (d) => d.git.branch, color: 'green' }],
      suffix: (d) =>
        d.git.conflict ? paint('red', '✖') : d.git.dirty ? paint('yellow', '●') : paint('green', '✓'),
    },
    {
      when: (d) => d.context.usedPct !== null,
      parts: [{ text: (d) => `${Math.round(d.context.usedPct)}%`, color: 'magenta' }],
    },
    {
      when: (d) => d.cost.usd > 0,
      parts: [{ text: (d) => `$${d.cost.usdText}`, color: 'dim' }],
    },
  ],
};

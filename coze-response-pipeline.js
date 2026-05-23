/**
 * Coze 响应后处理管线（无前端感知）
 * 第十六章违禁词 → 第十三章1600压缩
 */

const { applyForbiddenFilter } = require('./forbidden-filter.js');
const { postProcessForIntent } = require('./prompt-compress.js');

/**
 * @param {string} text
 * @param {string} intent
 * @returns {string}
 */
function finalizeCozeResponse(text, intent) {
  let out = applyForbiddenFilter(String(text || ''));
  out = postProcessForIntent(out, intent);
  return out;
}

module.exports = {
  finalizeCozeResponse,
};

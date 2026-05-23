/**
 * 第十三章 · 即梦字符压缩规则
 * 硬性上限 1600 字符；保留固定质量收尾语
 */

const { parseCozeOutputPackage } = require('./coze-output-parser.js');

const JIMENG_CHAR_LIMIT = 1600;

const JIMENG_TAIL_LITE =
  'high quality illustration, clean structured layout, no watermark, no blurry text';

const DENSITY_TAIL_FULL =
  'high information density, rich visual elements, multi-layer layout with background texture content and decoration layers, at least 5 different visual element types, no excessive whitespace, professional editorial design quality';

/**
 * 压缩单段英文提示词至 limit 以内，保留收尾层
 * @param {string} en
 * @param {number} limit
 * @returns {string}
 */
function compressJimengPrompt(en, limit) {
  limit = limit || JIMENG_CHAR_LIMIT;
  if (!en) return en;
  let s = String(en).replace(/\s+/g, ' ').trim();
  if (s.length <= limit) return s;

  const tailLite = JIMENG_TAIL_LITE;
  const tailFull = DENSITY_TAIL_FULL;
  if (s.indexOf(tailLite) !== -1) {
    s = s.replace(tailLite, '').trim();
  }
  if (s.indexOf(tailFull) !== -1) {
    s = s.replace(tailFull, '').trim();
  }

  const styleBudget = 200;
  const tailBudget = tailLite.length + 1;
  const head = s.slice(0, styleBudget);

  let mid = s.slice(styleBudget);
  if (mid.length > limit - styleBudget - tailBudget - 20) {
    const parts = mid.split(/\.\s+/).filter(Boolean);
    const colors = ['Gold', 'Green', 'Blue', 'Coral', 'Ivory'];
    const abbreviated = [];
    for (let i = 0; i < parts.length && i < 12; i++) {
      const p = parts[i].trim();
      const title = p.slice(0, 28).replace(/[":]/g, '');
      abbreviated.push(
        '[' + colors[i % colors.length] + '①' + title + ': ' + (p.length > 60 ? p.slice(0, 56) + '…' : p) + ']'
      );
    }
    mid = abbreviated.join(' ');
  }

  let out = (head + ' ' + mid + ' ' + tailLite).replace(/\s+/g, ' ').trim();
  if (out.length > limit) {
    out = head.slice(0, 180) + ' ' + mid.slice(0, limit - tailBudget - 200) + ' ' + tailLite;
  }
  return out.slice(0, limit);
}

/**
 * 在扣子完整回复中替换精简版/完整版英文块
 * @param {string} rawText
 * @returns {string}
 */
function enforceJimengLimitInCozeText(rawText) {
  const text = String(rawText || '');
  if (!text) return text;

  const pkg = parseCozeOutputPackage(text);
  if (!pkg.englishFull && !pkg.chineseShort) return text;

  let out = text;
  const liteSource = pkg.chineseShort || pkg.englishFull;
  if (liteSource && liteSource.length > JIMENG_CHAR_LIMIT) {
    const compressed = compressJimengPrompt(liteSource, JIMENG_CHAR_LIMIT);
    if (pkg.chineseShort && pkg.chineseShort.length > 20) {
      out = replaceFirstBlock(out, pkg.chineseShort, compressed);
    }
  }

  if (pkg.englishFull && pkg.englishFull.length > JIMENG_CHAR_LIMIT + 400) {
    const compressedFull = compressJimengPrompt(pkg.englishFull, JIMENG_CHAR_LIMIT + 200);
    out = replaceFirstBlock(out, pkg.englishFull, compressedFull);
  }

  return out;
}

function replaceFirstBlock(haystack, needle, replacement) {
  if (!needle || haystack.indexOf(needle) === -1) return haystack;
  return haystack.replace(needle, replacement);
}

/**
 * Coze 返回后管线：违禁词已在上一层处理时，此处做 1600 压缩
 * @param {string} text
 * @param {string} intent
 * @returns {string}
 */
function postProcessForIntent(text, intent) {
  const t = String(text || '');
  if (intent === 'prompt' || intent === 'custom') {
    return enforceJimengLimitInCozeText(t);
  }
  return t;
}

module.exports = {
  JIMENG_CHAR_LIMIT,
  JIMENG_TAIL_LITE,
  DENSITY_TAIL_FULL,
  compressJimengPrompt,
  enforceJimengLimitInCozeText,
  postProcessForIntent,
};

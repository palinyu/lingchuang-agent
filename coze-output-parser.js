/**
 * 解析扣子 v1.3 STEP2 标准输出包（知识点 + 完整版 + 精简版 + 即梦设置 + 话题）
 */

function safeStr(v) {
  return v == null ? '' : String(v).trim();
}

function sliceBetween(text, startMarkers, endMarkers) {
  let body = safeStr(text);
  if (!body) return '';
  let startAt = -1;
  let startLen = 0;
  const starts = Array.isArray(startMarkers) ? startMarkers : [startMarkers];
  starts.forEach(function (m) {
    const p = body.indexOf(m);
    if (p !== -1 && (startAt === -1 || p < startAt)) {
      startAt = p;
      startLen = m.length;
    }
  });
  if (startAt === -1) return '';
  body = body.slice(startAt + startLen);
  let endAt = body.length;
  const ends = endMarkers || [];
  ends.forEach(function (em) {
    const ep = body.indexOf(em);
    if (ep > 20 && ep < endAt) endAt = ep;
  });
  return body.slice(0, endAt).trim();
}

function stripChineseShortLabel(s) {
  let out = safeStr(s);
  if (!out) return '';
  out = out.replace(/^[（(]?\s*手机端\s*[）)]?\s*[:：]\s*/, '');
  out = out.replace(/^📱\s*精简版[^\n]*\n?/m, '');
  out = out.replace(/^精简版[（(]手机端[）)]?\s*[:：]?\s*/, '');
  return out.trim();
}

function extractEnglishBlock(text) {
  const chunk = sliceBetween(
    text,
    ['完整版（推荐）', '完整版(推荐)', '【完整版（推荐）', '📋 完整版', '完整版'],
    ['精简版', '中文版', '中文精简', '📱 精简版', '⚙️ 即梦', '即梦设置', '配套爆款', '需要配套']
  );
  if (chunk.length >= 60) return chunk.replace(/\s+/g, ' ').trim();

  const blocks = String(text).match(/[A-Za-z][A-Za-z0-9\s,.\-:;'"()\/\[\]{}–—]{80,}/g);
  if (blocks && blocks.length) {
    blocks.sort(function (a, b) {
      return b.length - a.length;
    });
    return blocks[0].replace(/\s+/g, ' ').trim();
  }
  return '';
}

/**
 * @returns {{
 *   knowledgeStruct: string,
 *   englishFull: string,
 *   chineseShort: string,
 *   jimengSettings: string,
 *   hashtags: string,
 *   jimengTip: string,
 *   hasPackage: boolean
 * }}
 */
function parseCozeOutputPackage(raw) {
  const text = safeStr(raw);
  const knowledgeStruct = sliceBetween(text, ['📊【知识点结构化', '知识点结构化', '【知识点结构化'], ['🎨【即梦', '🎨【即梦', '即梦生图提示词']);

  const englishFull = extractEnglishBlock(text);

  const chineseShort = stripChineseShortLabel(
    sliceBetween(
      text,
      ['📱 精简版', '精简版（手机端）', '精简版(手机端)', '【精简版', '精简版'],
      ['⚙️ 即梦', '即梦设置', '📣', '配套爆款', '需要配套']
    )
  );

  const jimengSettings = sliceBetween(
    text,
    ['⚙️ 即梦设置', '即梦设置：', '即梦设置:'],
    ['📣', '配套爆款', '需要配套', '【AI提示词生成】']
  );

  const hashtags = sliceBetween(text, ['📣【抖音话题标签】', '📣【话题', '抖音话题标签', '#'], [
    '配套爆款',
    '需要配套',
    '回复 X',
    '回复X',
  ]);

  const jimengTip = sliceBetween(text, ['请在即梦', '图生图模式', '上传图B', '手动将真实二维码'], []);

  const hasPackage =
    !!(englishFull && englishFull.length >= 60) ||
    !!(chineseShort && chineseShort.length >= 20) ||
    !!(knowledgeStruct && knowledgeStruct.length >= 30);

  return {
    knowledgeStruct: knowledgeStruct,
    englishFull: englishFull,
    chineseShort: chineseShort,
    jimengSettings: jimengSettings,
    hashtags: hashtags,
    jimengTip: jimengTip,
    hasPackage: hasPackage,
  };
}

function validateCozePackage(pkg, route) {
  const p = pkg || {};
  const profile = (route && route.profile) || '';
  if (!p.hasPackage) {
    return { valid: false, reason: '未识别到扣子 STEP2 标准输出包（完整版/精简版）' };
  }
  const en = safeStr(p.englishFull);
  if (en.length < 120) {
    return { valid: false, reason: '完整版英文过短（当前 ' + en.length + ' 字符）' };
  }
  if (/^[\u4e00-\u9fff\s，。！？、；：]+$/.test(en)) {
    return { valid: false, reason: '完整版缺少有效英文生图描述' };
  }
  const structureRe =
    /panel|stage|infographic|scene|layout|module|composition|photorealistic|illustration|cross|lifecycle|classroom|poster|product|reserved|typography/i;
  if (
    profile !== 'ecom' &&
    profile !== 'ecom_image' &&
    !structureRe.test(en) &&
    en.length < 200
  ) {
    return { valid: false, reason: '英文段缺少版式/主体/场景结构描述' };
  }
  return { valid: true, reason: '' };
}

module.exports = {
  parseCozeOutputPackage,
  validateCozePackage,
  extractEnglishBlock,
};

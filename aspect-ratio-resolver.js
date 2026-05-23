/**
 * 灵创星球 · 推荐尺寸解析（品类 / 平台 / 风格 → 比例）
 * 避免「AI 推荐」一律锁死 3:4；知识图解默认 9:16，英语场景 16:9 等按 SOP 匹配。
 */

const PROFILE_SIZE_DEFAULTS = {
  english_edu: '16:9横版',
  education: '9:16竖版',
  textbook: '9:16竖版',
  poetry: '9:16竖版',
  recipe: '9:16竖版',
  fitness: '9:16竖版',
  tcm: '9:16竖版',
  herb: '9:16竖版',
  skincare: '9:16竖版',
  finance: '9:16竖版',
  workplace: '9:16竖版',
  fashion: '9:16竖版',
  city: '9:16竖版',
  citywalk: '9:16竖版',
  constellation: '9:16竖版',
  lifecycle: '9:16竖版',
  season_relief: '9:16竖版',
  batch_series: '1:1方图',
  ecom_detail_exploded: '9:16竖版',
  interior: '16:9横版',
  template_clone: '9:16竖版',
  default: '9:16竖版',
};

/** 需结合平台关键词再定的品类 */
const PLATFORM_SENSITIVE_PROFILES = {
  ecom: true,
  ecom_image: true,
  ecom_dual: true,
  cover: true,
};

function safeStr(v, fallback) {
  const s = v == null ? '' : String(v).trim();
  return s || fallback || '';
}

function isAiRecommendedSize(size) {
  const s = safeStr(size, '');
  if (!s) return true;
  return /^(AI推荐尺寸|AI推荐|智能推荐|推荐尺寸|自动推荐)$/i.test(s);
}

/**
 * 从用户话术中识别目标平台 → 比例（优先级高于品类默认）
 */
function detectPlatformSize(blob) {
  const t = safeStr(blob, '').toLowerCase();
  if (!t) return '';

  if (/视频号|b站|哔哩|横屏视频|ppt|幻灯片|课件|banner|头图|美团|饿了么|外卖主图|淘宝主图|京东主图|横版海报|横屏/.test(t)) {
    return '16:9横版';
  }
  if (/公众号封面|首图|超宽|21\s*:\s*9|21:9/.test(t)) {
    return '21:9超宽';
  }
  if (/3\s*:\s*1|三比一/.test(t)) {
    return '3:1横条';
  }
  if (/抖音|tiktok|竖屏短视频|reels|story|9\s*:\s*16|9:16/.test(t)) {
    return '9:16竖版';
  }
  if (/小红书|种草|笔记封面|图文详情|3\s*:\s*4|3:4/.test(t)) {
    return '3:4竖版';
  }
  if (/朋友圈|方图|头像|1\s*:\s*1|1:1/.test(t)) {
    return '1:1方图';
  }
  if (/instagram|ins竖|4\s*:\s*5|4:5/.test(t)) {
    return '4:5竖版';
  }
  if (/杂志封面|2\s*:\s*3|2:3/.test(t)) {
    return '2:3竖版';
  }
  if (/展示卡|知识卡横|4\s*:\s*3|4:3/.test(t)) {
    return '4:3横版';
  }
  return '';
}

function detectProfileSize(profile, blob) {
  const prof = safeStr(profile, 'default');
  const t = safeStr(blob, '');

  if (prof === 'english_edu' || /英语课|英语单元|场景叙事|对话场景/.test(t)) {
    return '16:9横版';
  }
  if (prof === 'batch_series' || /系列卡|做10张|批量出图/.test(t)) {
    return /朋友圈|方图|1\s*:\s*1/.test(t) ? '1:1方图' : '9:16竖版';
  }
  if (prof === 'cover') {
    if (/抖音/.test(t)) return '9:16竖版';
    if (/小红书/.test(t)) return '3:4竖版';
    if (/视频号|b站/.test(t)) return '16:9横版';
    if (/朋友圈/.test(t)) return '1:1方图';
    return '3:4竖版';
  }
  if (PLATFORM_SENSITIVE_PROFILES[prof] || /^ecom/.test(prof)) {
    const platform = detectPlatformSize(t);
    if (platform) return platform;
    if (/详情页|详情长图|长图详情/.test(t)) return '9:16竖版';
    if (/主图|淘宝|京东|电商/.test(t)) return '1:1方图';
    return '9:16竖版';
  }

  return PROFILE_SIZE_DEFAULTS[prof] || PROFILE_SIZE_DEFAULTS.default;
}

/**
 * @param {{ topic?: string, rawQuery?: string, route?: object, userSize?: string }} p
 * @returns {string} 如「9:16竖版」
 */
function resolveRecommendedSize(p) {
  const userSize = safeStr(p && p.userSize, '');
  if (userSize && !isAiRecommendedSize(userSize)) {
    return normalizeSizeLabel(userSize);
  }

  const topic = safeStr(p && p.topic, '');
  const rawQuery = safeStr(p && p.rawQuery, '');
  const blob = topic + ' ' + rawQuery;
  const route = (p && p.route) || {};
  const profile = safeStr(route.profile, 'default');

  const platform = detectPlatformSize(blob);
  if (platform) return platform;

  return detectProfileSize(profile, blob);
}

function normalizeSizeLabel(size) {
  const s = safeStr(size, '');
  if (!s) return '';
  if (/16\s*:\s*9|16×9/i.test(s)) return '16:9横版';
  if (/9\s*:\s*16|9×16/i.test(s)) return '9:16竖版';
  if (/3\s*:\s*4|3×4/i.test(s)) return '3:4竖版';
  if (/1\s*:\s*1|方图|方版/i.test(s)) return '1:1方图';
  if (/4\s*:\s*5/i.test(s)) return '4:5竖版';
  if (/2\s*:\s*3/i.test(s)) return '2:3竖版';
  if (/4\s*:\s*3/i.test(s)) return '4:3横版';
  if (/21\s*:\s*9/i.test(s)) return '21:9超宽';
  if (/3\s*:\s*1/i.test(s)) return '3:1横条';
  return s;
}

function resolveAspectHint(size) {
  const label = normalizeSizeLabel(size) || resolveRecommendedSize({ userSize: size });
  if (/16:9/i.test(label)) return '--ar 16:9';
  if (/9:16/i.test(label)) return '--ar 9:16';
  if (/3:4/i.test(label)) return '--ar 3:4';
  if (/1:1|方图/.test(label)) return '--ar 1:1';
  if (/4:5/i.test(label)) return '--ar 4:5';
  if (/2:3/i.test(label)) return '--ar 2:3';
  if (/4:3/i.test(label)) return '--ar 4:3';
  if (/21:9/i.test(label)) return '--ar 21:9';
  if (/3:1/i.test(label)) return '--ar 3:1';
  return '--ar 9:16';
}

const NON_ECOM_PROFILES = new Set([
  'city',
  'citywalk',
  'education',
  'textbook',
  'poetry',
  'recipe',
  'fitness',
  'tcm',
  'herb',
  'skincare',
  'finance',
  'workplace',
  'fashion',
  'constellation',
  'lifecycle',
  'english_edu',
  'season_relief',
  'batch_series',
  'interior',
  'template_clone',
  'knowledge_infographic',
  'life_science',
  'pet',
]);

function isEcomLikeProfile(profile) {
  const p = safeStr(profile, '');
  if (!p || p === 'standard') return false;
  if (NON_ECOM_PROFILES.has(p)) return false;
  return /^(ecom|ecom_|cover)/.test(p);
}

function userExplicitPlatformSize(blob) {
  const t = safeStr(blob, '');
  if (!t) return '';
  if (/小红书|种草|笔记封面|图文详情/.test(t) && /3\s*:\s*4|3:4/.test(t)) return '3:4竖版';
  if (/小红书|种草|笔记封面/.test(t)) return '3:4竖版';
  if (/抖音|9\s*:\s*16|9:16/.test(t)) return '9:16竖版';
  if (/16\s*:\s*9|16:9|美团|横版|视频号|ppt/i.test(t)) return '16:9横版';
  if (/朋友圈|1\s*:\s*1|方图/.test(t)) return '1:1方图';
  return '';
}

/** 展示/出图用：非电商类忽略扣子默认 3:4 */
function resolveDisplaySize(parsedSize, opts) {
  const topic = safeStr(opts && opts.topic, '');
  const rawQuery = safeStr(opts && opts.rawQuery, '');
  const blob = topic + ' ' + rawQuery;
  const prof = safeStr((opts && opts.profile) || (opts && opts.route && opts.route.profile), 'default');
  const system = resolveRecommendedSize({ topic, rawQuery: blob, route: { profile: prof } });
  if (!isEcomLikeProfile(prof)) return system;
  const explicit = userExplicitPlatformSize(blob);
  if (explicit) return explicit;
  if (!parsedSize || isAiRecommendedSize(parsedSize)) return system;
  const p = normalizeSizeLabel(parsedSize);
  if (p === system) return p;
  if (p === '3:4竖版' && /小红书|种草|3\s*:\s*4|3:4|笔记封面/.test(blob)) return p;
  if (p === '9:16竖版' && /抖音|9\s*:\s*16|9:16/.test(blob)) return p;
  if (p === '16:9横版' && /16\s*:\s*9|16:9|美团|横版|视频号/i.test(blob)) return p;
  if (p === '1:1方图' && /朋友圈|1\s*:\s*1|方图/.test(blob)) return p;
  return system;
}

function buildRecommendedSizeInstruction(route, topic, rawQuery) {
  const size = resolveRecommendedSize({ topic, rawQuery, route });
  const prof = safeStr(route && route.profile, 'default');
  const human = safeStr(route && route.humanLabel, '知识图解');
  return (
    '【推荐尺寸·系统预选·第4条须与此一致或同义】\n' +
    '品类「' +
    human +
    '」（profile=' +
    prof +
    '）→ **' +
    size +
    '**。\n' +
    '禁止所有品类一律写 3:4；仅当用户明确小红书/种草/3:4 或封面类且平台为小红书时才用 3:4。\n' +
    '知识图解/古诗/菜谱/健身/城市攻略等默认 9:16 竖版；小学英语场景叙事默认 16:9 横版；系列卡/朋友圈可用 1:1。'
  );
}

module.exports = {
  PROFILE_SIZE_DEFAULTS,
  isAiRecommendedSize,
  isEcomLikeProfile,
  detectPlatformSize,
  detectProfileSize,
  resolveRecommendedSize,
  resolveDisplaySize,
  normalizeSizeLabel,
  resolveAspectHint,
  buildRecommendedSizeInstruction,
};

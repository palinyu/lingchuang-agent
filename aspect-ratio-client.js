/**
 * 浏览器端 · 推荐尺寸解析（与 aspect-ratio-resolver.js 规则一致）
 */
(function (global) {
  var PROFILE_SIZE_DEFAULTS = {
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

  function trim(s) {
    return s == null ? '' : String(s).trim();
  }

  function isAiRecommendedSize(size) {
    var s = trim(size);
    if (!s) return true;
    return /^(AI推荐尺寸|AI推荐|智能推荐|推荐尺寸|自动推荐)$/i.test(s);
  }

  function detectPlatformSize(blob) {
    var t = trim(blob).toLowerCase();
    if (!t) return '';
    if (/视频号|b站|哔哩|横屏视频|ppt|幻灯片|课件|banner|头图|美团|饿了么|外卖主图|淘宝主图|京东主图|横版海报|横屏/.test(t)) {
      return '16:9横版';
    }
    if (/公众号封面|首图|超宽|21\s*:\s*9|21:9/.test(t)) return '21:9超宽';
    if (/3\s*:\s*1|三比一/.test(t)) return '3:1横条';
    if (/抖音|tiktok|竖屏短视频|reels|story|9\s*:\s*16|9:16/.test(t)) return '9:16竖版';
    if (/小红书|种草|笔记封面|图文详情|3\s*:\s*4|3:4/.test(t)) return '3:4竖版';
    if (/朋友圈|方图|头像|1\s*:\s*1|1:1/.test(t)) return '1:1方图';
    if (/instagram|ins竖|4\s*:\s*5|4:5/.test(t)) return '4:5竖版';
    if (/杂志封面|2\s*:\s*3|2:3/.test(t)) return '2:3竖版';
    if (/展示卡|知识卡横|4\s*:\s*3|4:3/.test(t)) return '4:3横版';
    return '';
  }

  function detectProfileSize(profile, blob) {
    var prof = trim(profile) || 'default';
    var t = trim(blob);
    if (prof === 'english_edu' || /英语课|英语单元|场景叙事|对话场景/.test(t)) return '16:9横版';
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
    if (/^ecom/.test(prof) || prof === 'ecom' || prof === 'ecom_image' || prof === 'ecom_dual') {
      var platform = detectPlatformSize(t);
      if (platform) return platform;
      if (/详情页|详情长图|长图详情/.test(t)) return '9:16竖版';
      if (/主图|淘宝|京东|电商/.test(t)) return '1:1方图';
      return '9:16竖版';
    }
    return PROFILE_SIZE_DEFAULTS[prof] || PROFILE_SIZE_DEFAULTS.default;
  }

  function normalizeSizeLabel(size) {
    var s = trim(size);
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

  function resolveRecommendedSize(opts) {
    opts = opts || {};
    var userSize = trim(opts.userSize);
    if (userSize && !isAiRecommendedSize(userSize)) return normalizeSizeLabel(userSize);
    var topic = trim(opts.topic);
    var rawQuery = trim(opts.rawQuery);
    var blob = topic + ' ' + rawQuery;
    var route = opts.route || {};
    var profile = trim(route.profile || opts.profile) || 'default';
    var platform = detectPlatformSize(blob);
    if (platform) return platform;
    return detectProfileSize(profile, blob);
  }

  var NON_ECOM_PROFILES = {
    city: 1,
    citywalk: 1,
    education: 1,
    textbook: 1,
    poetry: 1,
    recipe: 1,
    fitness: 1,
    tcm: 1,
    herb: 1,
    skincare: 1,
    finance: 1,
    workplace: 1,
    fashion: 1,
    constellation: 1,
    lifecycle: 1,
    english_edu: 1,
    season_relief: 1,
    batch_series: 1,
    interior: 1,
    template_clone: 1,
    knowledge_infographic: 1,
    life_science: 1,
    pet: 1,
  };

  function isEcomLikeProfile(profile) {
    var p = trim(profile);
    if (!p || p === 'standard') return false;
    if (NON_ECOM_PROFILES[p]) return false;
    return /^(ecom|ecom_|cover)/.test(p);
  }

  function userExplicitPlatformSize(blob) {
    var t = trim(blob);
    if (!t) return '';
    if (/小红书|种草|笔记封面|图文详情/.test(t) && /3\s*:\s*4|3:4/.test(t)) return '3:4竖版';
    if (/小红书|种草|笔记封面/.test(t)) return '3:4竖版';
    if (/抖音|9\s*:\s*16|9:16/.test(t)) return '9:16竖版';
    if (/16\s*:\s*9|16:9|美团|横版|视频号|ppt/i.test(t)) return '16:9横版';
    if (/朋友圈|1\s*:\s*1|方图/.test(t)) return '1:1方图';
    return '';
  }

  function resolveDisplaySize(parsedSize, opts) {
    opts = opts || {};
    var topic = trim(opts.topic);
    var rawQuery = trim(opts.rawQuery);
    var blob = topic + ' ' + rawQuery;
    var prof = trim(opts.profile) || 'default';
    var system = resolveRecommendedSize({
      topic: topic,
      rawQuery: blob,
      profile: prof,
      route: { profile: prof },
    });
    if (!isEcomLikeProfile(prof)) return system;
    var explicit = userExplicitPlatformSize(blob);
    if (explicit) return explicit;
    if (!parsedSize || isAiRecommendedSize(parsedSize)) return system;
    var p = normalizeSizeLabel(parsedSize);
    if (p === system) return p;
    if (p === '3:4竖版' && /小红书|种草|3\s*:\s*4|3:4|笔记封面/.test(blob)) return p;
    if (p === '9:16竖版' && /抖音|9\s*:\s*16|9:16/.test(blob)) return p;
    if (p === '16:9横版' && /16\s*:\s*9|16:9|美团|横版|视频号/i.test(blob)) return p;
    if (p === '1:1方图' && /朋友圈|1\s*:\s*1|方图/.test(blob)) return p;
    return system;
  }

  global.LcAspectRatio = {
    resolveRecommendedSize: resolveRecommendedSize,
    resolveDisplaySize: resolveDisplaySize,
    normalizeSizeLabel: normalizeSizeLabel,
    isAiRecommendedSize: isAiRecommendedSize,
    isEcomLikeProfile: isEcomLikeProfile,
    userExplicitPlatformSize: userExplicitPlatformSize,
  };
})(typeof window !== 'undefined' ? window : global);

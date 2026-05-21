/**
 * 灵创星球 · 大白话主题路由（人主导：听懂用户话 → 匹配风格库 → 低置信度触发联网）
 */

const { ensureStyleLibFresh, pickBestSnippet } = require('./style-lib-loader.js');
const {
  classifyMdCategory,
  getUserTypeForCategory,
  pickMdStyle,
  detectSeason,
  getNetworkFallbackBlock,
} = require('./system-logic-data.js');

/** 路由表：关键词命中 → profile + 手法 + 品类模板锚点 */
const ROUTE_RULES = [
  {
    profile: 'lifecycle',
    humanLabel: '生长阶段·一生图解',
    technique: '手法三十二：实物横切生命周期对比法',
    categoryMarker: '',
    keys: ['的一生', '生命周期', '成熟阶段', '未熟', '过熟', '可采期', '完熟期', '初熟期', '生长阶段'],
    weight: 3,
  },
  {
    profile: 'english_edu',
    humanLabel: '小学英语·场景知识图解',
    technique: '手法五：场景叙事词汇法',
    categoryMarker: '▌英语知识卡专属结构模板',
    keys: [
      '英语课',
      '英语',
      'english',
      'unit',
      'lesson',
      '单元',
      '课时',
      '第一节',
      '第二节',
      '三年级',
      '四年级',
      '五年级',
      '六年级',
      '一年级',
      '二年级',
      '上册',
      '下册',
      '单词',
      '句型',
      '课文',
    ],
    weight: 2,
  },
  {
    profile: 'textbook',
    humanLabel: '教材单元·复习知识卡',
    technique: '手法九：超高密度三板块教材级知识卡法',
    categoryMarker: '',
    keys: ['总复习', '单元复习', '期末', '期中', '教材', '课本', '第几单元', '课时', '上册', '下册'],
    weight: 2,
  },
  {
    profile: 'poetry',
    humanLabel: '古诗·诗文图解',
    technique: '手法三十六：卷轴逐句场景解析法',
    categoryMarker: '',
    keys: ['古诗', '诗词', '诗歌', '文言文', '名句', '唐诗', '宋词', '静夜思', '背诵'],
    weight: 2,
  },
  {
    profile: 'recipe',
    humanLabel: '菜谱·分步教程图',
    technique: '手法二十二：分步骤菜谱教程卡法',
    categoryMarker: '',
    keys: ['做法', '菜谱', '食谱', '烹饪', '红烧', '煲汤', '烘焙', '怎么做', '步骤'],
    weight: 2,
  },
  {
    profile: 'fitness',
    humanLabel: '健身·动作分解图',
    technique: '手法四十：健身动作分解图法',
    categoryMarker: '',
    keys: ['健身', '减脂', '瑜伽', '深蹲', '训练动作', '运动'],
    weight: 2,
  },
  {
    profile: 'ecom',
    humanLabel: '电商·促销主图',
    technique: '手法四十四：平台封面专属模板法',
    categoryMarker: '',
    keys: ['电商', '主图', '详情页', '促销', '爆款海报', '带货', '秒杀', '5折', '推广海报', '二维码'],
    weight: 2,
  },
  {
    profile: 'ecom_image',
    humanLabel: '电商·单图海报（含上传图）',
    technique: '手法四十四：平台封面专属模板法',
    categoryMarker: '',
    keys: ['上传产品', '产品图', '产品海报', '做这个产品', '诱人', '筷子夹', '左下二维码', '推广海报'],
    weight: 4,
  },
  {
    profile: 'ecom_dual',
    humanLabel: '电商·双图融合（风格+产品）',
    technique: '手法四十四：平台封面专属模板法',
    categoryMarker: '',
    keys: ['图a', '图b', '图A', '图B', '风格参考', '双图', '融合'],
    weight: 5,
  },
  {
    profile: 'ecom_detail_exploded',
    humanLabel: '电商·拆解卖点详情图',
    technique: '手法四十五·产品爆炸拆解详情法',
    categoryMarker: '',
    keys: [
      '爆炸图',
      '拆解图',
      '分解图',
      '卖点拆解',
      '立体拆解',
      '结构图',
      '部件标注',
      '爆炸拆解',
    ],
    weight: 5,
  },
  {
    profile: 'interior',
    humanLabel: '家装·户型效果图',
    technique: '手法四十三：家装户型效果图法',
    categoryMarker: '',
    keys: ['家装', '户型', '客厅装修', '卧室设计', '效果图', '全屋', '软装'],
    weight: 3,
  },
  {
    profile: 'template_clone',
    humanLabel: '模板复刻·照着做',
    technique: '手法四十五：模板复刻法',
    categoryMarker: '',
    keys: ['复刻', '照着', '同款', '模仿这张', '参考图'],
    weight: 3,
  },
  {
    profile: 'batch_series',
    humanLabel: '系列卡·批量出图',
    technique: '手法三：结构化知识模块法',
    categoryMarker: '',
    keys: ['批量', '系列', '做10张', '做一套', '10张', '12张'],
    weight: 3,
  },
  {
    profile: 'cover',
    humanLabel: '平台封面·停滑版式',
    technique: '手法四十四：平台封面专属模板法',
    categoryMarker: '',
    keys: ['封面', '小红书封面', '抖音封面', '视频号封面', '头像尺寸'],
    weight: 3,
  },
  {
    profile: 'season_relief',
    humanLabel: '四季浮雕·3D地图',
    technique: '手法四十二：探店Citywalk地图法',
    categoryMarker: '▌城市文化专属结构模板',
    keys: ['浮雕', '春天的', '秋天的', '冬天的', '夏天的', '春季', '秋季', '冬季', '夏季色调'],
    weight: 3,
  },
  {
    profile: 'constellation',
    humanLabel: '星座·情感图解',
    technique: '手法三十七：星座人格解析法',
    categoryMarker: '',
    keys: ['星座', '天蝎座', '双鱼座', '狮子座', '配对', '人格'],
    weight: 2,
  },
  {
    profile: 'tcm',
    humanLabel: '中药本草·科普图',
    technique: '手法六：食材深度结构法',
    categoryMarker: '▌食疗科普专属结构模板',
    keys: ['枸杞', '当归', '黄芪', '陈皮', '本草', '中药', '功效'],
    weight: 2,
  },
  {
    profile: 'skincare',
    humanLabel: '护肤美妆·成分科普',
    technique: '手法三十八：护肤成分科普法',
    categoryMarker: '',
    keys: ['烟酰胺', '视黄醇', '护肤', '油皮', '敏感肌', '成分'],
    weight: 2,
  },
  {
    profile: 'workplace',
    humanLabel: '职场技能·方法论图',
    technique: '手法三十九：职场技能图解法',
    categoryMarker: '',
    keys: ['时间管理', '开会', '简历', '职场沟通', '四象限'],
    weight: 2,
  },
  {
    profile: 'fashion',
    humanLabel: '时尚搭配·穿搭公式',
    technique: '手法四十六：时尚穿搭公式法',
    categoryMarker: '',
    keys: ['穿搭', '搭配', '梨形身材', '通勤', '显高', '黑白灰'],
    weight: 2,
  },
  {
    profile: 'pet',
    humanLabel: '宠物科普·养护图解',
    technique: '手法三：结构化知识模块法',
    categoryMarker: '',
    keys: ['宠物', '猫咪', '狗狗', '养猫', '养狗'],
    weight: 2,
  },
  {
    profile: 'city',
    humanLabel: '城市·探店漫游图',
    technique: '手法四十二：探店Citywalk地图法',
    categoryMarker: '▌城市文化专属结构模板',
    keys: ['旅游', '攻略', '探店', 'citywalk', '景点', '古城', '古镇', '夜市'],
    weight: 2,
  },
  {
    profile: 'finance',
    humanLabel: '财经·知识可视化',
    technique: '手法四十一：财经知识可视化法',
    categoryMarker: '',
    keys: ['理财', '基金', '股票', '复利', '财经', '保险'],
    weight: 2,
  },
  {
    profile: 'food_therapy',
    humanLabel: '食疗·本草科普图',
    technique: '手法六：食材深度结构法',
    categoryMarker: '▌食疗科普专属结构模板',
    keys: ['食疗', '中药', '本草', '枸杞', '当归', '养生汤', '药食'],
    weight: 2,
  },
  {
    profile: 'knowledge_infographic',
    humanLabel: '知识图解·信息卡片',
    technique: '手法三：结构化知识模块法',
    categoryMarker: '',
    keys: ['知识图解', '知识图', '科普', '图解', '原理', '知识卡', '思维导图'],
    weight: 1,
  },
];

const STYLE_POOLS = {
  lifecycle: ['写实剖面科普', '暖色生长时间轴', '对比表+剖面双栏', '微距质感特写', '信息图+图标注解'],
  english_edu: ['小学英语场景卡', '教室情景词汇墙', '漫画气泡对话', '高密度三板块教材卡', '游戏化闯关场景'],
  poetry: ['水墨卷轴', '工笔淡彩', '青绿山水', '复古线描', '现代扁平古诗卡'],
  recipe: ['美食摄影写实', '分步插画教程', '暖色厨房场景', '俯拍食材摆盘', '手绘菜谱卡'],
  city: ['Citywalk手绘地图', '探店打卡拼贴', '复古旅游海报', '3D浮雕城市', '夜景霓虹漫游'],
  ecom: ['促销主图冲击', '极简白底产品', '节日氛围场景', '美食诱人特写', '国潮礼盒风'],
  ecom_image: ['电商主图爆款', '左下二维码预留区', '筷子夹产品特写', '详情页长图首屏', '直播切片风'],
  ecom_detail_exploded: [
    '产品爆炸拆解风',
    '悬浮部件标注',
    '科技剖面详情',
    '卖点引线长图',
    '竖版拆解详情',
  ],
  knowledge_infographic: ['扁平信息图', '3D微缩场景', '手绘科普', '高密度知识卡', '杂志 editorial'],
  default: ['爆款知识图解', '小红书竖版信息图', '高饱和科普卡', '柔光教育插画', '写实+标注混合'],
};

const KNOWLEDGE_PROFILES = {
  lifecycle: 1,
  english_edu: 1,
  textbook: 1,
  poetry: 1,
  recipe: 1,
  fitness: 1,
  knowledge_infographic: 1,
  food_therapy: 1,
  finance: 1,
  city: 1,
  constellation: 1,
  tcm: 1,
  skincare: 1,
  workplace: 1,
  fashion: 1,
  pet: 1,
  batch_series: 1,
  season_relief: 1,
  ecom: 1,
  ecom_image: 1,
  ecom_dual: 1,
  ecom_detail_exploded: 1,
  interior: 1,
  template_clone: 1,
  cover: 1,
};

function hashTopicSeed(s) {
  let h = 0;
  const str = String(s || '');
  for (let i = 0; i < str.length; i++) {
    h = (h << 5) - h + str.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

function pickRandomStyle(profile, topic, reshuffle) {
  const pool = STYLE_POOLS[profile] || STYLE_POOLS.default;
  const idx = reshuffle
    ? Math.floor(Math.random() * pool.length)
    : hashTopicSeed(topic) % pool.length;
  return pool[idx];
}

function isEcomProfile(profile) {
  return (
    profile === 'ecom' ||
    profile === 'ecom_image' ||
    profile === 'ecom_dual' ||
    profile === 'ecom_detail_exploded'
  );
}

function detectSpecialOverrides(blob, opts) {
  const o = opts || {};
  const hasFile = !!o.hasFile;
  const lower = blob.toLowerCase();
  if (/图a|图b|风格参考|双图融合/.test(lower)) {
    return ROUTE_RULES.find(function (r) {
      return r.profile === 'ecom_dual';
    });
  }
  if (
    hasFile &&
    /爆炸图|爆炸拆解|立体拆解|卖点拆解|拆解图|分解图|部件标注|结构爆炸|剖面拆解/.test(
      blob
    )
  ) {
    return ROUTE_RULES.find(function (r) {
      return r.profile === 'ecom_detail_exploded';
    });
  }
  if (
    hasFile &&
    /海报|详情|诱人|食欲|餐饮|美食|火锅|牛蛙|美蛙|蛙|菜品|产品|主图|推广|二维码|带货|128|元\/份|元\/斤/.test(
      blob
    )
  ) {
    const ecom = ROUTE_RULES.find(function (r) {
      return r.profile === 'ecom_image';
    });
    if (ecom) {
      const isFood = /餐饮|美食|火锅|蛙|菜品|招牌|烧烤|茶饮|咖啡|烘焙|炭烤|锅/.test(
        blob
      );
      return Object.assign({}, ecom, {
        technique: isFood
          ? '手法二十二B·餐饮电商海报法'
          : ecom.technique,
        humanLabel: isFood
          ? '餐饮电商海报·上传图'
          : '电商·单图海报（含上传图）',
      });
    }
  }
  if (/批量|系列|做10张|做一套/.test(blob)) {
    return ROUTE_RULES.find(function (r) {
      return r.profile === 'batch_series';
    });
  }
  if (/封面|小红书封面|抖音封面|视频号封面/.test(blob)) {
    return ROUTE_RULES.find(function (r) {
      return r.profile === 'cover';
    });
  }
  if (/浮雕|春天的|秋天的|冬天的|夏天的|春季色调|秋季色调/.test(blob)) {
    return ROUTE_RULES.find(function (r) {
      return r.profile === 'season_relief';
    });
  }
  if (/家装|户型|客厅装修|软装设计/.test(blob)) {
    return ROUTE_RULES.find(function (r) {
      return r.profile === 'interior';
    });
  }
  if (/复刻|照着.*做|同款模板/.test(blob)) {
    return ROUTE_RULES.find(function (r) {
      return r.profile === 'template_clone';
    });
  }
  return null;
}

function safeStr(v, fallback) {
  const s = v == null ? '' : String(v).trim();
  return s || fallback || '';
}

function scoreRule(rule, blob) {
  const lower = blob.toLowerCase();
  let score = 0;
  rule.keys.forEach(function (k) {
    if (!k) return;
    if (lower.indexOf(String(k).toLowerCase()) !== -1) {
      score += rule.weight || 1;
    }
  });
  return score;
}

function extractCategoryBlock(raw, marker) {
  if (!raw || !marker) return '';
  const start = raw.indexOf(marker);
  if (start === -1) return '';
  const next = raw.indexOf('\n▌', start + 3);
  const end = next === -1 ? start + 1800 : Math.min(next, start + 1800);
  return raw.slice(start, end).trim();
}

function extractTechniqueLine(raw, techniqueName) {
  if (!raw || !techniqueName) return '';
  const short = techniqueName.split('：')[0];
  const idx = raw.indexOf(short);
  if (idx === -1) return techniqueName;
  const rest = raw.slice(idx);
  const next = rest.search(/\n手法[一二三四五六七八九十百千零\d]/);
  const body = next === -1 ? rest.slice(0, 900) : rest.slice(0, next);
  return body.trim();
}

/**
 * 大白话 → 路由结果
 * @returns {{
 *   profile: string,
 *   technique: string,
 *   humanLabel: string,
 *   confidence: number,
 *   needWebSearch: boolean,
 *   searchQuery: string,
 *   categorySnippet: string,
 *   techniqueSnippet: string
 * }}
 */
function routePlainLanguageTopic(topic, rawQuery, rootDir, options) {
  const t = safeStr(topic, '');
  const q = safeStr(rawQuery, t);
  const blob = t + ' ' + q;
  const opts = options || {};
  const hasFileHint = !!opts.hasFile;
  const imageCount = Math.max(0, parseInt(opts.imageCount, 10) || 0);

  const md = classifyMdCategory(blob, opts);

  let override = detectSpecialOverrides(blob, opts);
  if (imageCount >= 2) {
    const dual = ROUTE_RULES.find(function (r) {
      return r.profile === 'ecom_dual';
    });
    if (dual) override = dual;
  }
  let best = override || null;
  let bestScore = override ? 99 : 0;

  if (!override) {
    const profileTarget = md.profile === 'citywalk' ? 'city' : md.profile;
    const found = ROUTE_RULES.find(function (r) {
      return r.profile === profileTarget;
    });
    best = found
      ? Object.assign({}, found, {
          technique: md.technique,
          humanLabel: md.categoryName,
        })
      : Object.assign({}, ROUTE_RULES[ROUTE_RULES.length - 1], {
          technique: md.technique,
          humanLabel: md.categoryName,
        });
    bestScore = md.isFallback ? 1 : 4;
  }

  const lib = ensureStyleLibFresh(rootDir || require('path').join(__dirname));
  const raw = lib.raw || '';
  const categorySnippet = extractCategoryBlock(raw, best.categoryMarker);
  const techniqueSnippet = extractTechniqueLine(raw, best.technique);

  let confidence = Math.min(1, bestScore / 6);
  if (bestScore === 0) confidence = 0.2;
  if (bestScore >= 4) confidence = Math.max(confidence, 0.75);

  const needWebSearch = confidence < 0.55 || !lib.ok;

  const searchQuery =
    t +
    ' ' +
    (best.humanLabel || '') +
    ' 知识图解 爆款 排版 小红书 抖音 2024 2025';

  const extraSnippets = pickBestSnippet(lib.extracted?.categories || [], [t, q, best.technique], 1);
  const reshuffle = /换一套|换风格|重新随机|^2$|回复\s*2/.test(q);
  const season = detectSeason(blob);
  const poolKey = override
    ? best.profile
    : md.templateKey || md.categoryId || best.profile;
  const randomStyleName = pickMdStyle(
    poolKey,
    t + '|' + q,
    opts.usedStyleNames || [],
    !!(season || /3d|3D|浮雕/.test(blob))
  );

  return {
    profile: best.profile,
    technique: best.technique,
    humanLabel: best.humanLabel,
    confidence: confidence,
    needWebSearch: needWebSearch,
    searchQuery: searchQuery.trim(),
    categorySnippet: categorySnippet || (extraSnippets[0] || '').slice(0, 1200),
    techniqueSnippet: techniqueSnippet,
    styleLibLoaded: !!lib.ok,
    randomStyleName: randomStyleName,
    reshuffleStyle: reshuffle,
    mdCategoryId: md.categoryId,
    mdCategoryName: md.categoryName,
    mdTemplateKey: override ? best.profile : md.templateKey,
    userType: getUserTypeForCategory(md.categoryId),
    networkFallbackBlock: getNetworkFallbackBlock(),
  };
}

function isKnowledgeProfile(profile) {
  return !!KNOWLEDGE_PROFILES[profile];
}

function buildHumanFirstBlock(topic, rawQuery) {
  return (
    '【人主导·最高优先级·灵创星球产品铁律】\n' +
    '用户不会提示词、不懂专业术语（可能是老人或小学生家长）。你的任务是：听懂下面这句大白话，替用户选好爆款画法并生成可出图内容。\n' +
    '严禁要求用户补充「风格词/英文 Prompt/专业参数」。严禁用系统菜单、分析术语吓唬用户。\n' +
    '【用户心里所想·必须100%落实】\n' +
    topic +
    '\n【用户原话】\n' +
    rawQuery
  );
}

function buildWebSearchFallbackBlock(route) {
  const r = route || {};
  if (!r.needWebSearch) {
    return (
      '【风格库已命中】请优先严格执行下方注入的「品类专属模板」与「手法库」条目，达到与扣子智能体直聊相同的结构与密度。'
    );
  }
  return (
    '【风格库未充分命中·必须联网补爆款·最高优先级】\n' +
    '① 务必先调用联网搜索插件，检索：「' +
    (r.searchQuery || '') +
    '」。\n' +
    '② 从搜索结果提炼：版式结构、配色、信息密度、主视觉占比、常见模块（标题区/表格/气泡/图标）。\n' +
    '③ 将提炼结果与知识库最接近的模板融合，禁止输出空壳表格或无主体空镜。\n' +
    '④ 禁止让用户自己查资料或补专业词——系统替用户完成。'
  );
}

function usesFullCozePackage(profile) {
  return (
    !!KNOWLEDGE_PROFILES[profile] ||
    profile === 'ecom' ||
    profile === 'ecom_image' ||
    profile === 'ecom_dual' ||
    profile === 'ecom_detail_exploded' ||
    profile === 'interior' ||
    profile === 'template_clone' ||
    profile === 'cover'
  );
}

function getStylePoolForProfile(profile) {
  const pool = STYLE_POOLS[profile] || STYLE_POOLS.default;
  return Array.isArray(pool) ? pool.slice() : [];
}

module.exports = {
  routePlainLanguageTopic,
  isEcomProfile,
  isKnowledgeProfile,
  usesFullCozePackage,
  buildHumanFirstBlock,
  buildWebSearchFallbackBlock,
  KNOWLEDGE_PROFILES,
  pickRandomStyle,
  getStylePoolForProfile,
};

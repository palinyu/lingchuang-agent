/**
 * 灵创星球 · 工业级生图知识库加载器（lingchuang_sop / style_lib 外挂）
 * 启动时加载，请求时按 mtime 热更新；供 prompt-engine 注入 System Prompt。
 */

const fs = require('fs');
const path = require('path');

const MAX_DISTILLED_CHARS = 14000;
const MAX_TECHNIQUE_SNIPPET = 2200;
const MAX_CATEGORY_SNIPPET = 1800;

/** SOP 全局 Quality 收尾句（与知识库第 728–730 行对齐） */
const SOP_QUALITY_FOOTER =
  'high information density, rich visual elements, multi-layer layout with background texture content and decoration layers, at least 5 different visual element types, no excessive whitespace, professional editorial design quality';

/** 工业级负面提示词（知识库合规 + 画质禁令汇总） */
const INDUSTRIAL_NEGATIVE_PROMPTS = [
  'low quality',
  'blurry',
  'jpeg artifacts',
  'watermark',
  'logo',
  'deformed',
  'ugly',
  'bad anatomy',
  'extra limbs',
  'mutated hands',
  'oversaturated',
  'noisy',
  'cluttered layout',
  'excessive whitespace over 30% of frame',
  'flat solid color background without texture',
  'single module only',
  'low contrast text',
  'illegible compressed text',
  'top view',
  'floor plan',
  'bird eye view',
  'overhead view',
  '2D sketch only',
  'cartoonish 3D when photorealism required',
  'no text',
  'no letters',
  'no words',
  'no typography',
  'trademark',
  'branded packaging',
  'corporate mascot',
  'recognizable logo',
].join(', ');

/** 极品画质 / 光影 / 镜头术语池（强制扩写时从中抽取组合） */
const QUALITY_KEYWORDS =
  '8k resolution, ultra-photorealistic, highly detailed texture, masterpiece, best quality, cinematic lighting, dramatic shadows, volumetric light, rim light, soft box lighting, golden hour, ray tracing, photorealistic materials, shallow depth of field, bokeh, macro photography, 85mm lens, 35mm lens, wide angle establishing shot, dutch angle, rule of thirds, professional composition, National Geographic style, commercial advertising photography';

const LENS_LIGHTING_TERMS =
  'cinematic lighting, volumetric god rays, studio softbox, backlit silhouette, chiaroscuro, lens flare controlled, f/1.8 shallow DOF, 24mm wide environmental shot, 50mm standard, 100mm macro detail';

const ZH_EN_ISOLATION_LOCK =
  '【中英隔离风格锁 · 铁律】\n' +
  '① 分析面板、菜单、步骤说明、合规免责声明：仅中文。\n' +
  '② 「完整版（推荐）」生图 Prompt：必须一整段纯英文（仅允许 --ar / --v 参数）；禁止中英夹杂、禁止在英文段内写中文模块名。\n' +
  '③ 画面若需「中英双语排版」：在英文 Prompt 中用 bilingual layout labels / Chinese and English typographic zones 描述版式，不得直接粘贴中文诗句进英文段。\n' +
  '④ 风格【style】与手法【technique】必须映射到下方知识库已登记的品类模板 / 手法库 / 风格池条目，禁止自造未登记风格名。\n' +
  '⑤ 简略用户输入必须先经「防呆 SOP」扩写，再填入对应模板槽位，禁止模型自由发挥跳过模板。';

const KEYFRAME_MATRIX_RULE =
  '【关键帧矩阵 · 动作/步骤类】当手法含「分解」「步骤」「健身」「菜谱流程」时：英文 Prompt 的 visual layer 必须写明 3–5 key action frames / step panels，每帧含 pose or step illustration + short English label slot（画面内中文由即梦渲染，Prompt 用 clear readable Chinese typography zones 描述，不写具体敏感文案）。';

let cache = null;

function resolveStyleLibPaths(rootDir) {
  const root = rootDir || path.join(__dirname);
  const parent = path.join(root, '..');
  const list = [
    process.env.LINGCHUANG_SOP_PATH,
    process.env.STYLE_LIB_PATH,
    path.join(root, 'lingchuang_sop.json'),
    path.join(root, 'style_lib.json'),
    path.join(root, 'style_lib.txt'),
    path.join(parent, 'lingchuang_sop.json'),
    path.join(parent, 'style_lib.json'),
    path.join(parent, 'style_lib.txt'),
  ];
  return list.filter(Boolean);
}

function readFirstExisting(paths) {
  for (let i = 0; i < paths.length; i++) {
    const p = paths[i];
    try {
      if (fs.existsSync(p) && fs.statSync(p).isFile()) {
        const raw = fs.readFileSync(p, 'utf8');
        if (raw && raw.trim()) {
          return { path: p, raw: raw, mtimeMs: fs.statSync(p).mtimeMs };
        }
      }
    } catch (e) {
      // try next path
    }
  }
  return null;
}

function extractSection(raw, startMarker, endMarkers) {
  const start = raw.indexOf(startMarker);
  if (start === -1) return '';
  let end = raw.length;
  const sliceFrom = start + startMarker.length;
  for (let i = 0; i < endMarkers.length; i++) {
    const pos = raw.indexOf(endMarkers[i], sliceFrom);
    if (pos !== -1 && pos < end) end = pos;
  }
  return raw.slice(start, end).trim();
}

function extractTechniqueEntries(raw) {
  const entries = [];
  const re = /手法[一二三四五六七八九十百千零\d]+[：:][^\n]+/g;
  let m;
  while ((m = re.exec(raw)) !== null) {
    const lineStart = m.index;
    const next = raw.indexOf('\n手法', lineStart + 2);
    const chunk = raw.slice(lineStart, next === -1 ? lineStart + MAX_TECHNIQUE_SNIPPET : Math.min(next, lineStart + MAX_TECHNIQUE_SNIPPET));
    entries.push(chunk.trim());
    if (entries.length >= 55) break;
  }
  return entries;
}

function extractCategoryTemplates(raw) {
  const blocks = [];
  const re = /▌[^\n]+专属结构模板/g;
  let m;
  while ((m = re.exec(raw)) !== null) {
    const lineStart = m.index;
    const next = raw.indexOf('\n▌', lineStart + 3);
    const end = next === -1 ? lineStart + MAX_CATEGORY_SNIPPET : Math.min(next, lineStart + MAX_CATEGORY_SNIPPET);
    blocks.push(raw.slice(lineStart, end).trim());
    if (blocks.length >= 24) break;
  }
  return blocks;
}

function scoreMatch(text, keywords) {
  if (!text || !keywords.length) return 0;
  const lower = text.toLowerCase();
  let score = 0;
  keywords.forEach(function (kw) {
    if (!kw) return;
    if (lower.indexOf(String(kw).toLowerCase()) !== -1) score += 1;
  });
  return score;
}

function pickBestSnippet(snippets, labels, limit) {
  const keys = labels
    .map(function (s) {
      return String(s || '')
        .replace(/[（）()【】\s]/g, '')
        .toLowerCase();
    })
    .filter(Boolean);
  if (!keys.length) return snippets.slice(0, limit);

  const scored = snippets
    .map(function (snippet) {
      return { snippet: snippet, score: scoreMatch(snippet, keys) };
    })
    .sort(function (a, b) {
      return b.score - a.score;
    });

  const hits = scored.filter(function (x) {
    return x.score > 0;
  });
  const pick = (hits.length ? hits : scored).slice(0, limit);
  return pick.map(function (x) {
    return x.snippet;
  });
}

/** 手法46-49 详细规范（独立块，避免索引行-only 摘录丢失细节） */
function extractTechniquePatch46_49(raw) {
  const start = raw.indexOf('手法四十六详细规范');
  if (start === -1) return '';
  const end = raw.indexOf('手法三十二：实物横切', start);
  const chunk = end === -1 ? raw.slice(start, start + 4500) : raw.slice(start, end);
  return chunk.trim().slice(0, 4500);
}

/** 手法三十二：一生 / 生命周期（横切剖面五阶段） */
const TECHNIQUE_32_TRIGGERS = {
  line: '手法三十二：实物横切生命周期对比法',
  startMarker: '手法三十二：实物横切生命周期对比法',
  endMarker: '手法三十三',
  keys: [
    '一生',
    '生命周期',
    '生长阶段',
    '成熟阶段',
    '阶段对比',
    '剖面',
    '横切',
    '未熟',
    '过熟',
    '可采',
    '完熟',
    '荔枝',
    '榴莲',
    '石榴',
    '枇杷',
    '芒果',
    '桃子',
    '苹果的一生',
    '人的一生',
    '人生',
    '婴儿',
    '童年',
    '老年',
  ],
};

function extractTechniquePatch32(raw) {
  const start = raw.indexOf(TECHNIQUE_32_TRIGGERS.startMarker);
  if (start === -1) return '';
  const end = raw.indexOf(TECHNIQUE_32_TRIGGERS.endMarker, start + 10);
  const chunk =
    end === -1 ? raw.slice(start, start + 2200) : raw.slice(start, Math.min(end, start + 2200));
  return chunk.trim();
}

function pickTechnique32Hits(topic, technique, style, patchBlock) {
  const blob = [topic, technique, style].join(' ');
  const matched = TECHNIQUE_32_TRIGGERS.keys.some(function (k) {
    return blob.indexOf(k) !== -1;
  });
  if (!matched) return [];
  const hits = [TECHNIQUE_32_TRIGGERS.line];
  const detail = patchBlock || '';
  if (detail) hits.push(detail.slice(0, 1800));
  return hits;
}

/** 用户主题关键词 → 强制注入对应新手法（46-49） */
const TECHNIQUE_46_49_TRIGGERS = [
  {
    detailMarker: '手法四十六详细规范',
    keys: ['佛像', '菩萨', '石窟', '寺庙', '古建', '禅', '僧侣', '奇观', '国学', '宗教', '龙门', '白马寺'],
    line: '手法四十六：极致尺度对比震撼法',
  },
  {
    detailMarker: '手法四十七详细规范',
    keys: ['萌宠', '宠物', '猫咪', '小猫', '小狗', '破框', '穿屏', '抖音', '小红书封面', '破屏'],
    line: '手法四十七：社交平台破框穿越法',
  },
  {
    detailMarker: '手法四十八详细规范',
    keys: ['城市宣传', '旅游宣传', '文旅', '城市推广', '景区', '海报', '项王', '酒都', '水城', '城市名片'],
    line: '手法四十八：城市文旅史诗海报法',
  },
  {
    detailMarker: '手法四十九详细规范',
    keys: ['古镇', '夜市', '夜景', '灯光', '烟花', '古城', '灯火', '人间烟火', '洛邑', '灯会'],
    line: '手法四十九：古城夜景璀璨繁华法',
  },
];

function sliceDetailBlock(patchBlock, marker) {
  if (!patchBlock || !marker) return '';
  const start = patchBlock.indexOf(marker);
  if (start === -1) return '';
  const rest = patchBlock.slice(start + marker.length);
  const next = rest.search(/\n手法四[七八九十]/);
  const body = next === -1 ? rest : rest.slice(0, next);
  return (marker + body).trim().slice(0, 1200);
}

function pickTechnique46_49Hits(topic, technique, style, patchBlock, indexLines) {
  const blob = [topic, technique, style].join(' ');
  const hits = [];
  TECHNIQUE_46_49_TRIGGERS.forEach(function (t) {
    const matched = t.keys.some(function (k) {
      return blob.indexOf(k) !== -1;
    });
    if (!matched) return;
    const idxLine =
      (indexLines || []).find(function (line) {
        return line.indexOf(t.line) === 0;
      }) || t.line;
    hits.push(idxLine);
    const detail = sliceDetailBlock(patchBlock, t.detailMarker);
    if (detail) hits.push(detail);
  });
  return hits;
}

function extractKnowledge(raw) {
  const jimengBlock = extractSection(raw, '【即梦字符压缩规则', [
    '【全局排版密度规则',
    '---\n\n【全局',
  ]);
  const densityBlock = extractSection(raw, '【全局排版密度规则', [
    '【提示词末尾附加Quality',
    '---\n\n⚠️ 以下为平台合规',
  ]);
  const complianceBlock = extractSection(raw, '⚠️ 以下为平台合规输出规范', [
    '▌第一步：赛道识别',
    '▌第一步：赛道识别→',
  ]);

  return {
    qualityFooter: SOP_QUALITY_FOOTER,
    jimengCharLimit: 1600,
    fourLayerHint:
      '风格层(~200字)+结构层(~800字)+视觉层(~600字)+收尾层(~200字质量词固定复用)',
    jimengRules: jimengBlock || '提示词上限1600字符；输出前自检压缩。',
    densityRules: densityBlock,
    complianceRules: complianceBlock,
    negativePrompts: INDUSTRIAL_NEGATIVE_PROMPTS,
    qualityKeywords: QUALITY_KEYWORDS,
    lensLighting: LENS_LIGHTING_TERMS,
    zhEnIsolation: ZH_EN_ISOLATION_LOCK,
    keyframeMatrix: KEYFRAME_MATRIX_RULE,
    techniques: extractTechniqueEntries(raw),
    categories: extractCategoryTemplates(raw),
    techniquePatch46_49: extractTechniquePatch46_49(raw),
  };
}

function buildDistilledCore(extracted, raw) {
  const parts = [
    '=== 知识库摘要（防呆·必须遵守） ===',
    extracted.zhEnIsolation,
    extracted.keyframeMatrix,
    '【即梦压缩】' + extracted.jimengRules.slice(0, 800),
    '【排版密度】' + (extracted.densityRules || '').slice(0, 1200),
    '【Quality收尾·每条英文Prompt末尾追加】' + extracted.qualityFooter,
    '【负面约束 Negative】' + extracted.negativePrompts,
    '【画质词池】' + extracted.qualityKeywords,
    '【光影镜头池】' + extracted.lensLighting,
  ];

  const matchedCategories = extracted.categories.slice(0, 6).join('\n\n');
  const matchedTechniques = extracted.techniques.slice(0, 8).join('\n\n');
  if (matchedCategories) parts.push('【品类模板摘录】\n' + matchedCategories);
  if (matchedTechniques) parts.push('【手法库摘录】\n' + matchedTechniques);

  let text = parts.join('\n\n');
  if (text.length < 2000 && raw) {
    text += '\n\n【原文节选】\n' + raw.slice(0, Math.min(6000, raw.length));
  }
  if (text.length > MAX_DISTILLED_CHARS) {
    text = text.slice(0, MAX_DISTILLED_CHARS) + '\n…(知识库已截断，以上规则仍具最高优先级)';
  }
  return text;
}

function loadStyleLib(rootDir, forceReload) {
  const root = rootDir || path.join(__dirname);
  const paths = resolveStyleLibPaths(root);

  if (cache && !forceReload) {
    const hit = readFirstExisting(paths);
    if (hit && cache.mtimeMs === hit.mtimeMs && cache.rootDir === root) {
      return cache;
    }
  }

  const file = readFirstExisting(paths);
  if (!file) {
    cache = {
      ok: false,
      path: '',
      rootDir: root,
      mtimeMs: 0,
      raw: '',
      extracted: extractKnowledge(''),
      distilled: '',
      error: '未找到 lingchuang_sop.json / style_lib 文件',
    };
    cache.distilled = buildDistilledCore(cache.extracted, '');
    return cache;
  }

  const extracted = extractKnowledge(file.raw);
  cache = {
    ok: true,
    path: file.path,
    rootDir: root,
    mtimeMs: file.mtimeMs,
    raw: file.raw,
    extracted: extracted,
    distilled: buildDistilledCore(extracted, file.raw),
    error: '',
  };
  return cache;
}

function initStyleLib(rootDir) {
  return loadStyleLib(rootDir, true);
}

function ensureStyleLibFresh(rootDir) {
  return loadStyleLib(rootDir, false);
}

function getStyleLibStatus() {
  const lib = cache || { ok: false, path: '', raw: '', error: '未初始化' };
  return {
    loaded: !!lib.ok,
    path: lib.path || '',
    chars: (lib.raw && lib.raw.length) || 0,
    mtimeMs: lib.mtimeMs || 0,
    error: lib.error || '',
  };
}

function getQualityFooter() {
  ensureStyleLibFresh(path.join(__dirname));
  return (cache && cache.extracted && cache.extracted.qualityFooter) || SOP_QUALITY_FOOTER;
}

function getJimengCharLimit() {
  return 1600;
}

/**
 * 构建注入 Coze 的 System 外挂块
 */
function buildStyleLibSystemBlock(opts) {
  const o = opts || {};
  const rootDir = o.rootDir || path.join(__dirname);
  const lib = ensureStyleLibFresh(rootDir);
  const intent = o.intent || 'analyze';
  const hasFile = !!o.hasFile;
  const topic = o.topic || o.coreTopic || '';
  const style = o.style || '';
  const technique = o.technique || '';
  const extracted = lib.extracted || extractKnowledge('');

  if (intent === 'analyze' && hasFile) {
    return (
      '【STEP1·看图分析·精简知识库注入】\n' +
      '禁用「电商单图海报模式」第④步：禁止输出「已识别你的产品+三方案+询问平台」。\n' +
      '必须：先看图+读文字定 1.品类判定，再在该品类下选 5.本次随机风格（全品类，非仅餐饮）。格式：✅内容识别 → 1.品类判定 → … → 6.推荐理由。\n' +
      '匹配手法须写：' +
      (String(technique || '').trim() || '手法二十二B方案（视觉优先菜谱卡）') +
      '。'
    );
  }

  const techniqueHits = pickBestSnippet(extracted.techniques || [], [technique, topic, style], 3);
  const patch32 = extractTechniquePatch32(lib.raw || '');
  const patch32Hits = pickTechnique32Hits(topic, technique, style, patch32);
  const patch46_49 = pickTechnique46_49Hits(
    topic,
    technique,
    style,
    extracted.techniquePatch46_49,
    extracted.techniques
  );
  const categoryHits = pickBestSnippet(extracted.categories || [], [topic, style, technique], 2);

  const lines = [
    '【灵创星球·工业级生图知识库·System Prompt 外挂·优先级高于模型自由发挥】',
    lib.ok
      ? '知识库文件：' + lib.path + '（' + (lib.raw && lib.raw.length) + ' 字符）'
      : '⚠️ 知识库文件未加载，以下内置铁律仍强制执行：' + (lib.error || ''),
    extracted.zhEnIsolation,
    extracted.keyframeMatrix,
    '【防呆 SOP · 模板映射铁律】\n' +
      '用户主题【' +
      topic +
      '】| 风格【' +
      style +
      '】| 手法【' +
      technique +
      '】\n' +
      '执行顺序：降噪 → 主体提取 → 从知识库匹配最接近的「品类专属结构模板」+「手法库」条目 → 将简略词扩写入模板各模块槽位 → 再生成英文 Prompt。\n' +
      '禁止：跳过模板自由编造版式；禁止与主题无关的节日/营销套版；禁止输出菜单废话。',
    '【极品画质词·强制注入】' + extracted.qualityKeywords,
    '【光影与镜头·强制注入】' + extracted.lensLighting,
    '【负面提示词 Negative Prompts·生图时语义排除】' + extracted.negativePrompts,
    '【即梦/MJ 字符与四层结构】上限 ' +
      extracted.jimengCharLimit +
      ' 字符；' +
      extracted.fourLayerHint +
      '；超长必须按风格/结构/视觉/收尾四层压缩后再输出。',
    '【Quality 收尾句·完整版英文 Prompt 末尾必须包含（在 Masters 尾巴之后或合并入质量段）】' +
      extracted.qualityFooter,
  ];

  if (patch32Hits.length) {
    lines.push(
      '【手法库·三十二·一生/生命周期·主题命中·必须遵循】\n' + patch32Hits.join('\n\n---\n\n')
    );
  }
  if (patch46_49.length) {
    lines.push(
      '【手法库·46-49补丁·主题命中·必须遵循】\n' + patch46_49.join('\n\n---\n\n')
    );
  }
  if (techniqueHits.length) {
    lines.push(
      '【手法库·匹配条目·必须遵循其「核心结构」排版】\n' + techniqueHits.join('\n\n---\n\n')
    );
  }
  if (categoryHits.length) {
    lines.push(
      '【品类专属模板·匹配条目·模块不可省略】\n' + categoryHits.join('\n\n---\n\n')
    );
  }

  if (intent === 'prompt' || intent === 'custom') {
    lines.push(
      '【生图输出死命令】只输出「完整版（推荐）」+ 一整段英文 Prompt；Masters 强制尾巴 + Quality 收尾句均不可删；先 SOP 扩写再套模板；严禁输出方括号占位说明（如[对应品类…]）；必须写真实英文正文；严禁 text/letters/typography 类词（仅允许 no text/no letters/no words 作负面）。'
    );
  } else if (intent === 'copywrite') {
    lines.push(
      '【合规文案】输出须符合知识库平台合规替换规则；中药/理财/收益类必须带免责声明。'
    );
    if (extracted.complianceRules) {
      lines.push(extracted.complianceRules.slice(0, 2000));
    }
  } else {
    lines.push(
      '【分析任务】用中文输出结构化分析；匹配手法/风格/尺寸须引用知识库登记名称，不得虚构。'
    );
  }

  if (lib.distilled && (intent === 'prompt' || intent === 'custom')) {
    lines.push('【知识库蒸馏附录】\n' + lib.distilled.slice(0, 8000));
  }

  return lines.join('\n\n');
}

module.exports = {
  initStyleLib,
  ensureStyleLibFresh,
  getStyleLibStatus,
  pickBestSnippet,
  buildStyleLibSystemBlock,
  getQualityFooter,
  getJimengCharLimit,
  SOP_QUALITY_FOOTER,
  INDUSTRIAL_NEGATIVE_PROMPTS,
  MASTERS_MANDATORY_TAIL:
    'Cinematic lighting, 8k resolution, ultra-photorealistic, highly detailed texture, professional composition, masterpiece, best quality --v 6.0',
};

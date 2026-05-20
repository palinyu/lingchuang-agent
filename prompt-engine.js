/**
 * 灵创星球 · Coze Prompt 组装与响应提纯引擎
 */

const {
  buildStyleLibSystemBlock,
  getQualityFooter,
  getJimengCharLimit,
} = require('./style-lib-loader.js');
const {
  routePlainLanguageTopic,
  isKnowledgeProfile,
  usesFullCozePackage,
  buildHumanFirstBlock,
  buildWebSearchFallbackBlock,
} = require('./topic-router.js');
const {
  parseCozeOutputPackage,
  validateCozePackage,
} = require('./coze-output-parser.js');

const FLUFF_LINE_RE =
  /^(好的|好的！|确认|确认后|确认后直接出图|我要换|换一套|用这套|建议回复|【建议|⭕|💡|👆|长按|复制\s*→|打开即梦|发送任意|支持四种|我是灵创|欢迎使用|灵创星球·|✅)/;

const MENU_LINE_RE =
  /(我要换尺寸|我要自定义|换一套风格|用这套风格|确认后直接出图|建议回复选项)/;

/** 大师级画质：最低字符数与强制结尾模板 */
const MIN_MASTERS_PROMPT_CHARS = 300;
const MASTERS_MANDATORY_TAIL =
  'Cinematic lighting, 8k resolution, ultra-photorealistic, highly detailed texture, professional composition, masterpiece, best quality --v 6.0';

const MASTERS_REQUIRED_PHRASES = [
  { test: /cinematic\s+lighting/i, label: 'cinematic lighting' },
  { test: /\b8k\b/i, label: '8k resolution' },
  { test: /ultra-?photorealistic/i, label: 'ultraphotorealistic' },
  { test: /highly\s+detailed(\s+texture)?/i, label: 'highly detailed texture' },
  { test: /professional\s+composition/i, label: 'professional composition' },
  { test: /\bmasterpiece\b/i, label: 'masterpiece' },
  { test: /best\s+quality/i, label: 'best quality' },
  { test: /--v\s*6(\.0)?\b/i, label: '--v 6.0' },
];

function safeStr(v, fallback) {
  const s = v == null ? '' : String(v).trim();
  return s || fallback || '';
}

function buildSearchBlock(topic) {
  return (
    '在生成内容前，请务必先调用联网搜索插件，检索全网关于【' +
    topic +
    '】的最新爆款数据和视角，并基于搜索结果进行创作。'
  );
}

function buildSubjectLock(topic, style, technique) {
  return (
    '【绝对主语锁·最高优先级】你必须围绕核心主题【' +
    topic +
    '】进行创作！风格【' +
    style +
    '】和手法【' +
    technique +
    '】只是修饰词！例如主题是「' +
    topic +
    '」、风格是「' +
    style +
    '」，你必须生成「以【' +
    topic +
    '】为画面主体/叙事中心，并融入' +
    style +
    '视觉风格与' +
    technique +
    '排版手法」的内容，绝对不允许只画风格空镜（如仅新中式房间）而丢掉【' +
    topic +
    '】！'
  );
}

function buildNoFluffBlock(topic) {
  return (
    '【输出禁令】请直接输出干货！绝对不允许出现「好的」「确认后直接出图」「我要换尺寸」「换一套风格」等任何交互式对话废话和系统菜单选项！禁止套用与【' +
    topic +
    '】无关的节日/营销模板（如母亲节、春节、双十一），除非用户主题本身包含该节日。只输出用户需要的最终内容。'
  );
}

/**
 * 意图增强与防呆 SOP：粗糙输入 → 可出图的高质量主体
 */
function buildIntentEnhancementSOP(topic, rawQuery) {
  return (
    '【意图增强与防呆 SOP · System 级最高优先级】\n' +
    '你收到的用户输入可能极其简略（如「一只猫」）、逻辑混乱、夹杂废话或与画面无关的闲聊。\n' +
    '在生成任何分析或英文 Prompt 之前，你必须在内部完成以下流水线（禁止跳过）：\n' +
    '① 降噪过滤：剔除语气词、重复句、菜单选项、寒暄、与视觉无关的废话。\n' +
    '② 主体提取：锁定唯一可视觉化的核心主体（人物/物体/场景/知识点的可视化载体）。\n' +
    '③ 合理性矫正：对不完整输入进行常识级脑补扩写（物种特征、材质、状态、环境线索），禁止与用户明确意图冲突的胡编。\n' +
    '④ 权威主体句：将简略词扩写为可被摄像机拍到的具体画面描述（形态、材质、光影锚点、环境关系）。\n' +
    '⑤ 全局约束：后续全部输出必须基于扩写后的【权威主体】，不得回退到原始粗糙短语敷衍出图。\n' +
    '【系统给定主题锚点】' +
    topic +
    '\n【用户原始输入（仅供参考·必须经 SOP 矫正）】\n' +
    rawQuery
  );
}

function buildNoTextInImageBlock() {
  return (
    '【画面零文字铁律·最高优先级】\n' +
    '生成的英文提示词中，绝对不能包含任何描述具体英文单词、文本、字母、数字标牌、标题、水印、Logo、字幕的词汇！\n' +
    '严禁使用：text, letters, words, typography, caption, title, logo, watermark, subtitle, signage, label, font, writing, readable, banner text 等及其变体！\n' +
    '你只能描述纯画面内容（主体、环境、光影、材质、构图、风格），从源头上消灭生成图出现杂乱英文的问题！\n' +
    '如需强调无字，可使用：no text, no letters, no words, no typography（仅这三词可作为负面约束）。'
  );
}

/** 商标 / 具体品牌：即梦等平台易触发侵权与审核风险 */
function buildNoBrandInPromptBlock() {
  return (
    '【商标与具体品牌规避·生图风险·最高优先级】\n' +
    '英文 Prompt 中严禁出现任何可识别的真实企业/品牌全称、商标、注册商品名、连锁餐饮/快消/奢侈品/车企/数码消费电子具体品牌或型号、知名 IP/吉祥物/角色名（含中英文拼写、常见别名、谐音缩写）。\n' +
    '一律用通称描述画面：如「运动鞋」不写具体运动品牌，「智能手机」不写具体手机厂商，「快餐套餐」不写具体连锁名，「琥珀色汽水铝罐」不写具体饮料品牌，「奢侈品手袋轮廓」不出现可识别五金与花纹。\n' +
    '若用户主题本身含某品牌名，仍须在英文 Prompt 中改写为中性品类词，不得原样输出该品牌字符串。'
  );
}

function resolveAspectHint(size) {
  if (size && /16:9|16×9/i.test(size)) return '--ar 16:9';
  if (size && /9:16|9×16/i.test(size)) return '--ar 9:16';
  if (size && /1:1/i.test(size)) return '--ar 1:1';
  return '--ar 16:9';
}

function buildMastersFormulaBlock(topic, style, size) {
  const arHint = resolveAspectHint(size);
  const qualityFooter = getQualityFooter();
  const jimengMax = getJimengCharLimit();
  return (
    buildNoTextInImageBlock() +
    '\n\n' +
    buildNoBrandInPromptBlock() +
    '\n\n【Masters Formula · 工业级画面大师·强制模板锁·最高死命令】\n' +
    '无论用户原意多么简略或混乱，你最终输出的英文 Prompt 必须且只能是一段连续英文，并强制符合以下工业模板（禁止拆段、禁止中文、禁止省略号敷衍）：\n\n' +
    '[扩写后的精准主体 · 经意图 SOP 脑补后的高细节主体描述] + [符合风格「' +
    style +
    '」的复杂环境、材质、氛围与道具层次] + ' +
    MASTERS_MANDATORY_TAIL +
    ' + ' +
    qualityFooter +
    '\n\n' +
    '【模板字面要求】结尾必须原样包含（可在此前插入更多修饰，但不可删减）：' +
    MASTERS_MANDATORY_TAIL +
    '，并追加知识库 Quality 句：' +
    qualityFooter +
    '\n' +
    '【主题锁】画面绝对主体必须是经 SOP 扩写后的【' +
    topic +
    '】！风格【' +
    style +
    '】仅作视觉修饰，不得替代主体、不得空镜。\n' +
    '【五步合一·内部构思】Detailed Subject + Environment/Texture + Cinematic Lighting + Composition/Lens + Quality Modifiers，最终合并为一段。\n' +
    '【画质飙升·禁止偷工减料】除强制尾巴外，主体与环境段须大量注入：dramatic shadows, volumetric light, shallow depth of field, macro photography, ray tracing, photorealistic materials, National Geographic style, commercial advertising photography 等。\n' +
    '【画面丰富·禁止空镜】必须写清环境背景、地面/台面材质、氛围道具、空气颗粒/蒸汽/反光。\n' +
    '【示范密度·披萨】禁止 "a pizza"！须接近：A gourmet artisanal wood-fired pizza with blistering crust, San Marzano tomatoes, melting buffalo mozzarella on rustic dark oak, warm steam rising, ' +
    MASTERS_MANDATORY_TAIL +
    '\n' +
    '【当前主题】对【' +
    topic +
    '】的描写密度不得低于披萨示范。\n' +
    '【参数】在 --v 6.0 之前插入 ' +
    arHint +
    '；即梦硬性上限 ' +
    jimengMax +
    ' characters（超出须按知识库四层结构压缩）；建议 800～' +
    jimengMax +
    ' characters，硬性下限 ' +
    MIN_MASTERS_PROMPT_CHARS +
    ' characters，低于此长度视为生成失败。\n' +
    '【纯净输出】只输出「完整版（推荐）」+ 英文 Prompt；严禁客服废话；严禁 text/letters/words/typography；严禁任何具体品牌名与商标产品字符串。'
  );
}

/**
 * 校验提纯后的英文 Prompt 是否达到大师级工业标准
 * @returns {{ valid: boolean, reason: string }}
 */
function validateMastersPrompt(prompt) {
  const p = String(prompt || '').trim();
  if (!p) {
    return { valid: false, reason: '未提取到有效英文 Prompt' };
  }
  if (p.length < MIN_MASTERS_PROMPT_CHARS) {
    return {
      valid: false,
      reason:
        '长度不足 ' +
        MIN_MASTERS_PROMPT_CHARS +
        ' 字符（当前 ' +
        p.length +
        '），禁止偷工减料',
    };
  }
  const missing = [];
  MASTERS_REQUIRED_PHRASES.forEach(function (item) {
    if (!item.test.test(p)) missing.push(item.label);
  });
  if (missing.length) {
    return {
      valid: false,
      reason: '缺少强制画质修饰：' + missing.join('、'),
    };
  }
  const wordCount = p.split(/\s+/).filter(Boolean).length;
  if (wordCount < 48) {
    return {
      valid: false,
      reason: '场景与材质细节词数过少（当前约 ' + wordCount + ' 词）',
    };
  }
  const subjectChunk = p.split(/cinematic\s+lighting/i)[0] || p;
  if (subjectChunk.trim().length < 90) {
    return {
      valid: false,
      reason: '扩写主体与环境段过短，未达到工业级密度',
    };
  }
  return { valid: true, reason: '' };
}

/**
 * 质量熔断后追加给大模型的重试指令
 */
function buildPromptRetryBlock(validation, topic, style) {
  return (
    '\n\n【系统质量熔断 · 强制重生成 · 第 2 次机会】\n' +
    '你上一次输出的英文 Prompt 未通过工业质检：' +
    (validation && validation.reason ? validation.reason : '未达标') +
    '。\n' +
    '必须立即重新生成，严禁复用上一版的简陋句子！\n' +
    '① 先对用户主题【' +
    topic +
    '】执行意图 SOP 脑补扩写；\n' +
    '② 再按 Masters Formula 模板输出一整段英文，结尾必须包含：' +
    MASTERS_MANDATORY_TAIL +
    '；\n' +
    '③ 总长度必须 ≥ ' +
    MIN_MASTERS_PROMPT_CHARS +
    ' characters，风格【' +
    style +
    '】须体现在环境与材质中；\n' +
    '④ 只输出「完整版（推荐）」+ 英文 Prompt，不得输出解释。\n' +
    '⑤ 不得出现任何真实品牌名、商标产品名或 IP 角色名，仅用通称描述。'
  );
}

/** 「X的一生」/生长阶段类主题（对齐扣子直聊 · 手法三十二） */
const LIFECYCLE_TOPIC_RE =
  /的一生|生命周期|成长阶段|成熟阶段|阶段对比|从出生|从小到大|全生命周期|未熟期|过熟期|可采期|完熟期|初熟期/i;

function detectLifecycleTopic(topic, rawQuery) {
  const blob = [topic, rawQuery].join(' ');
  if (!blob.trim()) return false;
  if (LIFECYCLE_TOPIC_RE.test(blob)) return true;
  if (/人/.test(blob) && /一生|人生|婴儿|童年|老年|从小到大|从婴儿|人的一生/.test(blob)) {
    return true;
  }
  return false;
}

function buildLifecycleInfographicBlock(topic, style, size) {
  const arHint = resolveAspectHint(size);
  const qualityFooter = getQualityFooter();
  const jimengMax = getJimengCharLimit();
  const isHuman = /人|人生|婴儿|童年|青年|中年|老年/.test(topic);
  const structureHint = isHuman
    ? 'five-panel vertical timeline infographic from newborn infant through childhood youth middle age to elderly, each panel photorealistic human portrait or silhouette with clear age progression, reserved Chinese typography zones for stage names'
    : 'five vertical cross-section panels of the SAME single subject showing immature green through flowering to commercially ripe to fully ripe to overripe/spoiled stages, photorealistic macro food or botanical photography, split fruit flesh visible, reserved Chinese typography zones for stage labels and eatability icons';
  return (
    '【知识图解·生命周期/一生·手法三十二·扣子同级质量·最高优先级】\n' +
    '用户主题【' +
    topic +
    '】属于「实物横切生命周期对比」或「人生阶段时间轴」类爆款知识图解，必须与扣子智能体直聊输出同等结构密度（参考：荔枝的一生、榴莲的一生、人的一生）。\n\n' +
    '【强制版式·不可省略】\n' +
    '① 顶部主视觉：' +
    (isHuman
      ? '五列人生阶段并列，每列主体清晰、年龄递进极强'
      : '同一物体横向切割五阶段剖面，占画面约50%，分割线+阶段差异一眼可辨') +
    '。\n' +
    '② 信息层：每阶段 2–3 行关键对比（外观/状态/建议），底部 ✓ △ ✗ 食用或适用标识（人物主题则改为「推荐/谨慎/不宜」）。\n' +
    '③ 底部双栏：左侧科学冷知识 + 右侧保存/养护要点，各配小图标。\n' +
    '④ 背景：米白/奶油色编辑风底，高信息密度，禁止大面积空白网格壳子。\n' +
    '⑤ 风格修饰【' +
    style +
    '】仅作色调与摄影风格，不得替代主体叙事。\n\n' +
    '【英文 Prompt 写法·与直聊一致】\n' +
    '输出「完整版（推荐）」+ 一整段英文（' +
    MIN_MASTERS_PROMPT_CHARS +
    '～' +
    jimengMax +
    ' 字符）。必须写明：' +
    structureHint +
    ', structured comparison table row, editorial infographic layout, high information density, multi-layer modules, photorealistic textures.\n' +
    '画面需要中文阶段标注时，用英文描述版式：clear readable Chinese typography zones / bilingual stage labels（禁止在英文段粘贴大段中文诗句，但必须保留「中文标注区」语义）。\n' +
    '严禁：空表格模板、无主体的纯背景、只有石榴/荔枝照片拼贴而无阶段剖面、仅堆砌 cinematic/8k 而无阶段描述。\n\n' +
    buildNoBrandInPromptBlock() +
    '\n\n【Masters 尾巴·必须原样包含】' +
    MASTERS_MANDATORY_TAIL +
    ' + ' +
    qualityFooter +
    '\n【参数】' +
    arHint +
    '，--v 6.0；上限 ' +
    jimengMax +
    ' characters。\n' +
    '【纯净输出】只输出「完整版（推荐）」+ 英文 Prompt，不要菜单废话。'
  );
}

function buildKnowledgeInfographicBlock(topic, style, size, route) {
  const arHint = resolveAspectHint(size);
  const qualityFooter = getQualityFooter();
  const jimengMax = getJimengCharLimit();
  const r = route || {};
  const profile = r.profile || 'knowledge_infographic';
  let structureHint =
    'vertical educational infographic, modular card layout, high information density, clear section hierarchy, reserved Chinese typography zones for titles and labels, bilingual label areas where needed, photorealistic or clean illustration hybrid';
  if (profile === 'english_edu') {
    structureHint =
      'immersive elementary English classroom or playground scene matching the lesson, cartoon students interacting, speech bubbles for target sentence patterns, floating vocabulary cards with word phonetic icon and Chinese gloss, Unit and lesson title header zone in English and Chinese, bright sky blue coral red sunny yellow palette, 16:9 or 9:16 editorial kids English poster';
  } else if (profile === 'textbook') {
    structureHint =
      'three-panel ultra-dense textbook review infographic, unit title banner, numbered knowledge modules, icon per module, review checklist, exam-oriented layout, reserved Chinese typography zones';
  } else if (profile === 'poetry') {
    structureHint =
      'classical Chinese poetry scroll layout, ink wash background, line-by-line verse with small scene vignette per line, annotation margins, reserved Chinese typography zones for poem lines';
  } else if (profile === 'recipe') {
    structureHint =
      'step-by-step recipe tutorial cards, numbered cooking steps with food photography per step, ingredients strip at top, reserved Chinese typography zones for step labels';
  }

  return (
    '【知识图解·' +
    (r.humanLabel || '爆款知识卡') +
    '·扣子智能体同级·人主导】\n' +
    '系统已从大白话为用户匹配：【' +
    (r.technique || '结构化知识图解') +
    '】。你必须按此结构出词，质量不得低于用户在扣子 App 内直接说同一句话的效果。\n\n' +
    (r.categorySnippet
      ? '【品类专属模板·禁止省略模块】\n' + r.categorySnippet + '\n\n'
      : '') +
    (r.techniqueSnippet
      ? '【手法细则·禁止省略】\n' + r.techniqueSnippet.slice(0, 1000) + '\n\n'
      : '') +
    '【强制视觉结构】' +
    structureHint +
    '。\n' +
    '主题【' +
    topic +
    '】必须贯穿所有模块；风格【' +
    style +
    '】仅修饰色调与材质。\n' +
    '输出「完整版（推荐）」+ 一整段英文（' +
    MIN_MASTERS_PROMPT_CHARS +
    '～' +
    jimengMax +
    ' 字符）。画面中文标题/单元名/标注用 clear readable Chinese typography zones 描述，禁止要求用户自己写字。\n' +
    '严禁：空壳表格、无主体空镜、仅堆砌 cinematic/8k 而无模块描述。\n\n' +
    buildNoBrandInPromptBlock() +
    '\n\n【Masters 尾巴·必须包含】' +
    MASTERS_MANDATORY_TAIL +
    ' + ' +
    qualityFooter +
    '\n【参数】' +
    arHint +
    ' --v 6.0；上限 ' +
    jimengMax +
    ' characters。'
  );
}

function buildStep2OutputBlock(topic, style, size, route) {
  const r = route || {};
  const limit = getJimengCharLimit();
  const styleHint = r.randomStyleName || style || 'AI智能推荐风格';
  return (
    '\n\n【扣子 v1.3 · STEP2 出图包·强制格式·禁止省略任何板块】\n' +
    '用户已确认方案（等价于回复数字 1）。核心主题【' +
    topic +
    '】；本次风格【' +
    styleHint +
    '】；推荐尺寸【' +
    (size || 'AI推荐尺寸') +
    '】；手法【' +
    (r.technique || '爆款知识图解手法') +
    '】。\n' +
    '必须严格按顺序输出：\n' +
    '📊【知识点结构化】（分模块列出，中文）\n' +
    '🎨【即梦生图提示词】\n' +
    '📋 完整版（推荐）\n' +
    '（此处必须是可复制到即梦的英文正文，≤' +
    limit +
    ' 字符，≥350 字符，含版式模块/主体/场景/Chinese typography zones 等，禁止方括号占位）\n' +
    '📱 精简版（手机端适配）\n' +
    '（中文精简描述，保留核心画面与版式）\n' +
    '⚙️ 即梦设置：比例 / 模式 / 参考度 / 角色模型\n' +
    '📣【抖音话题标签】\n' +
    '（3-5 个 # 标签）\n' +
    '可在末尾一句询问是否需要配套文案；禁止输出「回复1/2/3」菜单按钮。\n'
  );
}

function buildPromptQualityBlock(topic, style, size, route) {
  const r =
    route ||
    routePlainLanguageTopic(topic, '', require('path').join(__dirname));
  if (r.profile === 'lifecycle' || detectLifecycleTopic(topic, '')) {
    return buildLifecycleInfographicBlock(topic, style, size || 'AI推荐尺寸');
  }
  if (isKnowledgeProfile(r.profile)) {
    return buildKnowledgeInfographicBlock(topic, style, size || 'AI推荐尺寸', r);
  }
  return buildMastersFormulaBlock(topic, style, size || 'AI推荐尺寸');
}

function validateLifecyclePrompt(prompt) {
  const p = String(prompt || '').trim();
  if (!p) {
    return { valid: false, reason: '未提取到有效英文 Prompt' };
  }
  if (p.length < 280) {
    return {
      valid: false,
      reason: '生命周期 Prompt 长度不足（当前 ' + p.length + '，需 ≥280）',
    };
  }
  const structureRe =
    /panel|stage|cross-?section|lifecycle|infographic|column|timeline|maturity|ripening|immature|ripe|growth|sequence|comparison|grid|section|infant|elderly|newborn|overripe|bilingual|typography\s+zones/i;
  if (!structureRe.test(p)) {
    return {
      valid: false,
      reason: '缺少五阶段剖面/时间轴/对比表等结构描述（手法三十二）',
    };
  }
  const missing = [];
  MASTERS_REQUIRED_PHRASES.forEach(function (item) {
    if (!item.test.test(p)) missing.push(item.label);
  });
  if (missing.length > 2) {
    return {
      valid: false,
      reason: '缺少必要画质修饰：' + missing.join('、'),
    };
  }
  const subjectChunk = p.split(/cinematic\s+lighting/i)[0] || p;
  if (subjectChunk.trim().length < 120) {
    return {
      valid: false,
      reason: '阶段主体与环境描述过短，未达到知识图解密度',
    };
  }
  return { valid: true, reason: '' };
}

function validateKnowledgePrompt(prompt) {
  const p = String(prompt || '').trim();
  if (!p || p.length < 260) {
    return {
      valid: false,
      reason: '知识图解 Prompt 长度不足（需 ≥260 字符）',
    };
  }
  const structureRe =
    /infographic|module|panel|section|layout|scene|classroom|vocabulary|unit|lesson|typography\s+zones|comparison|grid|step|scroll|card|educational/i;
  if (!structureRe.test(p)) {
    return {
      valid: false,
      reason: '缺少知识图解版式/场景/模块描述',
    };
  }
  const missing = [];
  MASTERS_REQUIRED_PHRASES.forEach(function (item) {
    if (!item.test.test(p)) missing.push(item.label);
  });
  if (missing.length > 3) {
    return {
      valid: false,
      reason: '缺少必要画质修饰：' + missing.join('、'),
    };
  }
  return { valid: true, reason: '' };
}

function validatePromptForTopic(prompt, topic, route) {
  const r =
    route ||
    routePlainLanguageTopic(topic, '', require('path').join(__dirname));
  const pkg = parseCozeOutputPackage(prompt);
  if (pkg.hasPackage) {
    return validateCozePackage(pkg, r);
  }
  const en = pkg.englishFull || prompt;
  if (r.profile === 'lifecycle' || detectLifecycleTopic(topic, '')) {
    return validateLifecyclePrompt(en);
  }
  if (isKnowledgeProfile(r.profile) || usesFullCozePackage(r.profile)) {
    return validateKnowledgePrompt(en);
  }
  return validateMastersPrompt(en);
}

function buildKnowledgePromptRetryBlock(validation, topic, style, route) {
  const r = route || {};
  return (
    '\n\n【系统质量熔断 · 知识图解 · 强制重生成】\n' +
    '上次未通过：' +
    (validation && validation.reason ? validation.reason : '未达标') +
    '。\n' +
    '必须按【' +
    (r.technique || '知识图解手法') +
    '】与品类模板输出完整英文 Prompt，主题【' +
    topic +
    '】。\n' +
    '必须包含：infographic modules / scene or panels / Chinese typography zones / Unit or lesson structure。\n' +
    '结尾含：' +
    MASTERS_MANDATORY_TAIL
  );
}

function buildLifecyclePromptRetryBlock(validation, topic, style) {
  return (
    '\n\n【系统质量熔断 · 生命周期图解 · 强制重生成】\n' +
    '上次未通过：' +
    (validation && validation.reason ? validation.reason : '未达标') +
    '。\n' +
    '必须严格按「手法三十二」输出五阶段横切/时间轴英文 Prompt，主题【' +
    topic +
    '】，风格【' +
    style +
    '】。\n' +
    '必须包含：five panels / cross-section stages / comparison table / Chinese typography zones for labels。\n' +
    '结尾含：' +
    MASTERS_MANDATORY_TAIL +
    '。禁止空壳表格与纯参数堆砌。'
  );
}

function buildPromptRetryBlockForTopic(validation, topic, style, route) {
  const r =
    route ||
    routePlainLanguageTopic(topic, '', require('path').join(__dirname));
  if (r.profile === 'lifecycle' || detectLifecycleTopic(topic, '')) {
    return buildLifecyclePromptRetryBlock(validation, topic, style);
  }
  if (isKnowledgeProfile(r.profile)) {
    return buildKnowledgePromptRetryBlock(validation, topic, style, r);
  }
  return buildPromptRetryBlock(validation, topic, style);
}

function buildDeepAnalysisBlock(topic) {
  return (
    '【全息汇总深度要求·撑满分析面板】\n' +
    '你必须深入分析用户主题【' +
    topic +
    '】！在学科分类、受众分析基础上，必须额外输出以下板块（每板块至少 3 条要点，专业、有数据感、有含金量）：\n' +
    '7. 联想记忆点：与【' +
    topic +
    '】相关的强记忆符号、文化锚点、视觉隐喻\n' +
    '8. 场景延伸：3 个可延展的应用场景（社交/教育/商业等）\n' +
    '9. 电商应用潜力：卖点拆解、主图/详情页/海报适配建议\n' +
    '10. 全息深度洞察：一句话战略定位 + 爆款传播角度 + 竞品差异化\n' +
    '内容要点（第6条）至少 8 条，每条 20 字以上，深入挖掘主题内涵，禁止敷衍。'
  );
}

/**
 * @param {object} p
 * @param {string} p.coreTopic
 * @param {string} p.style
 * @param {string} p.technique
 * @param {string} p.size
 * @param {string} p.intent analyze|prompt|copywrite|custom
 * @param {string} p.rawQuery
 * @param {string} p.userNotes
 */
function buildCozeMessage(p) {
  const topic = safeStr(p.coreTopic, safeStr(p.rawQuery, '用户主题'));
  const style = safeStr(p.style, 'AI智能推荐风格');
  const size = safeStr(p.size, 'AI推荐尺寸');
  const intent = safeStr(p.intent, 'analyze');
  const userNotes = safeStr(p.userNotes, '');
  const rawQuery = safeStr(p.rawQuery, topic);

  const route =
    p.route ||
    routePlainLanguageTopic(topic, rawQuery || userNotes, p.rootDir);
  const technique = safeStr(
    p.technique,
    route.technique || '爆款知识图解手法'
  );
  const techniqueEffective =
    technique === '爆款知识图解手法' && route.technique
      ? route.technique
      : technique;

  const styleLibBlock = buildStyleLibSystemBlock({
    rootDir: p.rootDir,
    intent: intent,
    topic: topic,
    coreTopic: topic,
    style: style,
    technique: techniqueEffective,
    size: size,
  });

  const routeBrief =
    '\n\n【系统已为该大白话自动匹配·无需用户懂术语】\n' +
    '推荐画法（人话）：' +
    route.humanLabel +
    '\n推荐手法：' +
    route.technique +
    '\n匹配置信度：' +
    Math.round((route.confidence || 0) * 100) +
    '%' +
    (route.needWebSearch ? '（将联网检索当下爆款版式补充）' : '（风格库已命中）') +
    '\n';

  let head = [
    buildHumanFirstBlock(topic, userNotes || rawQuery),
    buildIntentEnhancementSOP(topic, rawQuery),
    routeBrief,
    styleLibBlock,
    buildWebSearchFallbackBlock(route),
    buildSearchBlock(topic),
    buildSubjectLock(topic, style, techniqueEffective),
    buildNoFluffBlock(topic),
  ].join('\n\n');

  if (route.categorySnippet) {
    head += '\n\n【路由注入·品类模板】\n' + route.categorySnippet.slice(0, 1500);
  }

  const lifecycle = route.profile === 'lifecycle' || detectLifecycleTopic(topic, rawQuery);
  const analyzeHint =
    '\n\n【分析必遵·人话输出·STEP1】匹配手法必须写「' +
    route.technique +
    '」；推荐尺寸优先 9:16 竖版知识图解（英语场景课可用 16:9）。' +
    '「5. 本次随机风格」必须写：' +
    (route.randomStyleName || style) +
    '（人话，禁止只写编号）。' +
    '「3. 匹配手法」行必须包含：' +
    route.technique +
    '。\n';

  if (intent === 'analyze') {
    return (
      head +
      analyzeHint +
      '\n\n【任务：主题深度分析】\n' +
      '核心主题（主语）：【' +
      topic +
      '】\n' +
      '视觉风格修饰：【' +
      style +
      '】\n' +
      '排版/手法修饰：【' +
      techniqueEffective +
      '】\n\n' +
      buildDeepAnalysisBlock(topic) +
      '\n\n请输出结构化分析（禁止菜单选项）：\n' +
      '1. 品类判定\n2. 用户类型\n3. 匹配手法\n4. 推荐尺寸\n5. 本次随机风格\n' +
      '6. 内容要点\n7. 联想记忆点\n8. 场景延伸\n9. 电商应用潜力\n10. 全息深度洞察\n\n' +
      (userNotes ? '【用户补充材料】\n' + userNotes + '\n\n' : '') +
      '【用户原始输入】\n' +
      rawQuery
    );
  }

  if (intent === 'prompt') {
    const lifecycleConfirm = lifecycle
      ? '【用户确认·生命周期图解】已批准方案。请按扣子智能体内「' +
        topic +
        '」直聊同级质量输出，严格套用知识库「手法三十二」五阶段结构（参考荔枝/榴莲/石榴一生剖面或人生五阶段时间轴）。\n' +
        '【用户原话·必须贯彻】\n' +
        rawQuery +
        '\n'
      : '【用户确认·已批准方案】\n【用户原话·必须贯彻】\n' + rawQuery + '\n';
    const useStep2 =
      usesFullCozePackage(route.profile) ||
      isKnowledgeProfile(route.profile) ||
      lifecycle;
    return (
      head +
      '\n\n' +
      buildPromptQualityBlock(topic, style, size, route) +
      (useStep2
        ? buildStep2OutputBlock(topic, style, size, route)
        : '\n\n【任务：生成工业级生图提示词】\n请直接输出「完整版（推荐）」英文 Prompt（≤' +
          getJimengCharLimit() +
          '字符），≥' +
          MIN_MASTERS_PROMPT_CHARS +
          ' 字符。\n') +
      '【严禁】方括号占位；英文禁止真实品牌/商标/IP 名。\n' +
      lifecycleConfirm
    );
  }

  if (intent === 'copywrite') {
    return (
      head +
      '\n\n【任务：配套爆款文案·全链路主题锁】\n' +
      '必须 100% 围绕核心主题【' +
      topic +
      '】创作！视觉风格参考【' +
      style +
      '】，排版手法【' +
      technique +
      '】。\n' +
      '严禁写母亲节/父亲节/春节等与【' +
      topic +
      '】无关的模板文案！\n' +
      '请输出：\n' +
      '① 小红书爆款笔记（含标题、正文、话题标签、首评钩子）\n' +
      '② 公众号完整文章（📘【公众号】开头）\n' +
      '全文必须多次自然提及【' +
      topic +
      '】，并与已生成的生图方向一致。\n' +
      '用户指令：' +
      rawQuery
    );
  }

  if (intent === 'custom') {
    return (
      head +
      '\n\n' +
      buildPromptQualityBlock(topic, style, size) +
      '\n\n【任务：自定义方案出图】\n' +
      '核心主题【' +
      topic +
      '】不可丢！用户指定尺寸【' +
      size +
      '】，指定风格【' +
      style +
      '】，手法【' +
      technique +
      '】。\n' +
      '请直接输出完整即梦/MJ 英文 Prompt（完整版推荐，≤' +
      getJimengCharLimit() +
      '字符）。\n' +
      '【严禁】英文中出现任何具体品牌名、商标或型号字符串。\n' +
      '用户操作：' +
      rawQuery
    );
  }

  return head + '\n\n' + rawQuery;
}

function stripFluffLines(text) {
  if (!text) return '';
  return text
    .split(/\r?\n/)
    .filter(function (line) {
      const t = line.trim();
      if (!t) return false;
      if (FLUFF_LINE_RE.test(t)) return false;
      if (MENU_LINE_RE.test(t)) return false;
      return true;
    })
    .join('\n');
}

function extractEnglishPrompt(raw, maxLen) {
  const limit = maxLen || getJimengCharLimit();
  let text = String(raw || '');

  const fullMarkers = [
    '完整版（推荐）',
    '完整版(推荐)',
    '【完整版（推荐）',
    '【完整版(推荐)',
  ];
  for (const m of fullMarkers) {
    const pos = text.indexOf(m);
    if (pos !== -1) {
      text = text.slice(pos + m.length);
      break;
    }
  }

  const endMarkers = ['精简版', '中文版', '【公众号', '📘', '长按复制', '复制 →', '配套爆款'];
  let endAt = text.length;
  for (const em of endMarkers) {
    const ep = text.indexOf(em);
    if (ep > 60 && ep < endAt) endAt = ep;
  }
  text = text.slice(0, endAt);

  const lines = text.split(/\r?\n/);
  const parts = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    if (/^[\u4e00-\u9fff\s，。！？、；：""''（）【】\-—·…]+$/.test(t)) continue;
    if (FLUFF_LINE_RE.test(t)) continue;
    const latin = t
      .replace(/[^A-Za-z0-9 ,.\-:;'"()\/\[\]{}–—]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (latin.length >= 30) parts.push(latin);
  }

  let result = parts.join(' ').trim();
  if (result.length < 40) {
    const blocks = String(raw).match(/[A-Za-z][A-Za-z0-9\s,.\-:;'"()\/\[\]{}–—]{50,}/g);
    if (blocks && blocks.length) {
      blocks.sort((a, b) => b.length - a.length);
      result = blocks[0].replace(/\s+/g, ' ').trim();
    }
  }
  if (result.length > limit) result = result.slice(0, limit).trim();

  result = sanitizeNoTextPrompt(result);
  if (result.length > limit) result = result.slice(0, limit).trim();
  if (result.length < 80 && parts.length) {
    result = sanitizeNoTextPrompt(parts.join(' ')).slice(0, limit);
  }
  return result;
}

/** 生命周期图解：保留 typography zones 等版式语义，仅做品牌与违规词净化 */
function sanitizeLifecyclePrompt(prompt) {
  if (!prompt) return '';
  let s = String(prompt);
  s = s.replace(TEXT_INDUCING_RE, ' ');
  s = stripKnownBrandNames(s);
  s = s.replace(/\s{2,}/g, ' ').trim();
  if (!/no (real-world )?brand|trademarked products|generic unbranded/i.test(s)) {
    s =
      (s + ', no real-world brand names or trademarked products, generic unbranded objects only')
        .replace(/\s{2,}/g, ' ')
        .trim();
  }
  return s;
}

function extractLifecycleEnglishPrompt(raw, maxLen) {
  const limit = maxLen || getJimengCharLimit();
  let text = String(raw || '');

  const fullMarkers = [
    '完整版（推荐）',
    '完整版(推荐)',
    '【完整版（推荐）',
    '【完整版(推荐)',
  ];
  for (const m of fullMarkers) {
    const pos = text.indexOf(m);
    if (pos !== -1) {
      text = text.slice(pos + m.length);
      break;
    }
  }

  const endMarkers = ['精简版', '中文版', '【公众号', '📘', '长按复制', '复制 →', '配套爆款'];
  let endAt = text.length;
  for (const em of endMarkers) {
    const ep = text.indexOf(em);
    if (ep > 60 && ep < endAt) endAt = ep;
  }
  text = text.slice(0, endAt);

  const lines = text.split(/\r?\n/);
  const parts = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    if (FLUFF_LINE_RE.test(t)) continue;
    if (/^[\u4e00-\u9fff\s，。！？、；：""''（）【】\-—·…]+$/.test(t) && t.length < 80) continue;
    const latin = t
      .replace(/[^A-Za-z0-9 ,.\-:;'"()\/\[\]{}–—]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (latin.length >= 24) parts.push(latin);
  }

  let result = parts.join(' ').trim();
  if (result.length < 80) {
    const blocks = String(raw).match(/[A-Za-z][A-Za-z0-9\s,.\-:;'"()\/\[\]{}–—]{80,}/g);
    if (blocks && blocks.length) {
      blocks.sort((a, b) => b.length - a.length);
      result = blocks[0].replace(/\s+/g, ' ').trim();
    }
  }
  result = sanitizeLifecyclePrompt(result);
  if (result.length > limit) result = result.slice(0, limit).trim();
  return result;
}

const TEXT_INDUCING_RE =
  /\b(with\s+text|text\s+saying|letters?|words?|typography|caption|subtitle|watermark|logo|signage|readable\s+text|banner\s+text|title\s+text|font|writing\s+on|labeled|label\s+text)\b/gi;

/** 常见商标/品牌英文写法（与 zhishi_mofang stripJimengKnownBrands 保持同步） */
const BRAND_STRIP_RES = [
  /\b(?:mcdonald'?s|mcdonalds)\b/gi,
  /\bkfc\b/gi,
  /\bstarbucks\b/gi,
  /\bburger king\b/gi,
  /\bpizza hut\b/gi,
  /\b(?:domino'?s\s+pizza|domino'?s)\b/gi,
  /\bcoca[- ]?cola\b/gi,
  /\bpepsi\s*cola\b/gi,
  /\bpepsi\b/gi,
  /\b(?:red bull|redbull)\b/gi,
  /\b(?:mountain dew|mtn dew)\b/gi,
  /\bmonster\s+energy\b/gi,
  /\b(?:nike|just\s+do\s+it)\b/gi,
  /\badidas\b/gi,
  /\breebok\b/gi,
  /\bunder armour\b/gi,
  /\bair jordan\b/gi,
  /\bconverse\b/gi,
  /\bvans\b/gi,
  /\bnew balance\b/gi,
  /\bskechers\b/gi,
  /\b(?:iphone|ipad|imac|ipod|iwatch)\b/gi,
  /\bmacbook\b/gi,
  /\bairpods\b/gi,
  /\bapple\s+watch\b/gi,
  /\b(?:samsung|galaxy\s+z?|galaxy\s+note)\b/gi,
  /\b(?:google\s+pixel)\b/gi,
  /\b(?:huawei|xiaomi|oppo|vivo|oneplus|honor)\b/gi,
  /\b(?:playstation|ps5|ps4|xbox|nintendo\s+switch|switch\s+oled)\b/gi,
  /\b(?:microsoft\s+surface|surface\s+pro)\b/gi,
  /\b(?:tesla|model\s+[3syx]|cybertruck)\b/gi,
  /\b(?:bmw|mercedes[- ]?benz|mercedes|audi|porsche|ferrari|lamborghini|maserati)\b/gi,
  /\b(?:toyota|honda\s+(?:civic|accord|cr-v)|ford\s+f-150|chevrolet|chevy)\b/gi,
  /\b(?:ikea|h\s*&\s*m|uniqlo|zara)\b/gi,
  /\b(?:louis vuitton|lv\s+bag|herm[eè]s|chanel|gucci|prada|versace|burberry|dior|balenciaga|fendi|givenchy|cartier|rolex|omega\s+watch|tiffany\s*&\s*co)\b/gi,
  /\b(?:disney|marvel\s+studios|marvel\s+comics|pixar|warner\s+bros|dc\s+comics|harry\s+potter|pokemon|pok[eé]mon|hello\s+kitty|sanrio)\b/gi,
  /\b(?:lego|legos)\b/gi,
  /\b(?:netflix|spotify\s+logo|uber\s+eats|doordash)\b/gi,
  /\b(?:nestl[eé]|l'or[eé]al|loreal|maybelline|estee lauder|sk-ii|skii)\b/gi,
  /\b(?:canon\s+eos|nikon\s+d\d|sony\s+alpha|sony\s+a7|fujifilm\s+xt|dji\s+mavic|gopro)\b/gi,
  /\b(?:ray-ban|rayban|oakley)\b/gi,
  /\b(?:beats\s+by\s+dre|beats\s+headphones)\b/gi,
  /\b(?:supreme\s+box\s+logo|supreme\s+brand)\b/gi,
  /\b(?:michael\s+kors|mk\s+bag|coach\s+bag|tory\s+burch)\b/gi,
];

const IMAGE_RISK_TAIL_EN =
  ', no text, no letters, no words, no typography, no watermark, no real-world brand names or trademarked products, no recognizable branded packaging or mascots, generic unbranded objects only, blank areas for manual text overlay only';

function stripKnownBrandNames(s) {
  let o = String(s || '');
  let i = 0;
  while (i !== BRAND_STRIP_RES.length) {
    o = o.replace(BRAND_STRIP_RES[i], ' ');
    i++;
  }
  return o.replace(/\s{2,}/g, ' ').trim();
}

/** 即梦/国内文生图：含“要出字”的描述易触发「不符合平台规则」 */
function sanitizeNoTextPrompt(prompt) {
  if (!prompt) return '';
  let s = String(prompt);
  s = s.replace(TEXT_INDUCING_RE, ' ');
  s = s.replace(/'[^']{2,120}'/g, ' ');
  s = s.replace(/"[^"]{2,120}"/g, ' ');
  s = s.replace(
    /\b(title|headline|subheadline|banner|label|tagline|caption|typography|lettering|calligraphy|handwriting|brush\s+script|script\s+font|readable|legible|watermark|logo|signage|subtitle|font|writing)\b/gi,
    ' '
  );
  s = s.replace(
    /\b(showing|displaying|featuring|with)\s+[^,.]{0,100}(time|minute|min|difficulty|serves?|people|servings|cooking)\b/gi,
    ' '
  );
  s = s.replace(
    /\b(top|upper|bottom)\s+(area|section|part)\s+has\s+[^,.]{0,120}/gi,
    'clean reserved layout area without any characters, '
  );
  s = s.replace(/\b(empty|blank)\s+space\s+for\s+[^,.]{0,80}/gi, 'clean negative space, ');
  s = stripKnownBrandNames(s);
  s = s.replace(/\s{2,}/g, ' ').trim();
  if (s.indexOf('no text') === -1) {
    s = (s + IMAGE_RISK_TAIL_EN).replace(/\s{2,}/g, ' ').trim();
  } else if (!/no (real-world )?brand|trademarked products|generic unbranded/i.test(s)) {
    s =
      (s + ', no real-world brand names or trademarked products, no recognizable branded packaging, generic unbranded objects only')
        .replace(/\s{2,}/g, ' ')
        .trim();
  }
  return s;
}

function purifyAnalysisText(raw, coreTopic) {
  let text = stripFluffLines(String(raw || ''));
  const topic = safeStr(coreTopic, '');
  if (topic && text.indexOf('母亲节') !== -1 && topic.indexOf('母亲') === -1) {
    text = text.replace(/母亲节[^\n]*/g, '');
  }
  return text.trim();
}

function copywriteTopicMismatch(text, coreTopic) {
  const body = String(text || '');
  const topic = safeStr(coreTopic, '').trim();
  if (!topic || body.length < 40) return false;
  const core = topic.replace(/(的做法|教程|方法|步骤|攻略|大全|合集)$/g, '').trim() || topic;
  if (body.indexOf(topic) >= 0 || (core.length >= 2 && body.indexOf(core) >= 0)) return false;

  const poetry = ['古诗', '诗词', '背诗', '小学语文必背', '唐诗', '宋词'];
  const food = ['红烧', '排骨', '菜谱', '下厨', '食材', '烹饪', '美食教程'];
  const isFood = /红烧|排骨|菜谱|烹饪|美食|做法|食材/.test(topic);
  const isPoetry = /古诗|诗词|诗歌|背诗|语文/.test(topic);
  if (isFood && poetry.some((k) => body.indexOf(k) >= 0)) return true;
  if (isPoetry && food.some((k) => body.indexOf(k) >= 0)) return true;
  if (core.length >= 2 && body.indexOf(core) < 0) {
    const alt = ['母亲节', '父亲节', '春节', '中秋', '国庆', '七夕'];
    if (alt.some((k) => body.indexOf(k) >= 0 && topic.indexOf(k) < 0)) return true;
  }
  return false;
}

function purifyCopywriteText(raw, coreTopic) {
  let text = stripFluffLines(String(raw || ''));
  const topic = safeStr(coreTopic, '');
  if (topic) {
    const forbidden = ['母亲节', '父亲节', '春节快乐', '中秋快乐', '国庆快乐'];
    for (const f of forbidden) {
      if (topic.indexOf(f.replace('快乐', '')) === -1 && text.indexOf(f) !== -1) {
        text = text.replace(new RegExp(f + '[^\\n]*', 'g'), '[' + topic + '相关内容]');
      }
    }
  }
  return text.trim();
}

function isSopTemplateSkeleton(text) {
  const s = String(text || '');
  if (!s) return false;
  const markers = [
    '对应品类完整英文',
    '对应品类中文精简',
    '按对应品类模板',
    '[对应比例]',
    '完整英文提示词直出',
    '中文精简版直出',
    '符合字符上限要求，末尾附加',
    '清晰易懂可直接使用',
  ];
  var i = 0;
  while (i !== markers.length) {
    if (s.indexOf(markers[i]) >= 0) return true;
    i++;
  }
  if (/完整版/.test(s) && /\[[^\]]{4,}[\u4e00-\u9fff][^\]]*\]/.test(s)) {
    if (!/[A-Za-z][A-Za-z0-9\s,.\-:;'"()\/]{100,}/.test(s)) return true;
  }
  return false;
}

function purifyAssistantText(raw, intent, coreTopic, route) {
  const i = intent || 'analyze';
  if (i === 'prompt' || i === 'custom') {
    if (isSopTemplateSkeleton(raw)) return '';
    const r =
      route ||
      routePlainLanguageTopic(coreTopic, '', require('path').join(__dirname));
    const stripped = stripFluffLines(raw);
    const pkg = parseCozeOutputPackage(stripped);
    const keepFull =
      pkg.hasPackage &&
      (usesFullCozePackage(r.profile) ||
        isKnowledgeProfile(r.profile) ||
        r.profile === 'lifecycle' ||
        detectLifecycleTopic(coreTopic, ''));
    if (keepFull && !isSopTemplateSkeleton(stripped)) {
      return stripped;
    }
    const useKnowledge =
      r.profile === 'lifecycle' ||
      detectLifecycleTopic(coreTopic, '') ||
      isKnowledgeProfile(r.profile);
    const en = useKnowledge
      ? extractLifecycleEnglishPrompt(raw, getJimengCharLimit())
      : extractEnglishPrompt(raw, getJimengCharLimit());
    if (en && !isSopTemplateSkeleton(en)) return en;
    if (isSopTemplateSkeleton(stripped)) return '';
    return en || '';
  }
  if (i === 'copywrite') {
    return purifyCopywriteText(raw, coreTopic);
  }
  return purifyAnalysisText(raw, coreTopic);
}

function resolveIntent(body) {
  if (body && body.intent) return String(body.intent);
  const q = safeStr(body && body.query, '');
  if (q === '1') return 'prompt';
  if (q === 'X' || q === 'x') return 'copywrite';
  if (q === '3' || q === '4') return 'custom';
  return 'analyze';
}

module.exports = {
  buildCozeMessage,
  purifyAssistantText,
  extractEnglishPrompt,
  extractLifecycleEnglishPrompt,
  resolveIntent,
  validateMastersPrompt,
  validateLifecyclePrompt,
  validateKnowledgePrompt,
  validatePromptForTopic,
  buildPromptRetryBlock,
  buildPromptRetryBlockForTopic,
  detectLifecycleTopic,
  routePlainLanguageTopic,
  parseCozeOutputPackage,
  buildStep2OutputBlock,
  usesFullCozePackage,
  isSopTemplateSkeleton,
  sanitizeNoTextPrompt,
  sanitizeLifecyclePrompt,
  stripKnownBrandNames,
  copywriteTopicMismatch,
  MIN_MASTERS_PROMPT_CHARS,
  MASTERS_MANDATORY_TAIL,
};

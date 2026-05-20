/**
 * 灵创星球 · Coze Prompt 组装与响应提纯引擎
 */

const {
  buildStyleLibSystemBlock,
  getQualityFooter,
  getJimengCharLimit,
} = require('./style-lib-loader.js');

const FLUFF_LINE_RE =
  /^(好的|好的！|确认|确认后|确认后直接出图|我要换|换一套|用这套|建议回复|【建议|⭕|💡|👆|长按|复制\s*→|打开即梦|发送任意|支持四种|我是灵创|欢迎使用|灵创星球·)/;

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
    '【纯净输出】只输出「完整版（推荐）」+ 英文 Prompt；严禁客服废话；严禁 text/letters/words/typography。'
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
    '④ 只输出「完整版（推荐）」+ 英文 Prompt，不得输出解释。'
  );
}

function buildPromptQualityBlock(topic, style, size) {
  return buildMastersFormulaBlock(topic, style, size || 'AI推荐尺寸');
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
  const technique = safeStr(p.technique, '爆款知识图解手法');
  const size = safeStr(p.size, 'AI推荐尺寸');
  const intent = safeStr(p.intent, 'analyze');
  const userNotes = safeStr(p.userNotes, '');
  const rawQuery = safeStr(p.rawQuery, topic);

  const styleLibBlock = buildStyleLibSystemBlock({
    rootDir: p.rootDir,
    intent: intent,
    topic: topic,
    coreTopic: topic,
    style: style,
    technique: technique,
    size: size,
  });

  const head = [
    buildIntentEnhancementSOP(topic, rawQuery),
    styleLibBlock,
    buildSearchBlock(topic),
    buildSubjectLock(topic, style, technique),
    buildNoFluffBlock(topic),
  ].join('\n\n');

  if (intent === 'analyze') {
    return (
      head +
      '\n\n【任务：主题深度分析】\n' +
      '核心主题（主语）：【' +
      topic +
      '】\n' +
      '视觉风格修饰：【' +
      style +
      '】\n' +
      '排版/手法修饰：【' +
      technique +
      '】\n\n' +
      buildDeepAnalysisBlock(topic) +
      '\n\n请输出结构化分析（禁止菜单选项）：\n' +
      '1. 品类判定\n2. 用户类型\n3. 匹配手法\n4. 推荐尺寸\n5. 本次风格\n' +
      '6. 内容要点\n7. 联想记忆点\n8. 场景延伸\n9. 电商应用潜力\n10. 全息深度洞察\n\n' +
      (userNotes ? '【用户补充材料】\n' + userNotes + '\n\n' : '') +
      '【用户原始输入】\n' +
      rawQuery
    );
  }

  if (intent === 'prompt') {
    return (
      head +
      '\n\n' +
      buildPromptQualityBlock(topic, style, size) +
      '\n\n【任务：生成工业级生图提示词】\n' +
      '用户已确认分析方案。核心主题【' +
      topic +
      '】，推荐尺寸【' +
      size +
      '】，风格【' +
      style +
      '】，手法【' +
      technique +
      '】。\n' +
      '请直接输出「完整版（推荐）」英文 Prompt（≤' +
      getJimengCharLimit() +
      '字符，知识库即梦上限），不要输出中文寒暄、不要输出菜单按钮。\n' +
      '用户确认指令：' +
      rawQuery
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

const TEXT_INDUCING_RE =
  /\b(with\s+text|text\s+saying|letters?|words?|typography|caption|subtitle|watermark|logo|signage|readable\s+text|banner\s+text|title\s+text|font|writing\s+on|labeled|label\s+text)\b/gi;

function sanitizeNoTextPrompt(prompt) {
  if (!prompt) return '';
  let s = String(prompt);
  s = s.replace(TEXT_INDUCING_RE, ' ');
  s = s.replace(/\s{2,}/g, ' ').trim();
  if (s.indexOf('no text') === -1) {
    s = s + ', no text, no letters, no words, no typography';
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

function purifyAssistantText(raw, intent, coreTopic) {
  const i = intent || 'analyze';
  if (i === 'prompt' || i === 'custom') {
    const en = extractEnglishPrompt(raw, getJimengCharLimit());
    return en || stripFluffLines(raw);
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
  resolveIntent,
  validateMastersPrompt,
  buildPromptRetryBlock,
  MIN_MASTERS_PROMPT_CHARS,
  MASTERS_MANDATORY_TAIL,
};

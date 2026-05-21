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
  isEcomProfile,
  isKnowledgeProfile,
  usesFullCozePackage,
  buildHumanFirstBlock,
  buildWebSearchFallbackBlock,
  getStylePoolForProfile,
} = require('./topic-router.js');
const {
  parseCozeOutputPackage,
  validateCozePackage,
} = require('./coze-output-parser.js');
const {
  getStructureTemplate,
  DENSITY_RULES_CH5,
  getNetworkFallbackBlock,
} = require('./system-logic-data.js');
const { JIMENG_CHAR_LIMIT, JIMENG_TAIL_LITE } = require('./prompt-compress.js');

/** 《系统逻辑完整版》严格模式：默认开启，仅后端 Prompt 组装 */
const STRICT_MD_MODE = process.env.STRICT_MD_MODE !== '0';

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

/** 有上传图时：先看图再写，用户文字只做补充 */
function buildVisionFirstAnalyzeBlock() {
  return (
    '【看图优先·铁律】附件图片是唯一事实来源。你必须先完整观看图片，再输出文字。\n' +
    '识别顺序：① 画面主体（何物/何菜/何产品）② 场景（容器/色泽/摆盘/氛围）③ 用户文案里的价格、用途、平台诉求。\n' +
    '禁止：未看图就套「已识别你的产品+三方案」；禁止用用户一句话瞎猜与画面不符的主体。'
  );
}

/** 电商上传参考图：禁止换品、禁止只学形态发挥想象 */
function buildReferenceImageFidelityBlock(rawQuery, imageCount) {
  const q = safeStr(rawQuery, '');
  const dual = imageCount >= 2;
  let roleHint =
    '单张上传图 = 产品/菜品实拍参考：任务是在此商品基础上【美化、排版、加文案】做海报/详情，不是换成别的商品重画。';
  if (dual) {
    roleHint =
      '双图分工（默认附件顺序：第1张=图B产品实拍，第2张=图A版式/风格参考）。\n' +
      '- 若第1张已是带大段排版文字的海报成品、第2张才是菜品/产品实拍：则【以实拍那张为图B主体】，海报那张仅借版式当图A，严禁把海报里的错误商品当主体。\n' +
      '- 若用户写明「图一/图二」「生成图/参考图」：以用户说明为准，但【参考图/实拍】永远是产品主体来源，【生成图/海报】只借版式不借主体。\n' +
      '- 图B：必须与实拍同一道菜/同一产品（如红烧狮子头就写狮子头，禁止写成鸡胸肉丸、牛蛙等其它菜）。\n' +
      '- 图A：只提取配色、模块布局、字体层级，禁止复制图A里的商品种类替换图B。';
  }
  if (/图一|图1|第一张/.test(q) && /参考|实拍|产品/.test(q)) {
    roleHint += '\n用户已标明图一：按用户说明锁定产品主体图。';
  }
  if (/图二|图2|第二张/.test(q) && /参考|实拍|产品/.test(q)) {
    roleHint += '\n用户已标明图二：按用户说明锁定产品主体图。';
  }
  return (
    '\n\n【参考图忠实度·死刑线·电商专用】\n' +
    roleHint +
    '\n' +
    '① 主体锁定：STEP1「内容识别」写明的菜名/产品名 = 全程唯一主体；用户输入框若写了别的品名（如鸡胸肉丸），仍以【上传实拍】为准，仅采纳价格/促销/平台话。\n' +
    '② 任务定义：在参考图基础上做海报设计优化（光影、背景、版式、卖点文案区），不是文生图凭空创作、不是只学「球形/圆形」形态换一道菜。\n' +
    '③ 禁止：脱离参考图换品类；禁止用联网或常识替换画面主体；禁止英文 Prompt 描述与识别结果不一致的食物/产品。\n' +
    '④ 即梦出图：必须图生图并上传【产品实拍】作主体参考，强度建议 65–75（还原优先）；版式可参考第二张或用户指定的风格图。\n' +
    '⑤ 精简版中文文案：标题/卖点须对应识别出的真实商品（如「红烧狮子头」「酱汁狮子头」），不得写参考图里没有的品类。'
  );
}

function isEcomUploadContext(hasFile, route, topic, rawQuery, imageCount) {
  if (!hasFile) return false;
  if (imageCount >= 2) return true;
  const r = route || {};
  return isEcomProfile(r.profile) || isEcomIntentBlob(topic, rawQuery);
}

/** 扣子直聊同级范例：多品类示范「先认品类、再配风格」，非只认牛蛙 */
function buildCozeAnalyzeFewShot() {
  return (
    '【扣子智能体·全品类识别范例·学流程不抄答案】\n' +
    '范例A·餐饮实拍（红烧琵琶鸡腿+红亮酱汁+葱花+红白瓷碗）+「做海报详情图」→ 产品识别须写：主体=琵琶鸡腿、酱汁、器皿、油亮食欲；辅助元素=辣椒姜蒜木桌；主色调=红棕+暖木色；再给3套海报风格方案（家常实拍/复古杂志/国潮手绘）。\n' +
    '反例（禁止）：上传狮子头或鸡腿实拍，却写成「鸡胸肉丸」「低卡健身丸」或只写「已识别你的产品+三方案」。\n' +
    '范例A2·餐饮图+「做海报128元/份」→ 内容识别写清【画面里是什么菜】；品类判定：餐饮海报；风格从餐饮池选（如国潮美食风）。\n' +
    '范例B·护肤品图+「做小红书种草」→ 内容识别写【瓶身/质地/场景】；品类判定：护肤美妆种草图；风格从美妆池选（如清新棚拍/成分图解）。\n' +
    '范例C·城市风光图+「旅游攻略」→ 内容识别写【地标/季节/氛围】；品类判定：旅行攻略图；风格从城市池选（如手绘地图/浮雕城市）。\n' +
    '范例A 完整骨架（餐饮，仅示意格式）：\n' +
    '✅ 内容识别：\n（画面主体+场景+用户诉求，须与图一致）\n' +
    '1. 品类判定：餐饮海报\n' +
    '2. 用户类型：…\n3. 匹配手法：…\n4. 推荐尺寸：…\n5. 本次随机风格：（必须从下方「该品类风格池」中选或同义扩写）\n6. 推荐理由：…\n' +
    '用户不必在输入框写「牛蛙」；任何图都要先根据画面认主体，再结合文字里的价格/用途/平台。'
  );
}

/** 先定品类（图+文），再在该品类风格池内选风格 */
function buildCategoryFirstWorkflowBlock(route) {
  const prof = (route && route.profile) || 'default';
  const pool = getStylePoolForProfile(prof);
  const poolText = pool.length ? pool.join('、') : '爆款知识图解、小红书竖版信息图';
  return (
    '【流水线·先品类后风格·全品类】\n' +
    '第一步（闸门）：综合上传图 + 用户大白话 → 写 ✅内容识别 与 1.品类判定。不限定牛蛙，画面是护肤/旅游/数码/古诗/健身等均可。\n' +
    '第二步：品类确定后，再从该品类风格池挑选 5.本次随机风格，并匹配对应手法与尺寸；禁止未定了品类就乱套无关风格。\n' +
    '系统根据文字预猜品类（仅供参考）：' +
    safeStr(route && route.humanLabel, '待看图判定') +
    '。若与画面不符，以你写的「1.品类判定」为准。\n' +
    '该品类风格池（第5条须从中选一或同义细化）：' +
    poolText
  );
}

/** 电商双图：图A 风格/背景 + 图B 产品主体 → 融合海报 */
function buildEcomDualAnalyzeMessage(p, route, techniqueEffective, style) {
  const rawQuery = safeStr(p.rawQuery, '');
  const userNotes = safeStr(p.userNotes, '');
  const r = route || {};
  return [
    '【STEP1·电商双图融合·对齐扣子 SOP】',
    buildReferenceImageFidelityBlock(rawQuery, 2),
    '\n用户已上传 2 张图片（默认：第1张=图B产品实拍，第2张=图A版式参考；若第1张是成品海报、第2张是实拍，则以实拍为图B）。\n',
    '① 先判断哪张是【产品实拍】、哪张是【海报/版式参考】，在内容识别里写清，禁止把 AI 生成错图里的商品当主体。\n',
    '② 图A（版式参考）：只提取版式、配色、排版、氛围，禁止提取并替换主体商品。\n',
    '③ 图B（产品主体）：必须与实拍同一道菜/产品（名称写进内容识别）。\n',
    '④ 结合用户大白话（换背景、出海报、详情页）写融合方案。\n',
    buildCozeAnalyzeFewShot(),
    '\n【输出格式】\n' +
      '✅ 内容识别：（图A风格要点 + 图B产品要点 + 用户诉求如换背景/海报）\n' +
      '1. 品类判定：电商海报/详情主图\n' +
      '2. 用户类型：\n' +
      '3. 匹配手法：手法四十四或双图融合方案（写明图A图B分工）\n' +
      '4. 推荐尺寸：\n' +
      '5. 本次随机风格：\n' +
      '6. 推荐理由：\n' +
      '禁止只输出「已识别你的产品+三方案」。',
    '\n【系统预匹配】',
    '预猜画法：' + safeStr(r.humanLabel, '电商·双图融合'),
    '预选手法：' + safeStr(techniqueEffective, r.technique || ''),
    userNotes ? '【用户补充】\n' + userNotes : '',
    '【用户原话】\n' + rawQuery,
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** 仅上传参考图（单图）STEP2：从用户话判定海报 / 详情 / 拆解 */
function detectUploadVisualIntent(topic, rawQuery) {
  const blob = [topic, rawQuery].join(' ').toLowerCase();
  if (/爆炸|拆解图|分解图|卖点拆解|结构图|立体拆解|立体展示|部件标注|剖面标注|exploded|cutaway/i.test(blob)) {
    return 'exploded_detail';
  }
  if (/详情页|详情图|详情长图|详情主图|宝贝详情|商品详情|详情首屏|长图详情/i.test(blob)) {
    return 'detail_page';
  }
  return 'poster';
}

function isUploadFoodPosterRoute(route, topic, rawQuery) {
  const r = route || {};
  const blob = [topic, rawQuery].join(' ');
  if (isEcomProfile(r.profile) && /餐饮|美食|菜|锅|蛙|烧烤|火锅|招牌|菜品/.test(blob)) {
    return true;
  }
  return /餐饮|美食|菜|锅|蛙|烧烤|火锅|茶饮|咖啡|烘焙|甜品|招牌菜|菜品/.test(blob);
}

/**
 * 上传参考图 · 单图 STEP2 专线（不替代双图 ecom_dual，不影响无图逻辑）
 */
function buildReferenceImagePromptBlock(topic, style, size, route, rawQuery) {
  const r = route || {};
  const styleHint = r.randomStyleName || style || 'AI智能推荐风格';
  const visualIntent = detectUploadVisualIntent(topic, rawQuery);
  const foodPoster = isUploadFoodPosterRoute(r, topic, rawQuery);
  const sizeHint = size && /16:9|16×9/i.test(size) ? '16:9 横版' : '9:16 竖版（海报/详情优先）';

  let layoutGuide =
    '电商促销海报：与上传图一致的产品/菜品为主体，黄金分割构图，主标题区+价格促销条+卖点图标，背景符合【' +
    styleHint +
    '】，左下角预留二维码留白区。';
  if (visualIntent === 'detail_page') {
    layoutGuide = foodPoster
      ? '餐饮/商品详情首屏长图：顶部食欲主视觉（须与上传图一致）+ 中部3–4个卖点模块（图标+短文案区）+ 规格/份量条 + 底部信任背书，竖版高信息密度。'
      : '电商详情首屏：产品 hero 占屏约45%，右侧或下方卖点矩阵（材质/功能/场景），规格参数条，竖版种草/淘宝详情风格。';
  } else if (visualIntent === 'exploded_detail') {
    layoutGuide =
      '产品爆炸拆解详情图：中心完整产品，关键部件悬浮分离并引线标注，标注区预留中文卖点/材质，科技或美食剖面均可，竖版 9:16。';
  } else if (foodPoster) {
    layoutGuide =
      '餐饮促销海报：上传菜品为唯一主体（色泽摆盘须还原），国潮/节庆/食欲版式，主标题+价格（如128元/份）+ 卖点四字，左下二维码留白，禁止换成与图无关的食物。';
  }

  return (
    '\n\n【上传参考图·STEP2专线·最高优先级】\n' +
    '（本条仅在有上传图时生效，覆盖通用知识卡/菜谱分步/Masters 英文模板要求。）\n' +
    '① 事实来源：STEP1「✅ 内容识别」画面主体 + 用户原话（价格/平台/用途）。用户话与画面冲突时【以图为准】。\n' +
    '② 本次版式意图：' +
    (visualIntent === 'exploded_detail'
      ? '立体拆解卖点详情'
      : visualIntent === 'detail_page'
        ? '商品/菜品详情页'
        : '促销海报') +
    ' → ' +
    layoutGuide +
    '\n' +
    '③ 系统已匹配手法【' +
    (r.technique || '电商海报法') +
    '】风格【' +
    styleHint +
    '】尺寸【' +
    (size || sizeHint) +
    '】。\n\n' +
    '【完整版（推荐）·画面英文描述】\n' +
    '- 一段连贯英文（约 60–120 词，≤900 字符）：必须用 STEP1 识别的同一 subject（菜名/产品名英文描述），composition/lighting/texture 与上传实拍一致；写明海报版式模块与 reserved clean zones for Chinese headline, price tag, promo badges, QR code corner。禁止 describing a different food/product than the reference photo。\n' +
    '- 允许 typography zones / bilingual label areas 描述中文标注区；禁止 no text、blank banner、empty title strip 等规避上屏文案的堆砌。\n' +
    '- 禁止 --ar、--v、--sref、Midjourney 参数行；平台参数只写在「即梦设置」中文条目中。\n' +
    buildNoBrandInPromptBlock() +
    '\n\n' +
    '【精简版（手机端）·即梦/豆包/通义·优先复制本条中文】\n' +
    '- 必须写全要上屏的简体中文：主标题、副标题、价格数字、核心卖点（如招牌菜名/现做现卖/128元/份）、角标；禁止「标题待填」或空框。\n' +
    '- 可补充：背景色、氛围、二维码位置说明。\n\n' +
    '【即梦设置·必写·不可省略】\n' +
    '模式：图生图（img2img）\n' +
    '参考图：使用用户上传的产品/菜品实拍（即梦「参考图/主体参考」）\n' +
    '参考强度：65–75（同一商品还原优先，禁止换菜；仅版式/背景/文案区可适度创作）\n' +
    '比例：' +
    sizeHint +
    '\n' +
    '其他平台备注：豆包/通义选图生图并上传同一张参考图；Midjourney 可用 --cref 参考主体（参数写在本栏，勿写入完整版英文段）。\n'
  );
}

function shouldUseReferenceImagePrompt(p, route) {
  const hasFile = !!(p && (p.hasFile || (p.fileIds && p.fileIds.length)));
  if (!hasFile) return false;
  if (safeStr(p && p.intent, 'analyze') !== 'prompt') return false;
  const imageCount = Math.max(0, parseInt(p && p.imageCount, 10) || 0);
  const r = route || {};
  if (imageCount >= 2 || r.profile === 'ecom_dual') return false;
  if (isEcomProfile(r.profile)) return true;
  return isEcomIntentBlob(
    safeStr(p && p.coreTopic, ''),
    safeStr(p && p.rawQuery, '')
  );
}

/** 无上传图 · 仅电商品类：替代 Masters 禁字长英文，走海报/详情结构 */
function buildEcomPosterQualityBlock(topic, style, size, route, rawQuery) {
  const r = route || {};
  const styleHint = r.randomStyleName || style || 'AI智能推荐风格';
  const visualIntent = detectUploadVisualIntent(topic, rawQuery || topic);
  const tpl =
    r.profile === 'ecom_detail_exploded'
      ? '爆炸拆解详情（悬浮部件+引线+中文卖点区）'
      : visualIntent === 'detail_page'
        ? '详情页首屏（产品 hero + 卖点模块 + 规格条）'
        : '促销海报（主标题+价格条+二维码留白）';
  return (
    '\n\n【电商出图专线·无上传图】\n' +
    '（仅电商/海报/详情/主图类；不影响旅游/知识卡/古诗等其它品类。）\n' +
    '版式：' +
    tpl +
    '；手法【' +
    (r.technique || '手法四十四·平台封面专属模板法') +
    '】；风格【' +
    styleHint +
    '】；尺寸【' +
    (size || 'AI推荐尺寸') +
    '】。\n' +
    '完整版英文：描述版式模块、主体、场景、光影，保留 Chinese typography zones for headline and price；禁止 no text 堆砌；禁止 --v --ar。\n' +
    '精简版中文：写全主标题、价格、卖点短句。\n' +
    buildNoBrandInPromptBlock()
  );
}

function isEcomIntentBlob(topic, rawQuery) {
  const blob = [topic, rawQuery].join(' ');
  if (/古诗|诗词|旅游|星座|电路|光合作用|菜谱教程|做法步骤|怎么做|步骤图/.test(blob)) {
    return false;
  }
  return /电商|主图|详情页|详情图|促销海报|带货|产品图|推广海报|海报|卖点拆解|爆炸图|立体拆解|淘宝|小红书商品|种草图|二维码/.test(
    blob
  );
}

function shouldUseEcomNoFilePrompt(p, route) {
  if (shouldUseReferenceImagePrompt(p, route)) return false;
  if (safeStr(p && p.intent, 'analyze') !== 'prompt') return false;
  const r = route || {};
  if (isEcomProfile(r.profile)) return true;
  return isEcomIntentBlob(
    safeStr(p && p.coreTopic, ''),
    safeStr(p && p.rawQuery, '')
  );
}

function validateReferenceImagePrompt(prompt, route) {
  const pkg = parseCozeOutputPackage(prompt);
  if (!pkg.hasPackage) {
    return { valid: false, reason: '未识别到 STEP2 标准包（完整版/精简版）' };
  }
  const en = safeStr(pkg.englishFull);
  const cn = safeStr(pkg.chineseShort);
  if (en.length < 80) {
    return {
      valid: false,
      reason: '完整版英文过短（当前 ' + en.length + '，上传图海报建议 ≥80 字符）',
    };
  }
  if (/^[\u4e00-\u9fff\s，。！？、；：]+$/.test(en)) {
    return { valid: false, reason: '完整版须含英文画面描述' };
  }
  if (cn.length < 12 || !/[\u4e00-\u9fff]{4,}/.test(cn)) {
    return {
      valid: false,
      reason: '精简版须含可上屏简体中文文案（主标题/价格/卖点）',
    };
  }
  if (
    !/composition|layout|poster|product|photorealistic|food|hero|module|panel|typography|reserved|lighting|texture|infographic|exploded|cutaway/i.test(
      en
    ) &&
    en.length < 160
  ) {
    return {
      valid: false,
      reason: '英文段缺少版式/主体/光影结构描述',
    };
  }
  return { valid: true, reason: '' };
}

function buildReferenceImagePromptRetryBlock(validation, topic, style, route, rawQuery) {
  const r = route || {};
  return (
    '\n\n【系统质量熔断 · 上传参考图海报/详情 · 强制重生成】\n' +
    '上次未通过：' +
    (validation && validation.reason ? validation.reason : '未达标') +
    '。\n' +
    '主题【' +
    topic +
    '】；风格【' +
    (r.randomStyleName || style) +
    '】。\n' +
    '必须重新输出完整 STEP2 包：📊结构化要点 → 完整版英文（与上传图同一主体一致）→ 精简版【全部中文卖点与价格】→ 即梦设置【图生图+参考强度65-75】。\n' +
    buildReferenceImagePromptBlock(topic, style, 'AI推荐尺寸', r, rawQuery || topic)
  );
}

function buildEcomDualPromptBlock(topic, style, size, route, rawQuery) {
  const r = route || {};
  return (
    buildReferenceImageFidelityBlock(rawQuery || topic, 2) +
    '\n\n【电商双图融合·STEP2·已确认】\n' +
    '必须以「图A」的版式/配色/氛围为底，将「图B」产品主体自然融入；图B必须与实拍同一商品，禁止用图A里的商品替换图B；用户关于背景色、海报尺寸、平台的文字必须落实。\n' +
    '主题【' +
    topic +
    '】；风格【' +
    (r.randomStyleName || style) +
    '】；尺寸【' +
    (size || 'AI推荐尺寸') +
    '】。\n' +
    '英文 Prompt 须描述：layout from style reference image A, product hero from image B, background color as user requested, reserved clean zone for QR code if poster.\n' +
    '末尾中文提示：即梦图生图【必传图B产品实拍】作主体参考，强度 65–75；图A仅风格/版式参考（强度约40–50），严禁用图A商品覆盖图B。\n' +
    buildStep2OutputBlock(topic, style, size, route)
  );
}

function buildCozeMirrorAnalyzeMessage(p, route, techniqueEffective, style) {
  const imageCount =
    (p && p.imageCount) || (p && p.fileIds && p.fileIds.length) || 0;
  if (imageCount >= 2) {
    return buildEcomDualAnalyzeMessage(p, route, techniqueEffective, style);
  }
  const rawQuery = safeStr(p.rawQuery, '');
  const userNotes = safeStr(p.userNotes, '');
  const r = route || {};
  return [
    '【STEP1·上传图分析·对齐扣子智能体直聊】',
    buildVisionFirstAnalyzeBlock(),
    buildReferenceImageFidelityBlock(rawQuery, imageCount),
    buildCategoryFirstWorkflowBlock(r),
    buildCozeAnalyzeFewShot(),
    '\n【系统预匹配·写入时须服从你判定的品类】',
    '预猜画法：' + safeStr(r.humanLabel, ''),
    '预选手法：' + safeStr(techniqueEffective, r.technique || ''),
    '预选风格（若品类一致可参考）：' + safeStr(r.randomStyleName || style, 'AI智能推荐风格'),
    buildAnalyzeOutputFormatBlock(true, r, rawQuery),
    userNotes ? '【用户补充】\n' + userNotes : '',
    '【用户原话】\n' + rawQuery,
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** 上传图 STEP1：对齐扣子直聊的「产品识别 + 三套海报方案」详析 */
function buildCozeDetailedAnalyzeFormatBlock(route, rawQuery) {
  const dishHint = /海报|详情/.test(String(rawQuery || ''))
    ? '海报/详情页'
    : '促销海报';
  return (
    '\n\n【输出格式·对齐扣子智能体·必须详尽·禁止缩写】\n' +
    '禁止输出「已识别你的产品+三方案」一句话带过。禁止菜单按钮（回复1/2/3）。\n\n' +
    '先写大段「产品识别」（也可用标题 ✅ 内容识别，二者等价），必须分条写满：\n' +
    '**主体：** 菜名/产品名（必须与画面一致）+ 酱汁/色泽/器皿/摆盘/食欲点（如油亮诱人）\n' +
    '**辅助元素：** 配菜、调料、桌面、餐垫、道具等\n' +
    '**主色调：** 具体配色组合 + 氛围一句（如食欲感、家常感）\n\n' +
    '再写「目前【' +
    (route && route.humanLabel ? route.humanLabel : '该品类') +
    '】流行' +
    dishHint +
    '风格」，给出 **3 套可执行方案**（方案1/方案2/方案3），每套写明版式、背景、字体、适用平台（如朋友圈/小红书/抖音）。\n' +
    '用户诉求「' +
    dishHint +
    '」须在方案中落实（如详情页=长图模块；海报=主图+价格+二维码区）。\n\n' +
    '最后输出以下 6 行（供系统解析，不可省略）：\n' +
    '1. 品类判定：\n' +
    '2. 用户类型：\n' +
    '3. 匹配手法：\n' +
    '4. 推荐尺寸：\n' +
    '5. 本次随机风格：（从品类风格池选一，写全称）\n' +
    '6. 推荐理由：'
  );
}

function buildAnalyzeOutputFormatBlock(hasFile, route, rawQuery) {
  if (hasFile) {
    const r = route || {};
    if (isEcomProfile(r.profile) || isEcomIntentBlob('', rawQuery || '')) {
      return buildCozeDetailedAnalyzeFormatBlock(r, rawQuery);
    }
    return (
      '\n\n【输出格式·与扣子一致·禁止菜单按钮】\n' +
      '✅ 内容识别：\n' +
      '（先写画面主体是什么，再写用户文案里的用途/价格/平台）\n' +
      '1. 品类判定：（先定类，再定风格）\n' +
      '2. 用户类型：\n' +
      '3. 匹配手法：\n' +
      '4. 推荐尺寸：\n' +
      '5. 本次随机风格：（须属于上文品类对应风格池）\n' +
      '6. 推荐理由：'
    );
  }
  return (
    '\n\n请输出结构化分析（禁止菜单选项）：\n' +
    '1. 品类判定\n2. 用户类型\n3. 匹配手法\n4. 推荐尺寸\n5. 本次随机风格\n' +
    '6. 内容要点\n7. 联想记忆点\n8. 场景延伸\n9. 电商应用潜力\n10. 全息深度洞察'
  );
}

const ANALYZE_STRUCTURE_MARKERS = [
  '内容识别',
  '品类判定',
  '匹配手法',
  '推荐尺寸',
  '本次随机风格',
  '推荐理由',
  '内容要点',
];

function countAnalyzeMarkers(text) {
  const c = String(text || '');
  let n = 0;
  let i = 0;
  while (i !== ANALYZE_STRUCTURE_MARKERS.length) {
    if (c.indexOf(ANALYZE_STRUCTURE_MARKERS[i]) >= 0) n++;
    i++;
  }
  return n;
}

function isEcomShortcutAnalyze(text) {
  const c = String(text || '');
  if (!/已识别你的产品|已识别你的产品为/.test(c)) return false;
  if (/内容识别|✅\s*内容识别/.test(c) && countAnalyzeMarkers(c) >= 3) return false;
  return /方案\s*[123一二三]|目标平台|淘宝\/小红书/.test(c) || countAnalyzeMarkers(c) < 2;
}

/**
 * STEP1 分析自我检测（有图时强制扣子式结构化）
 */
function validateAnalyzeResponse(text, rawQuery, route, hasFile) {
  const c = String(text || '').trim();
  if (!c || c.length < 80) {
    return { valid: false, reason: '分析过短或为空' };
  }
  if (isSopTemplateSkeleton(c)) {
    return { valid: false, reason: '输出为模板占位而非真实分析' };
  }
  const markers = countAnalyzeMarkers(c);
  if (hasFile) {
    const detailedVision =
      /产品识别|内容识别|✅/.test(c) &&
      (/主体|辅助元素|主色调/.test(c) || c.length >= 280);
    const hasPlans = /方案\s*1|方案1|方案一/.test(c);
    if (isEcomShortcutAnalyze(c)) {
      return {
        valid: false,
        reason: '走了电商缩写流程（已识别你的产品+方案），未按扣子 STEP1 详析',
      };
    }
    if (!detailedVision && markers < 3) {
      return {
        valid: false,
        reason: '有上传图但缺少扣子式产品识别（主体/辅助元素/主色调）或结构化字段',
      };
    }
    if (detailedVision && !hasPlans && markers < 2) {
      return { valid: false, reason: '已有识别但缺少3套海报/详情方案（方案1/2/3）' };
    }
    if (!detailedVision && markers < 3) {
      return { valid: false, reason: '有上传图但缺少结构化分析字段（需内容识别/品类/手法等）' };
    }
    if (!/内容识别|产品识别|✅/.test(c)) {
      return { valid: false, reason: '有上传图但未输出「产品识别/内容识别」' };
    }
  } else if (markers < 2) {
    return { valid: false, reason: '缺少基本结构化分析字段' };
  }
  return { valid: true, reason: '' };
}

function buildAnalyzeRetryBlock(validation, hasFile) {
  const reason = (validation && validation.reason) || '分析未达标准';
  let block =
    '\n\n【STEP1 自我检测未通过 · 必须重写】\n' +
    '原因：' +
    reason +
    '\n' +
    '请重新完整输出 STEP1 分析，禁止解释失败原因，禁止菜单。';
  if (hasFile) {
    block +=
      '\n请重新观看上传图：先写详尽「产品识别」（主体/辅助元素/主色调），再给3套海报方案（方案1/2/3），最后写 1~6 字段。' +
      '\n禁止「已识别你的产品+三方案」缩写。菜名/产品必须与画面一致。';
  }
  return block;
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

function isPosterStyleRoute(route) {
  const p = route && route.profile;
  if (isEcomProfile(p)) return true;
  const t = String((route && route.topic) || '');
  return /海报|菜谱|美食|餐饮|牛蛙|火锅|促销|电商|产品图|主图|详情页|种草|探店|食谱|招牌|菜品/.test(t);
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
    (isPosterStyleRoute(r)
      ? '（英文辅助说明，≤' +
        Math.min(limit, 900) +
        ' 字符，≤120 英文词，一句连贯画面；禁止 negative prompt、禁止 --ar/--v、禁止 no text/blank overlay/empty banner/reserved typography zones）\n'
      : '（此处必须是可复制到即梦的英文正文，≤' +
        limit +
        ' 字符，≥350 字符，含版式模块/主体/场景/Chinese typography zones 等，禁止方括号占位）\n') +
    '📱 精简版（手机端适配）\n' +
    (isPosterStyleRoute(r)
      ? '（【即梦优先复制】中文须写明全部可见文案：主标题、价格、卖点四字，如炭烤牛蛙/128元/现杀现烤，禁止空标题框）\n'
      : '（中文精简描述，保留核心画面与版式）\n') +
    '⚙️ 即梦设置：比例 / 模式 / 参考度 / 角色模型\n' +
    '📣【抖音话题标签】\n' +
    '（3-5 个 # 标签）\n' +
    '可在末尾一句询问是否需要配套文案；禁止输出「回复1/2/3」菜单按钮。\n'
  );
}

function buildPromptQualityBlock(topic, style, size, route, rawQuery) {
  const r =
    route ||
    routePlainLanguageTopic(topic, '', require('path').join(__dirname));
  if (r.profile === 'lifecycle' || detectLifecycleTopic(topic, '')) {
    return buildLifecycleInfographicBlock(topic, style, size || 'AI推荐尺寸');
  }
  if (isEcomProfile(r.profile)) {
    return buildEcomPosterQualityBlock(
      topic,
      style,
      size || 'AI推荐尺寸',
      r,
      rawQuery || topic
    );
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

function validatePromptForTopic(prompt, topic, route, hasFile) {
  const r =
    route ||
    routePlainLanguageTopic(topic, '', require('path').join(__dirname));
  const pkg = parseCozeOutputPackage(prompt);
  if (hasFile && (isEcomProfile(r.profile) || isEcomIntentBlob(topic, ''))) {
    return validateReferenceImagePrompt(prompt, r);
  }
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

function buildPromptRetryBlockForTopic(validation, topic, style, route, hasFile, rawQuery) {
  const r =
    route ||
    routePlainLanguageTopic(topic, '', require('path').join(__dirname));
  if (hasFile && (isEcomProfile(r.profile) || isEcomIntentBlob(topic, rawQuery || ''))) {
    return buildReferenceImagePromptRetryBlock(
      validation,
      topic,
      style,
      r,
      rawQuery || topic
    );
  }
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
/**
 * 《系统逻辑完整版》聚焦 Prompt — 每次仅注入当前品类模板 + SOP 切片
 */
function buildStrictMdCozeMessage(p) {
  const topic = safeStr(p.coreTopic, safeStr(p.rawQuery, '用户主题'));
  const style = safeStr(p.style, 'AI智能推荐风格');
  const size = safeStr(p.size, 'AI推荐尺寸');
  const intent = safeStr(p.intent, 'analyze');
  const userNotes = safeStr(p.userNotes, '');
  const rawQuery = safeStr(p.rawQuery, topic);
  const hasFile = !!(p.hasFile || (p.fileIds && p.fileIds.length));
  const route =
    p.route ||
    routePlainLanguageTopic(topic, rawQuery || userNotes, p.rootDir, {
      hasFile: hasFile,
      imageCount: (p && p.imageCount) || 0,
    });
  const techniqueEffective = safeStr(
    p.technique,
    route.technique || '手法三·结构化知识模块法'
  );
  const templateKey = route.mdTemplateKey || route.profile || 'default';
  const structureBlock = getStructureTemplate(templateKey);
  const styleName = route.randomStyleName || style;

  const styleLibBlock = buildStyleLibSystemBlock({
    rootDir: p.rootDir,
    intent: intent,
    topic: topic,
    coreTopic: topic,
    style: styleName,
    technique: techniqueEffective,
    size: size,
    hasFile: hasFile,
  });

  const head =
    '【知识图文魔方·系统逻辑完整版·后端执行】\n' +
    '【第一章·输出顺序铁律】知识点结构化 → 完整版提示词 → 精简版 → 即梦设置 → 话题标签\n' +
    '【第二章·四层判定结果】\n' +
    '第二层品类：' +
    safeStr(route.mdCategoryName, '') +
    '\n第三层用户类型：' +
    safeStr(route.userType, '') +
    '\n第四层手法：' +
    techniqueEffective +
    '\n第五层本次风格（第十四章风格池）：' +
    styleName +
    '\n\n' +
    structureBlock +
    '\n\n' +
    DENSITY_RULES_CH5 +
    '\n\n' +
    (route.needWebSearch
      ? buildWebSearchFallbackBlock(route)
      : route.networkFallbackBlock || getNetworkFallbackBlock()) +
    '\n\n' +
    styleLibBlock;

  if (intent === 'analyze' && hasFile) {
    return buildCozeMirrorAnalyzeMessage(
      {
        rawQuery: rawQuery,
        userNotes: userNotes,
        style: styleName,
        coreTopic: topic,
        fileIds: p.fileIds || [],
        imageCount: (p && p.imageCount) || 0,
      },
      route,
      techniqueEffective,
      styleName
    );
  }

  if (intent === 'analyze') {
    return (
      head +
      '\n\n' +
      buildAnalyzeOutputFormatBlock(hasFile, route, rawQuery) +
      '\n\n【STEP1·主题分析】核心主题【' +
      topic +
      '】\n【用户原话】\n' +
      rawQuery
    );
  }

  if (intent === 'prompt') {
    const imageCount = (p && p.imageCount) || 0;
    if (imageCount >= 2 || route.profile === 'ecom_dual') {
      return (
        head +
        '\n\n' +
        buildEcomDualPromptBlock(topic, styleName, size, route, rawQuery) +
        '\n【用户原话·必须贯彻】\n' +
        rawQuery
      );
    }
    if (shouldUseReferenceImagePrompt(p, route)) {
      const refHead =
        '【知识图文魔方·电商·上传参考图·STEP2专线】\n' +
        '第二层品类：' +
        safeStr(route.mdCategoryName, route.humanLabel || '') +
        '\n第四层手法：' +
        techniqueEffective +
        '\n第五层风格：' +
        styleName +
        '\n\n' +
        buildVisionFirstAnalyzeBlock() +
        '\n' +
        buildReferenceImageFidelityBlock(rawQuery, imageCount) +
        '\n' +
        styleLibBlock;
      return (
        refHead +
        buildReferenceImagePromptBlock(topic, styleName, size, route, rawQuery) +
        buildStep2OutputBlock(topic, styleName, size, route) +
        '\n\n【第十三章·即梦字符】精简版中文卖点须完整；完整版英文画面段建议 80–900 字符。\n' +
        '【用户确认·已批准方案】\n【用户原话】\n' +
        rawQuery
      );
    }
    if (shouldUseEcomNoFilePrompt(p, route)) {
      return (
        head +
        '\n\n' +
        buildEcomPosterQualityBlock(topic, styleName, size, route, rawQuery) +
        buildStep2OutputBlock(topic, styleName, size, route) +
        '\n【用户确认·已批准方案】\n【用户原话】\n' +
        rawQuery
      );
    }
    return (
      head +
      '\n\n' +
      buildStep2OutputBlock(topic, styleName, size, route) +
      '\n\n【第十三章·即梦字符】精简版英文不得超过 ' +
      JIMENG_CHAR_LIMIT +
      ' 字符；必须保留收尾语：' +
      JIMENG_TAIL_LITE +
      '\n【用户确认·已批准方案】\n【用户原话】\n' +
      rawQuery
    );
  }

  if (intent === 'copywrite') {
    return (
      head +
      '\n\n【第十一章·增收文案·X触发】\n' +
      '角色：第一人称受益者；禁止广告腔。\n' +
      '输出：小红书笔记 + 公众号文章 + 首评钩子。\n' +
      '核心主题【' +
      topic +
      '】\n【用户原话】\n' +
      rawQuery
    );
  }

  return head + '\n\n【用户原话】\n' + rawQuery;
}

function buildCozeMessage(p) {
  if (STRICT_MD_MODE) {
    return buildStrictMdCozeMessage(p);
  }
  const topic = safeStr(p.coreTopic, safeStr(p.rawQuery, '用户主题'));
  const style = safeStr(p.style, 'AI智能推荐风格');
  const size = safeStr(p.size, 'AI推荐尺寸');
  const intent = safeStr(p.intent, 'analyze');
  const userNotes = safeStr(p.userNotes, '');
  const rawQuery = safeStr(p.rawQuery, topic);

  const hasFile = !!(p.hasFile || (p.fileIds && p.fileIds.length));
  const route =
    p.route ||
    routePlainLanguageTopic(topic, rawQuery || userNotes, p.rootDir, {
      hasFile: hasFile,
      imageCount: (p && p.imageCount) || 0,
    });
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
    hasFile: hasFile,
  });

  if (intent === 'analyze' && hasFile) {
    return buildCozeMirrorAnalyzeMessage(
      {
        rawQuery: rawQuery,
        userNotes: userNotes,
        style: style,
        coreTopic: topic,
        fileIds: p.fileIds || [],
        imageCount: p.imageCount || 0,
      },
      route,
      techniqueEffective,
      style
    );
  }

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

  const imageCountEarly = (p && p.imageCount) || 0;
  const ecomUpload =
    hasFile && isEcomUploadContext(hasFile, route, topic, rawQuery, imageCountEarly);

  const headParts = [
    buildHumanFirstBlock(topic, userNotes || rawQuery),
    routeBrief,
    styleLibBlock,
    buildWebSearchFallbackBlock(route),
  ];
  if (ecomUpload) {
    headParts.push(buildReferenceImageFidelityBlock(rawQuery, imageCountEarly));
  } else {
    headParts.push(buildIntentEnhancementSOP(topic, rawQuery));
  }
  if (!(hasFile && intent === 'analyze')) {
    headParts.push(buildSearchBlock(topic));
  } else {
    headParts.push(
      '【联网搜索已禁用】用户已上传参考图，STEP1 必须以看图识别为主，禁止脱离画面联网瞎编物种或菜名。'
    );
  }
  if (hasFile && intent === 'analyze') {
    headParts.push(
      '【主题锁·看图后生效】核心主题 = 上传图识别出的商品/菜品名称，不得用输入框里其它品名替换；价格/促销话可用用户原文。'
    );
  } else if (!ecomUpload) {
    headParts.push(buildSubjectLock(topic, style, techniqueEffective));
  }
  headParts.push(buildNoFluffBlock(topic));
  let head = headParts.join('\n\n');
  if (route.categorySnippet && !(hasFile && intent === 'analyze')) {
    head += '\n\n【路由注入·品类模板】\n' + route.categorySnippet.slice(0, 1500);
  }

  const lifecycle = route.profile === 'lifecycle' || detectLifecycleTopic(topic, rawQuery);
  const isFoodPosterRoute =
    isEcomProfile(route.profile) &&
    /餐饮|美食|菜|锅|蛙|烧烤|火锅|招牌|菜品|炭烤|茶饮|咖啡|烘焙/.test(
      topic + ' ' + rawQuery
    );
  const analyzeHint =
    '\n\n【分析必遵·人话输出·STEP1】匹配手法必须写「' +
    route.technique +
    '」；推荐尺寸优先 9:16 竖版（电商海报/详情可用 9:16 或 3:4）。' +
    '「5. 本次随机风格」必须写：' +
    (route.randomStyleName || style) +
    '（人话，禁止只写编号）。' +
    '「3. 匹配手法」行必须包含：' +
    route.technique +
    '。' +
    (hasFile && isFoodPosterRoute
      ? '\n电商餐饮上传图：内容识别必须写明食物物种与食欲卖点，品类判定为餐饮电商海报或详情，对齐扣子智能体。'
      : hasFile && isEcomProfile(route.profile)
        ? '\n电商上传图：内容识别须与画面主体一致，品类判定为电商海报/详情/拆解详情之一。'
        : '') +
    '\n';

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
      (ecomUpload ? '' : buildDeepAnalysisBlock(topic)) +
      buildAnalyzeOutputFormatBlock(hasFile, route, rawQuery) +
      '\n\n' +
      (userNotes ? '【用户补充材料】\n' + userNotes + '\n\n' : '') +
      '【用户原始输入】\n' +
      rawQuery
    );
  }

  if (intent === 'prompt') {
    const imageCount = (p && p.imageCount) || 0;
    if (imageCount >= 2 || route.profile === 'ecom_dual') {
      return (
        head +
        buildEcomDualPromptBlock(topic, style, size, route, rawQuery) +
        '\n【用户原话·必须贯彻】\n' +
        rawQuery
      );
    }
    let lifecycleConfirm = lifecycle
      ? '【用户确认·生命周期图解】已批准方案。请按扣子智能体内「' +
        topic +
        '」直聊同级质量输出，严格套用知识库「手法三十二」五阶段结构（参考荔枝/榴莲/石榴一生剖面或人生五阶段时间轴）。\n' +
        '【用户原话·必须贯彻】\n' +
        rawQuery +
        '\n'
      : '【用户确认·已批准方案】\n【用户原话·必须贯彻】\n' + rawQuery + '\n';
    if (userNotes && /文案要点摘录|笔记配图|【正文】|知识图文笔记/.test(userNotes)) {
      lifecycleConfirm +=
        '\n【笔记配图联动·最高优先】用户已写好笔记框架，完整版英文必须结合下列文案设计画面（主体/场景/卖点/版式模块），≥380字符，禁止只输出 no text 类合规堆砌。\n' +
        userNotes +
        '\n';
    }
    if (shouldUseReferenceImagePrompt(p, route)) {
      return (
        head +
        '\n\n' +
        buildVisionFirstAnalyzeBlock() +
        '\n' +
        buildReferenceImageFidelityBlock(rawQuery, imageCount) +
        '\n' +
        buildReferenceImagePromptBlock(topic, style, size, route, rawQuery) +
        buildStep2OutputBlock(topic, style, size, route) +
        '【严禁】方括号占位；英文禁止真实品牌/商标/IP 名。\n' +
        lifecycleConfirm
      );
    }
    if (shouldUseEcomNoFilePrompt(p, route)) {
      return (
        head +
        '\n\n' +
        buildEcomPosterQualityBlock(topic, style, size, route, rawQuery) +
        buildStep2OutputBlock(topic, style, size, route) +
        '【严禁】方括号占位；英文禁止真实品牌/商标/IP 名。\n' +
        lifecycleConfirm
      );
    }
    const useStep2 =
      usesFullCozePackage(route.profile) ||
      isKnowledgeProfile(route.profile) ||
      lifecycle;
    return (
      head +
      '\n\n' +
      buildPromptQualityBlock(topic, style, size, route, rawQuery) +
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
  buildReferenceImagePromptBlock,
  shouldUseReferenceImagePrompt,
  validateReferenceImagePrompt,
  usesFullCozePackage,
  isSopTemplateSkeleton,
  sanitizeNoTextPrompt,
  sanitizeLifecyclePrompt,
  stripKnownBrandNames,
  copywriteTopicMismatch,
  validateAnalyzeResponse,
  buildAnalyzeRetryBlock,
  MIN_MASTERS_PROMPT_CHARS,
  MASTERS_MANDATORY_TAIL,
};

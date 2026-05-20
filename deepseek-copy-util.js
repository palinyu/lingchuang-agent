/**
 * 右侧「爆款文案」DeepSeek 调用（供 api/generate.js 与 server.js 共用）
 */
const fs = require('fs');
const path = require('path');

function loadEnvValue(key) {
  let v = process.env[key];
  if (v) return String(v).trim();
  try {
    const envPath = path.join(process.cwd(), '.env.local');
    if (fs.existsSync(envPath)) {
      const envContent = fs.readFileSync(envPath, 'utf8');
      const prefix = key + '=';
      const lines = envContent.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const t = line.trim();
        if (t.startsWith(prefix)) return t.slice(prefix.length).trim();
      }
    }
  } catch (e) {
    /* ignore */
  }
  return '';
}

/** 解析 DeepSeek / OpenAI 兼容 chat.completions JSON，兼容 content 为数组、reasoning 等形态 */
function extractDeepseekChoiceContent(data) {
  if (!data || !Array.isArray(data.choices) || data.choices.length === 0) return '';
  for (let ci = 0; ci < data.choices.length; ci++) {
    const ch = data.choices[ci];
    const msg = ch && ch.message;
    let out = '';
    if (msg) {
      let c = msg.content;
      if (c == null || c === '') c = msg.reasoning_content;
      if (typeof c === 'string') out = String(c).trim();
      else if (Array.isArray(c)) {
        out = c
          .map(function (p) {
            if (typeof p === 'string') return p;
            if (p && p.type === 'text' && p.text) return String(p.text);
            if (p && typeof p.content === 'string') return p.content;
            return '';
          })
          .join('')
          .trim();
      }
    } else if (ch && typeof ch.text === 'string') {
      out = String(ch.text).trim();
    }
    if (out) return out;
  }
  return '';
}

/** 内部值 → 提示词里只用中性渠道代称，不出现平台注册全称 */
function platformVoice(internal) {
  if (internal === 'douyin') {
    return {
      label: '短视频信息流',
      extra:
        '标题短促有力；正文以短句为主，节奏：问句→转折→要点→号召；避免长段落。',
    };
  }
  if (internal === 'shipinhao') {
    return {
      label: '熟人圈短视频',
      extra: '标题观点鲜明；正文总分总、干货密度高；语气稳重；emoji 少。',
    };
  }
  if (internal === 'bilibili') {
    return {
      label: '中长视频社区',
      extra:
        '开头 5 秒内抛冲突/反差；中段分点拆解；结尾引导互动；信息密度高、口播感强，避免流水账。',
    };
  }
  if (internal === 'zhihu') {
    return {
      label: '问答长文社区',
      extra: '先给结论再给论证；分点清晰；适度引用「经验」而非杜撰数据；语气克制可信。',
    };
  }
  if (internal === 'weibo') {
    return {
      label: '短图文广场',
      extra: '观点短促锐利；善用话题标签串联；情绪点到为止；避免超长段落与空泛口号。',
    };
  }
  return {
    label: '图文种草社区',
    extra:
      '标题尽量包含人群词+痛点词+解决方案倾向；正文：开头钩子→干货→互动引导；结尾可加一句互动；emoji 可适度使用，但不要堆砌。',
  };
}

function buildDeepseekSystemPrompt(platform, category, persona, copyStyle) {
  const voice = platformVoice(platform);
  const personaMap = {
    jiemei: '亲切姐妹口吻',
    qinqie: '亲切姐妹口吻',
    daren: '专业达人口吻',
    zhuanye: '专业达人口吻',
    dushe: '毒舌测评口吻',
    suren: '素人真实口吻',
    youmo: '轻松幽默口吻',
    lxing: '理性分析口吻',
    wenrou: '温柔疗愈口吻',
    laoshi: '严师教练口吻',
  };
  const styleMap = {
    ceping: '测评体',
    ganhuo: '干货体',
    gushi: '故事体',
    duibi: '对比体',
    gonglue: '攻略体',
    qinggan: '情感体',
    qingdan: '清单体',
    zhongcao: '种草安利体',
    fupan: '复盘总结体',
    bilei: '避雷避坑体',
    heji: '合集盘点体',
    redian: '热点评论体',
    jinju: '金句高密度体',
    lishi: '立论拆解体',
    wenda: '问答闯关体',
    koubo: '口播逐字稿体',
    kaoti: '开题悬念体',
    duanpian: '短篇故事体',
    bilishi: '对比+清单混合体',
    changjing: '场景沉浸体',
  };
  const p = personaMap[persona] || personaMap.jiemei;
  const cs = styleMap[copyStyle] || styleMap.ganhuo;
  return (
    '你是一位专业的「' +
    voice.label +
    '」内容创作者，擅长「' +
    category +
    '」领域。\n' +
    '以「' +
    p +
    '」的语气，用「' +
    cs +
    '」结构来组织全文。\n' +
    voice.extra +
    '\n\n输出格式（必须严格保留三段标题）：\n' +
    '【标题】（25字以内，可含适量 emoji）\n' +
    '【正文】（符合渠道字数与节奏习惯；为创作框架，非最终发布稿）\n' +
    '【话题标签】（8–10个，以#开头）\n\n' +
    '严格禁止：\n' +
    '· 不得使用第一人称虚假使用体验；真实体验句请用「[请填入你的真实体验]」占位。\n' +
    '· 不得出现具体品牌名称（用[品牌名]占位）。\n' +
    '· 不得使用违禁词：治疗/根治/最XX/第一/国家认证等。\n' +
    '· 不得出现具体数字承诺（三天瘦X斤/X天见效等）。\n' +
    '· 标题、正文、话题中不得出现主流内容平台的注册全称或明显谐音代称；用中性表述指代渠道。\n\n' +
    '改写要求：\n' +
    '· 在爆款框架上重新组织语言，每次换切入点，与常见套路拉开差异。\n' +
    '· 内容为创作框架，提醒用户修改后再发布；商业推广须依法标注「广告」或「品牌合作」。'
  );
}

/**
 * 浏览器直传 OpenAI 形状（仅含 model/messages/temperature/max_tokens + lc_ds_chat），
 * 供网关将整包 JSON 原样转发到 DeepSeek 时仍含 messages，避免 missing field messages。
 */
async function forwardDeepseekClientChat(body) {
  const key = loadEnvValue('DEEPSEEK_API_KEY');
  if (!key) {
    return {
      code: -1,
      msg: '未配置 DEEPSEEK_API_KEY（请在环境变量或 .env.local 中配置）',
      httpStatus: 500,
    };
  }
  const messages = body && body.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return { code: -1, msg: 'messages 不能为空', httpStatus: 400 };
  }
  const outgoing = {
    model: String(body.model || 'deepseek-chat').trim() || 'deepseek-chat',
    messages: messages,
    temperature: typeof body.temperature === 'number' ? body.temperature : 0.85,
    max_tokens: typeof body.max_tokens === 'number' ? body.max_tokens : 4096,
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(function () {
    controller.abort();
  }, 90000);
  try {
    const r = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + key,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(outgoing),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    const raw = await r.text();
    let data = null;
    try {
      data = raw ? JSON.parse(raw) : null;
    } catch (e) {
      data = null;
    }
    if (!r.ok) {
      const errMsg =
        (data && data.error && (data.error.message || data.error.msg)) || raw || 'DeepSeek 请求失败';
      return {
        code: -1,
        msg: 'DeepSeek：' + String(errMsg).slice(0, 500),
        httpStatus: 502,
      };
    }
    const content = extractDeepseekChoiceContent(data);
    if (!content) {
      return { code: -1, msg: 'DeepSeek 返回内容为空', httpStatus: 502 };
    }
  } catch (err) {
    clearTimeout(timeoutId);
    const isAbort = err && (err.name === 'AbortError' || /aborted/i.test(err.message || ''));
    return {
      code: -1,
      msg: isAbort ? 'DeepSeek 请求超时' : 'DeepSeek 调用失败：' + (err.message || String(err)),
      httpStatus: 500,
    };
  }
}

/**
 * @param {object} body 已解析的 JSON 请求体
 * @returns {Promise<{ code: number, answer?: string, msg?: string, meta?: object, httpStatus?: number }>}
 */
async function fetchDeepseekCopywrite(body) {
  if (body && body.lc_ds_chat === true && Array.isArray(body.messages) && body.messages.length > 0) {
    return forwardDeepseekClientChat(body);
  }
  const key = loadEnvValue('DEEPSEEK_API_KEY');
  if (!key) {
    return {
      code: -1,
      msg: '未配置 DEEPSEEK_API_KEY（请在环境变量或 .env.local 中配置）',
      httpStatus: 500,
    };
  }
  const topic = String(
    (body && body.ds_topic) || (body && body.topic) || (body && body.prompt) || ''
  ).trim();
  if (!topic) {
    return { code: -1, msg: '请填写主题', httpStatus: 400 };
  }
  const platform = String((body && body.ds_platform) || 'xiaohongshu').trim();
  const category = String((body && body.ds_category) || '知识科普').trim();
  const persona = String((body && body.ds_persona) || 'jiemei').trim();
  const copyStyle = String((body && body.ds_copy_style) || 'ganhuo').trim();
  const sys = buildDeepseekSystemPrompt(platform, category, persona, copyStyle);
  const voice = platformVoice(platform);
  const angleSeed = String((body && body.ds_seed) || Date.now() + '_' + Math.random().toString(36).slice(2, 9));
  const userMsg =
    '围绕主题「' +
    topic +
    '」创作一篇面向「' +
    voice.label +
    '」的爆款笔记框架。本次创作视角编号：「' +
    angleSeed +
    '」，请据此选择不同切入角度，避免与常见模板雷同。\n' +
    '只输出【标题】【正文】【话题标签】三段，不要输出其它说明文字。';

  const messages = [
    { role: 'system', content: sys },
    { role: 'user', content: userMsg },
  ];

  const outgoing = {
    model: 'deepseek-chat',
    messages: messages,
    temperature: 0.85,
    max_tokens: 4096,
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(function () {
    controller.abort();
  }, 90000);
  try {
    const r = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + key,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(outgoing),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    const raw = await r.text();
    let data = null;
    try {
      data = raw ? JSON.parse(raw) : null;
    } catch (e) {
      data = null;
    }
    if (!r.ok) {
      const errMsg =
        (data && data.error && (data.error.message || data.error.msg)) || raw || 'DeepSeek 请求失败';
      return {
        code: -1,
        msg: 'DeepSeek：' + String(errMsg).slice(0, 500),
        httpStatus: 502,
      };
    }
    const content = extractDeepseekChoiceContent(data);
    if (!content) {
      return { code: -1, msg: 'DeepSeek 返回内容为空', httpStatus: 502 };
    }
    return {
      code: 0,
      answer: content,
      meta: { engine: 'deepseek', platform: platform, category: category, persona: persona, copy_style: copyStyle },
    };
  } catch (err) {
    clearTimeout(timeoutId);
    const isAbort = err && (err.name === 'AbortError' || /aborted/i.test(err.message || ''));
    return {
      code: -1,
      msg: isAbort ? 'DeepSeek 请求超时' : 'DeepSeek 调用失败：' + (err.message || String(err)),
      httpStatus: 500,
    };
  }
}

module.exports = {
  loadEnvValue,
  fetchDeepseekCopywrite,
  forwardDeepseekClientChat,
  buildDeepseekSystemPrompt,
};

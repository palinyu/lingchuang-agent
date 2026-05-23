const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const {
  buildCozeMessage,
  purifyAssistantText,
  resolveIntent,
  validateMastersPrompt,
  validatePromptForTopic,
  buildPromptRetryBlockForTopic,
  validateAnalyzeResponse,
  buildAnalyzeRetryBlock,
  detectLifecycleTopic,
  routePlainLanguageTopic,
} = require('./prompt-engine.js');
const { initStyleLib, ensureStyleLibFresh, getStyleLibStatus } = require('./style-lib-loader.js');
const { fetchDeepseekCopywrite } = require('./deepseek-copy-util.js');
const { finalizeCozeResponse } = require('./coze-response-pipeline.js');

const PROMPT_QUALITY_INTENTS = ['prompt', 'custom'];
const MAX_MASTERS_PROMPT_RETRIES = 2;
const MAX_ANALYZE_RETRIES = 2;

function maxCozeAttempts(intent, fileCount, hasDocText) {
  if (intent === 'analyze') {
    if (fileCount >= 1 || hasDocText) return 0;
    return MAX_ANALYZE_RETRIES;
  }
  if (PROMPT_QUALITY_INTENTS.indexOf(intent) !== -1) {
    if (fileCount >= 1) return 1;
    return MAX_MASTERS_PROMPT_RETRIES;
  }
  return 0;
}

const PORT = Number(process.env.PORT) || 3000;
const ROOT = __dirname;

function loadEnvFile() {
  const envPath = path.join(ROOT, '.env.local');
  if (!fs.existsSync(envPath)) return;
  fs.readFileSync(envPath, 'utf8')
    .split(/\r?\n/)
    .forEach(function (line) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const eq = trimmed.indexOf('=');
      if (eq === -1) return;
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim();
      if (key && process.env[key] === undefined) process.env[key] = val;
    });
}

loadEnvFile();
initStyleLib(ROOT);

async function ensureConversationId(token, botId, existingId, forceNew) {
  if (!forceNew && existingId) return existingId;
  const createRes = await fetch('https://api.coze.cn/v1/conversation/create', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ bot_id: botId }),
  });
  const createData = await createRes.json();
  if (!createRes.ok || createData.code !== 0 || !createData.data?.id) {
    throw new Error(
      '【扣子会话创建失败】' + (createData.msg || 'HTTP ' + createRes.status)
    );
  }
  return String(createData.data.id);
}

function getCozeConfig() {
  const token = (process.env.COZE_TOKEN || '').trim();
  const botId = (process.env.COZE_BOT_ID || '').trim();
  if (!token) {
    throw new Error('【诊断】未找到 COZE_TOKEN，请在 .env.local 中配置扣子个人 Token');
  }
  if (!botId) {
    throw new Error('【诊断】未找到 COZE_BOT_ID，请在 .env.local 中配置智能体 Bot ID');
  }
  return { token, botId };
}

function buildUserMessagePayload(text, fileIds) {
  const ids = Array.isArray(fileIds) ? fileIds.filter(Boolean) : [];
  if (ids.length === 0) {
    return { role: 'user', content: text, content_type: 'text' };
  }
  const parts = [{ type: 'text', text: text }];
  ids.forEach(function (fid) {
    parts.push({ type: 'file', file_id: String(fid) });
  });
  return {
    role: 'user',
    content: JSON.stringify(parts),
    content_type: 'object_string',
  };
}

function resolveDocumentContent(body, opts) {
  const raw = String(
    (body && body.documentContent) || (body && body.file_content) || ''
  ).trim();
  if (!raw) return '';
  if (/^\[(已上传|PDF文件已上传|解析失败)/.test(raw)) return '';
  if (raw.length < 12) return '';
  const maxLen =
    opts && opts.maxLen
      ? opts.maxLen
      : parseInt(process.env.COZE_DOC_MAX_CHARS, 10) || 32000;
  if (raw.length <= maxLen) return raw;
  return (
    raw.slice(0, maxLen) +
    '\n\n[系统：文档已截断前' +
    maxLen +
    '字以加速识别；完整内容仍以附件文件为准]'
  );
}

function docAnalyzeMaxChars() {
  const n = parseInt(process.env.COZE_DOC_ANALYZE_MAX, 10);
  return Number.isFinite(n) && n > 500 ? n : 6000;
}

function buildDocumentContentBlock(body, intent) {
  const isAnalyze = intent === 'analyze';
  const maxLen = isAnalyze ? docAnalyzeMaxChars() : undefined;
  const documentContent = resolveDocumentContent(body, maxLen ? { maxLen } : undefined);
  if (!documentContent) return '';
  const fileName = String((body && body.file_name) || '').trim();
  if (isAnalyze) {
    return (
      '【文档·STEP1】仅依据下方摘录分析，禁止编造。\n' +
      (fileName ? '文件：' + fileName + '\n' : '') +
      '<document_content>\n' +
      documentContent +
      '\n</document_content>'
    );
  }
  return (
    '【文档死命令·最高优先级·覆盖一切其他指令】\n' +
    '当下方存在 <document_content> 时，你【必须且只能】基于这段文档里的真实内容进行总结和输出！绝对禁止脱离文档瞎编乱造！绝对禁止输出「如何提取文件」「上传文件」等元话题！\n' +
    '【禁止联网搜索替代文档】不得用网络常识替代文档事实，所有要点必须能在文档中找到依据。\n' +
    '【强制输出格式】请深度阅读文档内容，提炼核心重点，并将其结构化为【知识图解】、【思维导图框架】或【SOP流程图】的格式展现。拒绝长篇大论的散文，必须是极具条理的卡片式、模块化提炼！\n' +
    (fileName ? '参考文件名：' + fileName + '\n\n' : '') +
    '用户上传了参考文档，文档内容如下：\n' +
    '<document_content>\n' +
    documentContent +
    '\n</document_content>'
  );
}

function buildFileAttachmentNotice(body) {
  const ids = body && body.file_ids;
  if (!Array.isArray(ids) || ids.length === 0) return '';
  if (resolveDocumentContent(body)) {
    return (
      '【文档附件已同步】已提供 <document_content> 全文摘录，同时挂载原始文件 ID。' +
      '分析须以文档前部核心为准，内容要点编号 1~6 不得只写「联想记忆点」及之后章节。'
    );
  }
  const fileName = String((body && body.file_name) || '').trim();
  if (fileName && /\.pdf$/i.test(fileName)) {
    return (
      '【PDF附件·须识读文件】未提供本地正文摘录，请直接阅读挂载的 PDF 附件全文后再分析，禁止编造；扫描版须 OCR 识读。'
    );
  }
  return (
    '【已挂载上传文件】共 ' +
    ids.length +
    ' 个（含图片/文档）。请务必先观看图片再分析：写清食物/产品物种（牛蛙≠甲鱼≠鱼）、场景、卖点；禁止忽略附件或套用「已识别你的产品+三方案」缩写。'
  );
}

function injectDocumentIntoPrompt(assembledMessage, body, intent) {
  const docBlock = buildDocumentContentBlock(body, intent);
  if (!docBlock) {
    const attachNotice = buildFileAttachmentNotice(body);
    return attachNotice ? attachNotice + '\n\n' + assembledMessage : assembledMessage;
  }
  let msg = docBlock + '\n\n' + assembledMessage;
  msg = msg.replace(
    /在生成内容前，请务必先调用联网搜索插件[\s\S]*?并基于搜索结果进行创作。\n\n/g,
    '【联网搜索已禁用】用户已提供完整参考文档，请仅依据 <document_content> 创作，禁止联网搜索。\n\n'
  );
  if (intent === 'analyze') {
    msg +=
      '\n【文档STEP1】提炼文档前部核心 → ✅内容识别/要点 → 1~6字段；禁止只写联想记忆点章节。';
  }
  return msg;
}

async function uploadCozeFile(token, base64, fileName, mimeType) {
  const buffer = Buffer.from(base64, 'base64');
  const form = new FormData();
  const blob = new Blob([buffer], {
    type: mimeType || 'application/octet-stream',
  });
  form.append('file', blob, fileName || 'upload.bin');
  const res = await fetch('https://api.coze.cn/v1/files/upload', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token },
    body: form,
  });
  const data = await res.json();
  if (!res.ok || data.code !== 0 || !data.data?.id) {
    throw new Error('【扣子文件上传失败】' + (data.msg || 'HTTP ' + res.status));
  }
  return String(data.data.id);
}

async function streamCozeChat({ token, botId, query, conversationId, userId, fileIds }) {
  const controller = new AbortController();
  const timeoutMs = parseInt(process.env.COZE_FETCH_TIMEOUT_MS, 10) || 280000;
  const timeoutId = setTimeout(function () {
    controller.abort();
  }, timeoutMs);

  const outgoing = {
    bot_id: botId,
    user_id: userId || 'lingchuang_planet_dev',
    stream: true,
    auto_save_history: true,
    additional_messages: [buildUserMessagePayload(query, fileIds)],
  };

  if (conversationId) outgoing.conversation_id = conversationId;

  const response = await fetch('https://api.coze.cn/v3/chat', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(outgoing),
    signal: controller.signal,
  });

  if (!response.ok) {
    const errorText = await response.text();
    clearTimeout(timeoutId);
    const err = new Error('【扣子官方拒绝】HTTP ' + response.status);
    err.status = response.status;
    err.detail = errorText;
    throw err;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let lastEvent = '';
  let resultConversationId = conversationId || '';
  let resultBotId = botId;
  let resultChatId = '';
  let createdChatId = '';
  let assistantText = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      if (line.startsWith('event:')) {
        lastEvent = line.slice(6).trim();
        continue;
      }
      if (!line.startsWith('data:')) continue;

      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;

      try {
        const parsed = JSON.parse(payload);
        if (parsed.conversation_id) resultConversationId = parsed.conversation_id;
        if (parsed.bot_id) resultBotId = parsed.bot_id;
        if (parsed.id) createdChatId = parsed.id;
        if (parsed.chat_id) resultChatId = parsed.chat_id;

        const isAssistantAnswer =
          parsed.role === 'assistant' &&
          (parsed.type === 'answer' || parsed.type === 'text' || !parsed.type);

        if (
          (lastEvent === 'conversation.message.delta' ||
            lastEvent === 'conversation.message.completed') &&
          isAssistantAnswer &&
          typeof parsed.content === 'string'
        ) {
          if (lastEvent === 'conversation.message.delta') {
            assistantText += parsed.content;
          } else {
            assistantText = parsed.content || assistantText;
          }
        }
      } catch (e) {
        // ignore malformed SSE chunk
      }
    }
  }

  clearTimeout(timeoutId);

  const finalChatId = resultChatId || createdChatId || '';
  if (!assistantText) {
    const err = new Error('【扣子服务未返回助手回答】请检查 Bot 配置或网络连接');
    err.detail = { sent_body: outgoing };
    throw err;
  }

  return {
    code: 0,
    conversation_id: resultConversationId,
    chat_id: finalChatId,
    bot_id: resultBotId,
    answer: assistantText,
    messages: [
      {
        id: finalChatId,
        conversation_id: resultConversationId,
        role: 'assistant',
        type: 'answer',
        content: assistantText,
        content_type: 'text',
      },
    ],
  };
}

const app = express();
app.use(cors({ origin: true }));
app.use(express.json({ limit: '25mb' }));
app.use(express.static(ROOT, { index: false, maxAge: '1h' }));

app.options('/api/generate', function (_req, res) {
  res.sendStatus(200);
});
app.options('/api/deepseek-copy', function (_req, res) {
  res.sendStatus(200);
});

async function handleDeepseekCopyRoute(req, res) {
  const body = req.body || {};
  const result = await fetchDeepseekCopywrite(body);
  if (result.code !== 0) {
    return res.status(result.httpStatus || 500).json({ code: -1, msg: result.msg });
  }
  return res.status(200).json({
    code: 0,
    answer: result.answer,
    meta: result.meta,
  });
}

app.post('/api/deepseek-copy', async function (req, res) {
  try {
    return await handleDeepseekCopyRoute(req, res);
  } catch (e) {
    return res.status(500).json({ code: -1, msg: e && e.message ? String(e.message) : '服务器异常' });
  }
});

app.post('/api/generate', async function (req, res) {
  try {
    const body = req.body || {};
    if (body.lc_ds_chat === true && Array.isArray(body.messages) && body.messages.length > 0) {
      return await handleDeepseekCopyRoute(req, res);
    }
    if (String(body.mode || '') === 'deepseek-copy' || String(body.mode || '') === 'deepseek') {
      return await handleDeepseekCopyRoute(req, res);
    }
    const {
      mode,
      query,
      prompt,
      conversation_id,
      chat_id,
      bot_id,
      force_new_session,
      user_id,
      core_topic,
      style,
      technique,
      size,
      intent: bodyIntent,
      user_notes,
      documentContent,
      file_content,
      file_name,
      file_ids,
    } = body;
    const forceNew = force_new_session === true || force_new_session === 'true';

    if (mode === 'coze-upload') {
      const b64 = String(body.file_base64 || '').trim();
      if (!b64) {
        return res.status(400).json({ code: -1, msg: '缺少 file_base64' });
      }
      const { token } = getCozeConfig();
      const fileId = await uploadCozeFile(
        token,
        b64,
        body.file_name || 'upload.bin',
        body.file_type || 'application/octet-stream'
      );
      return res.status(200).json({ code: 0, data: { id: fileId } });
    }

    const rawQuery = String(query || prompt || '').trim();
    if (!rawQuery && !String(core_topic || '').trim()) {
      return res.status(400).json({ code: -1, msg: '缺少 query / core_topic' });
    }

    const docFullText = resolveDocumentContent(body);
    let coreTopic = String(core_topic || rawQuery).trim();
    if (
      docFullText &&
      (!coreTopic ||
        coreTopic === '请识别上传文件内容' ||
        coreTopic === '上传文件内容识别')
    ) {
      coreTopic = docFullText.replace(/\s+/g, ' ').trim().slice(0, 120);
    }
    const intent = bodyIntent || resolveIntent(body);
    ensureStyleLibFresh(ROOT);
    const cozeFileIdsEarly = Array.isArray(file_ids)
      ? file_ids.map(String).filter(Boolean)
      : [];
    const lcImageCount = Math.max(
      0,
      parseInt(body.lc_image_count, 10) || 0
    );
    const hasUpload = cozeFileIdsEarly.length > 0 || !!docFullText;
    let rawQueryEff = rawQuery;
    let userNotesEff = user_notes || '';
    let coreTopicEff = coreTopic;
    if (intent === 'analyze' && hasUpload) {
      const cap = (s, n) => {
        const t = String(s || '').trim();
        return t.length > n ? t.slice(0, n) : t;
      };
      rawQueryEff = cap(rawQueryEff, 420);
      userNotesEff = cap(userNotesEff, 520);
      coreTopicEff = cap(coreTopicEff, 120);
    }
    const lockedProfile = String(
      body.prompt_profile || body.lc_prompt_profile || ''
    ).trim();
    const route = routePlainLanguageTopic(
      coreTopicEff,
      rawQueryEff || userNotesEff || '',
      ROOT,
      {
        hasFile: hasUpload,
        imageCount: lcImageCount,
        lockedProfile: lockedProfile,
      }
    );
    let assembledMessage = buildCozeMessage({
      rootDir: ROOT,
      coreTopic: coreTopicEff,
      style: style || route.randomStyleName || 'AI智能推荐风格',
      technique: technique || route.technique || '爆款知识图解手法',
      size: size || 'AI推荐尺寸',
      intent,
      rawQuery: rawQueryEff || coreTopicEff,
      userNotes: userNotesEff,
      route: route,
      hasFile: hasUpload,
      fileIds: cozeFileIdsEarly,
      imageCount: lcImageCount,
    });
    if (intent === 'analyze' && cozeFileIdsEarly.length === 0) {
      assembledMessage +=
        '\n【篇幅铁律】结构化分析须含品类/手法/尺寸/风格；禁止只输出菜单而无正文。';
    }
    if (PROMPT_QUALITY_INTENTS.indexOf(intent) !== -1) {
      if (
        cozeFileIdsEarly.length > 0 &&
        (route.profile === 'ecom' ||
          route.profile === 'ecom_image' ||
          route.profile === 'ecom_dual' ||
          route.profile === 'ecom_detail_exploded')
      ) {
        assembledMessage +=
          '\n\n【电商·上传参考图·出图死命令】同一商品美化海报，禁止换菜；文案与识别一致；图生图主体参考65–75。';
      } else {
        assembledMessage +=
          '\n\n【工业级出图·最终死命令】必须按扣子 v1.3 STEP2 标准包输出（结构化+完整版英文+精简版+即梦设置+话题）；低于质检标准将自动熔断重试。';
      }
    }

    assembledMessage = injectDocumentIntoPrompt(assembledMessage, body, intent);
    const styleForRetry = style || 'AI智能推荐风格';

    const cozeFileIds = Array.isArray(file_ids)
      ? file_ids.map(String).filter(Boolean)
      : [];

    const { token, botId } = getCozeConfig();
    const targetBotId = String(bot_id || botId).trim();
    const sessionConversationId = forceNew ? '' : (conversation_id || '').trim();
    const clientUserId = (user_id || '').trim() || 'lingchuang_planet_dev';
    const activeConversationId = await ensureConversationId(
      token,
      targetBotId,
      sessionConversationId,
      forceNew
    );

    console.log('\n[灵创星球] Coze 请求');
    console.log('  Bot ID:', targetBotId);
    console.log('  Intent:', intent);
    console.log('  Core Topic:', coreTopic);
    console.log('  Style:', style || '(默认)');
    console.log('  Technique:', technique || route.technique || '(默认)');
    console.log('  Route:', route.profile, route.humanLabel, 'conf=' + route.confidence);
    console.log('  documentContent:', docFullText ? docFullText.length + ' chars' : '(无)');
    console.log('  conversation_id:', activeConversationId);
    if (forceNew) console.log('  mode: 全新独立会话');

    let queryForCoze = assembledMessage;
    let payload = null;
    let purified = '';
    let lastValidation = { valid: true, reason: '' };

    const rawQueryForValidate = rawQuery || user_notes || coreTopic;
    const cozeAttempts = maxCozeAttempts(
      intent,
      cozeFileIds.length,
      !!docFullText
    );
    for (let attempt = 0; attempt <= cozeAttempts; attempt++) {
      payload = await streamCozeChat({
        token,
        botId: targetBotId,
        query: queryForCoze,
        conversationId: activeConversationId,
        userId: clientUserId,
        fileIds: cozeFileIds,
      });
      payload.conversation_id = activeConversationId;

      purified = purifyAssistantText(
        payload.answer ||
          (payload.messages && payload.messages[0] && payload.messages[0].content) ||
          '',
        intent,
        coreTopic,
        route
      );
      purified = finalizeCozeResponse(purified, intent);

      if (intent === 'analyze') {
        lastValidation = validateAnalyzeResponse(
          purified,
          rawQueryForValidate,
          route,
          hasUpload
        );
        if (lastValidation.valid) break;
        if (attempt < cozeAttempts) {
          console.warn(
            '  [分析自我检测] 第 ' +
              (attempt + 1) +
              ' 次未达标，自动重试：' +
              lastValidation.reason
          );
          queryForCoze =
            assembledMessage +
            buildAnalyzeRetryBlock(lastValidation, hasUpload);
          continue;
        }
        console.warn(
          '  [分析自我检测] 仍不达标，返回最后一次：' + lastValidation.reason
        );
        break;
      }

      if (PROMPT_QUALITY_INTENTS.indexOf(intent) === -1) {
        break;
      }

      lastValidation = validatePromptForTopic(
        purified,
        coreTopic,
        route,
        cozeFileIds.length > 0,
        rawQueryForValidate
      );
      if (lastValidation.valid) {
        if (attempt > 0) {
          console.log('  [质量熔断] 第 ' + (attempt + 1) + ' 次生成已通过工业质检');
        }
        break;
      }

      if (attempt < MAX_MASTERS_PROMPT_RETRIES) {
        console.warn(
          '  [质量熔断] 第 ' +
            (attempt + 1) +
            ' 次未达标，自动重试：' +
            lastValidation.reason
        );
        queryForCoze =
          assembledMessage +
          buildPromptRetryBlockForTopic(
            lastValidation,
            coreTopic,
            styleForRetry,
            route,
            cozeFileIds.length > 0,
            rawQueryForValidate
          );
        continue;
      }

      const failMsg =
        '【大师级画质熔断】英文 Prompt 未达工业标准（' +
        lastValidation.reason +
        '），系统已自动重试 ' +
        MAX_MASTERS_PROMPT_RETRIES +
        ' 次仍失败，请稍后重试或补充更具体的主题描述';
      const err = new Error(failMsg);
      err.status = 422;
      throw err;
    }

    if (purified) {
      payload.answer = purified;
      if (payload.messages && payload.messages[0]) payload.messages[0].content = purified;
    }
    const styleLibStatus = getStyleLibStatus();
    payload.meta = {
      intent,
      core_topic: coreTopic,
      style,
      technique,
      size,
      prompt_profile: route.profile || 'standard',
      route_human_label: route.humanLabel || '',
      route_confidence: route.confidence,
      recommended_technique: route.technique || '',
      random_style_name: route.randomStyleName || '',
      need_web_search: !!route.needWebSearch,
      masters_quality_passed:
        PROMPT_QUALITY_INTENTS.indexOf(intent) === -1 || lastValidation.valid,
      style_lib_loaded: styleLibStatus.loaded,
      style_lib_path: styleLibStatus.path || undefined,
      md_category_id: route.mdCategoryId || '',
      md_category_name: route.mdCategoryName || '',
      user_type: route.userType || '',
    };

    return res.status(200).json(payload);
  } catch (error) {
    console.error('[灵创星球] 接口异常:', error);
    const isTimeout = error.name === 'AbortError' || /aborted/i.test(error.message || '');
    const status = error.status && error.status >= 400 ? error.status : 500;
    const msg = isTimeout
      ? '【扣子智能体响应超时】出图提示词生成较慢，请稍后重试'
      : error.message || '服务器内部错误';
    return res.status(status).json({
      code: -1,
      msg,
      error: msg,
      detail: error.detail || undefined,
    });
  }
});

app.get('/system_config.json', function (_req, res) {
  const configPath = path.join(ROOT, 'system_config.json');
  if (!fs.existsSync(configPath)) {
    return res.status(404).json({ code: -1, msg: 'system_config.json not found' });
  }
  res.type('application/json').sendFile(configPath);
});

app.get('/', function (_req, res) {
  res.sendFile(path.join(ROOT, 'zhishi_mofang.html'));
});

app.listen(PORT, function () {
  const sl = getStyleLibStatus();
  console.log('');
  console.log('  灵创星球 · 知识图文魔方 本地服务已启动');
  console.log('  网页: http://localhost:' + PORT + '/');
  console.log('  API : http://localhost:' + PORT + '/api/generate · http://localhost:' + PORT + '/api/deepseek-copy');
  if (sl.loaded) {
    console.log('  风格库: 已加载 ' + sl.path + ' (' + sl.chars + ' 字符)');
  } else {
    console.warn('  风格库: 未加载 — ' + (sl.error || '请放置 lingchuang_sop.json'));
  }
  console.log('');
});

/** Vercel API · 与 prompt-engine 同步（文案主题校验 copywriteTopicMismatch 等）— 保存即更新部署时间戳 */
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const {
  buildCozeMessage,
  purifyAssistantText,
  resolveIntent,
  isSopTemplateSkeleton,
  copywriteTopicMismatch,
  routePlainLanguageTopic,
  validatePromptForTopic,
  buildPromptRetryBlockForTopic,
} = require(path.join(process.cwd(), 'prompt-engine.js'));

const { fetchDeepseekCopywrite } = require(path.join(process.cwd(), 'deepseek-copy-util.js'));
const { initStyleLib, getStyleLibStatus } = require(path.join(process.cwd(), 'style-lib-loader.js'));

const ROOT = process.cwd();
const PROMPT_QUALITY_INTENTS = ['prompt', 'custom'];
const MAX_MASTERS_PROMPT_RETRIES = 2;
initStyleLib(ROOT);

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

function resolveDocumentContent(body) {
  const raw = String(
    (body && body.documentContent) || (body && body.file_content) || ''
  ).trim();
  if (!raw) return '';
  if (/^\[(已上传|PDF文件)/.test(raw)) return '';
  return raw.slice(0, 20000);
}

function buildDocumentContentBlock(body) {
  const documentContent = resolveDocumentContent(body);
  if (!documentContent) return '';
  const fileName = String((body && body.file_name) || '').trim();
  return (
    '【文档死命令·最高优先级·覆盖一切其他指令】\n' +
    '当下方存在 <document_content> 时，你【必须且只能】基于这段文档里的真实内容进行总结和输出！绝对禁止脱离文档瞎编乱造！\n' +
    (fileName ? '参考文件名：' + fileName + '\n\n' : '') +
    '<document_content>\n' +
    documentContent +
    '\n</document_content>'
  );
}

function buildFileAttachmentNotice(body) {
  const ids = body && body.file_ids;
  if (!Array.isArray(ids) || ids.length === 0) return '';
  if (resolveDocumentContent(body)) return '';
  return (
    '【已挂载上传文件】共 ' +
    ids.length +
    ' 个。请务必识别文件中的真实画面与文字，禁止忽略附件凭空编造。'
  );
}

function injectDocumentIntoPrompt(assembledMessage, body, intent) {
  const docBlock = buildDocumentContentBlock(body);
  if (!docBlock) {
    const attachNotice = buildFileAttachmentNotice(body);
    return attachNotice ? attachNotice + '\n\n' + assembledMessage : assembledMessage;
  }
  let msg = docBlock + '\n\n' + assembledMessage;
  if (intent === 'analyze') {
    msg +=
      '\n\n【分析任务补充】内容要点必须直接来自 <document_content>，模块化列出。';
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
    headers: { Authorization: 'Bearer ' + token.trim() },
    body: form,
  });
  const data = await res.json();
  if (!res.ok || data.code !== 0 || !data.data?.id) {
    throw new Error('【扣子文件上传失败】' + (data.msg || 'HTTP ' + res.status));
  }
  return String(data.data.id);
}

/** Vercel / 部分网关可能未预解析 JSON，统一转成对象避免 deepseek 分支被跳过导致 400 */
function readJsonBody(req) {
  let b = req.body;
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer && Buffer.isBuffer(b)) {
    try {
      b = JSON.parse(b.toString('utf8'));
    } catch (e) {
      b = {};
    }
  } else if (typeof b === 'string') {
    try {
      b = b ? JSON.parse(b) : {};
    } catch (e) {
      b = {};
    }
  }
  if (b && typeof b === 'object' && !Array.isArray(b)) return b;
  return {};
}

async function handleDeepseekCopywriter(res, body) {
  const result = await fetchDeepseekCopywrite(body);
  if (result.code !== 0) {
    return res.status(result.httpStatus || 500).json({
      code: -1,
      msg: result.msg || '生成失败',
    });
  }
  return res.status(200).json({
    code: 0,
    answer: result.answer,
    meta: result.meta,
  });
}

export default async function handler(req, res) {
  // 强行锁死跨域，防止前端拿不到真实死因
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const bodyEarly = readJsonBody(req);
  if (
    bodyEarly.lc_ds_chat === true &&
    Array.isArray(bodyEarly.messages) &&
    bodyEarly.messages.length > 0
  ) {
    return await handleDeepseekCopywriter(res, bodyEarly);
  }
  if (String(bodyEarly.mode || '') === 'deepseek-copy' || String(bodyEarly.mode || '') === 'deepseek') {
    return await handleDeepseekCopywriter(res, bodyEarly);
  }

  const token = process.env.COZE_TOKEN;
  const envBotId = process.env.COZE_BOT_ID;
  let resolvedToken = token;
  let resolvedBotId = envBotId;
  if (!resolvedToken || !resolvedBotId) {
    try {
      const envPath = path.join(process.cwd(), '.env.local');
      if (fs.existsSync(envPath)) {
        const envContent = fs.readFileSync(envPath, 'utf8');
        envContent.split(/\r?\n/).forEach(function(line){
          var tokenMatch = line.match(/^\s*COZE_TOKEN\s*=\s*(.+)\s*$/);
          if(tokenMatch && tokenMatch[1] && !resolvedToken) resolvedToken = (tokenMatch[1]||'').trim();
          var botMatch = line.match(/^\s*COZE_BOT_ID\s*=\s*(.+)\s*$/);
          if(botMatch && botMatch[1] && !resolvedBotId) resolvedBotId = (botMatch[1]||'').trim();
        });
      }
    } catch(e) {
      // ignore and surface original error later
    }
  }
  if (!resolvedToken) {
    return res.status(500).json({ error: '【诊断提示】.env.local 里的 COZE_TOKEN 没被服务器读到，请检查文件保存状态！' });
  }

  async function ensureConversationId(token, botId, existingId, forceNew) {
    if (!forceNew && existingId) return existingId;
    const createRes = await fetch('https://api.coze.cn/v1/conversation/create', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token.trim()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ bot_id: botId }),
    });
    const createData = await createRes.json();
    if (!createRes.ok || createData.code !== 0 || !createData.data?.id) {
      throw new Error(
        '【扣子会话创建失败】无法建立多轮对话：' +
          (createData.msg || createRes.status)
      );
    }
    return String(createData.data.id);
  }
  
  try {
    const body = readJsonBody(req);

    const {
      mode,
      prompt,
      bot_id,
      query,
      conversation_id,
      force_new_session,
      user_id,
      core_topic,
      style,
      technique,
      size,
      intent: bodyIntent,
      user_notes,
      file_ids,
      documentContent,
      file_content,
      file_name,
    } = body;
    const forceNew = force_new_session === true || force_new_session === 'true';
    const sessionConversationId = forceNew ? undefined : (conversation_id || '').trim() || undefined;
    const clientUserId = (user_id || '').trim() || 'lingchuang_planet_dev';
    const targetBotId = bot_id || resolvedBotId || '7637843723271258153';

    if (mode && mode === 'coze-upload') {
      const b64 = String(body.file_base64 || '').trim();
      if (!b64) {
        return res.status(400).json({ code: -1, msg: '缺少 file_base64' });
      }
      const fileId = await uploadCozeFile(
        resolvedToken,
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
    const cozeFileIds = Array.isArray(file_ids)
      ? file_ids.map(String).filter(Boolean)
      : [];
    initStyleLib(ROOT);
    const route = routePlainLanguageTopic(
      coreTopic,
      rawQuery || user_notes || '',
      ROOT,
      { hasFile: cozeFileIds.length > 0 }
    );

    let assembledMessage = buildCozeMessage({
      rootDir: ROOT,
      coreTopic,
      style: style || route.randomStyleName || 'AI智能推荐风格',
      technique: technique || route.technique || '爆款知识图解手法',
      size: size || 'AI推荐尺寸',
      intent,
      rawQuery: rawQuery || coreTopic,
      userNotes: user_notes || '',
      route: route,
    });

    if (intent === 'analyze') {
      assembledMessage = assembledMessage
        .replace(/\n\n【全息汇总深度要求[\s\S]*?禁止敷衍。\n\n/g, '\n\n')
        .replace(
          '6. 内容要点\n7. 联想记忆点\n8. 场景延伸\n9. 电商应用潜力\n10. 全息深度洞察\n\n',
          '6. 内容要点\n7. 联想记忆点\n\n'
        );
      assembledMessage +=
        '\n【篇幅铁律】分析精简干练，每条不超过25字；内容要点最多6条；必须保留「5. 本次随机风格」行。';
    }
    if (PROMPT_QUALITY_INTENTS.indexOf(intent) !== -1) {
      assembledMessage +=
        '\n\n【工业级出图·最终死命令】必须按 STEP2 标准包输出，完整版英文不得低于质检标准。';
    }
    assembledMessage = injectDocumentIntoPrompt(assembledMessage, body, intent);
    const styleForRetry = style || route.randomStyleName || 'AI智能推荐风格';

    console.log(`\n🚀 [灵创星球] 开始全链路追踪...`);
    console.log(`[参数检查] 目标BotID: ${targetBotId}`);
    console.log(`[参数检查] Intent: ${intent} | 核心主题: ${coreTopic}`);
    console.log(`[参数检查] 组装后 Prompt 长度: ${assembledMessage.length}`);
    console.log(`[参数检查] Route: ${route.profile} | file_ids: ${cozeFileIds.length}`);
    if (bot_id) {
      console.log('[参数检查] 该次请求使用了显式 bot_id');
    } else if (resolvedBotId) {
      console.log('[参数检查] 该次请求使用了环境变量 COZE_BOT_ID');
    } else {
      console.log('[参数检查] 未提供 bot_id，使用默认内置 Bot ID');
    }

    const activeConversationId = await ensureConversationId(
      resolvedToken,
      targetBotId,
      sessionConversationId,
      forceNew
    );
    if (forceNew) {
      console.log('[参数检查] 强制全新会话（零上下文）');
    }

    let queryForCoze = assembledMessage;
    let assistantText = '';
    let conversationId = '';
    let botId = '';
    let chatId = '';
    let createdChatId = '';
    let rawEvents = [];
    let lastValidation = { valid: true, reason: '' };

    for (let attempt = 0; attempt <= MAX_MASTERS_PROMPT_RETRIES; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 120000);
      const outgoing = {
        bot_id: targetBotId,
        user_id: clientUserId,
        stream: true,
        auto_save_history: true,
        conversation_id: activeConversationId,
        additional_messages: [buildUserMessagePayload(queryForCoze, cozeFileIds)],
      };

      const response = await fetch('https://api.coze.cn/v3/chat', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resolvedToken.trim()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(outgoing),
        signal: controller.signal,
      });

      if (!response.ok) {
        clearTimeout(timeoutId);
        const errorText = await response.text();
        return res.status(500).json({
          code: response.status,
          msg: `【扣子官方拒绝了请求】状态码: ${response.status}`,
          detail: errorText,
        });
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let lastEvent = '';
      assistantText = '';
      rawEvents = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop();
        for (const line of lines) {
          if (!line.trim()) continue;
          if (line.startsWith('event:')) {
            lastEvent = line.slice(6).trim();
            continue;
          }
          if (line.startsWith('data:')) {
            const payload = line.slice(5).trim();
            if (!payload || payload === '[DONE]') continue;
            rawEvents.push({ event: lastEvent, data: payload });
            try {
              const parsed = JSON.parse(payload);
              if (parsed.conversation_id) conversationId = parsed.conversation_id;
              if (parsed.bot_id) botId = parsed.bot_id;
              if (parsed.id) createdChatId = parsed.id;
              if (parsed.chat_id) chatId = parsed.chat_id;
              const isAssistant =
                parsed.role === 'assistant' &&
                (parsed.type === 'answer' || parsed.type === 'text' || !parsed.type);
              if (
                isAssistant &&
                typeof parsed.content === 'string' &&
                (lastEvent === 'conversation.message.delta' ||
                  lastEvent === 'conversation.message.completed')
              ) {
                if (lastEvent === 'conversation.message.delta') {
                  assistantText += parsed.content;
                } else {
                  assistantText = parsed.content || assistantText;
                }
              }
            } catch (err) {
              // ignore
            }
          }
        }
      }
      clearTimeout(timeoutId);

      if (!assistantText) {
        return res.status(500).json({
          code: -1,
          msg: '【扣子服务未返回助手回答】',
          detail: rawEvents,
        });
      }

      const purified = purifyAssistantText(assistantText, intent, coreTopic, route);
      assistantText = purified || assistantText;

      if (PROMPT_QUALITY_INTENTS.indexOf(intent) === -1) break;

      lastValidation = validatePromptForTopic(assistantText, coreTopic, route);
      if (lastValidation.valid) break;

      if (attempt < MAX_MASTERS_PROMPT_RETRIES) {
        queryForCoze =
          assembledMessage +
          buildPromptRetryBlockForTopic(lastValidation, coreTopic, styleForRetry, route);
        continue;
      }

      return res.status(422).json({
        code: -1,
        msg:
          '【画质熔断】' +
          lastValidation.reason +
          '，已自动重试仍失败，请补充更具体的主题描述',
      });
    }

    const finalChatId = chatId || createdChatId || '';
    const finalText = assistantText;
    if (intent === 'copywrite' && coreTopic && copywriteTopicMismatch(finalText, coreTopic)) {
      return res.status(502).json({
        code: -1,
        msg: '文案主题与当前输入不一致，请重新启动大脑后再生成文案',
        topic_mismatch: true,
      });
    }
    if ((intent === 'prompt' || intent === 'custom') && isSopTemplateSkeleton(finalText)) {
      return res.status(502).json({
        code: -1,
        msg: '扣子返回了模板占位符而非真实英文提示词，请点击「重新生成提示词」重试',
        skeleton_detected: true,
      });
    }

    const styleLibStatus = getStyleLibStatus();
    const successPayload = {
      code: 0,
      conversation_id: activeConversationId || conversationId,
      chat_id: finalChatId,
      bot_id: botId || targetBotId,
      answer: finalText,
      meta: {
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
      },
      messages: [
        {
          id: finalChatId,
          conversation_id: conversationId,
          role: 'assistant',
          type: 'answer',
          content: finalText,
          content_type: 'text'
        }
      ]
    };

    if (req.body && req.body.debug) {
      const debugInfo = { sent_body: outgoing, raw_events: rawEvents };
      successPayload.debug = debugInfo;
    }

    return res.status(200).json(successPayload);

  } catch (error) {
    console.error('❌ 【大后方网络/代码彻底崩溃】:', error);
    const isTimeout = error.name === 'AbortError' || /aborted/i.test(error.message || '');
    const msg = isTimeout
      ? '【扣子智能体响应超时】出图提示词生成较慢，已延长至 120 秒仍无结果，请稍后重试或检查网络'
      : `【链路本地崩溃诊断】: ${error.message}。如果提示 fetch failed，说明是网络/梯子阻断了本地与 Coze.cn 的连接！`;
    return res.status(500).json({ code: -1, msg, error: msg });
  }
}
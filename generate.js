import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { buildCozeMessage, purifyAssistantText, resolveIntent, isSopTemplateSkeleton } = require(
  path.join(process.cwd(), 'prompt-engine.js')
);

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
    const body = req.body || {};
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
    } = body;
    const forceNew = force_new_session === true || force_new_session === 'true';
    const sessionConversationId = forceNew ? undefined : (conversation_id || '').trim() || undefined;
    const clientUserId = (user_id || '').trim() || 'lingchuang_planet_dev';
    const targetBotId = bot_id || resolvedBotId || '7637843723271258153';
    if (mode && mode === 'coze-upload') {
      return res.status(400).json({ code: -1, msg: '当前后端尚未支持文件上传模式 coze-upload，请检查上传接口实现。' });
    }

    const rawQuery = String(query || prompt || '').trim();
    if (!rawQuery && !String(core_topic || '').trim()) {
      return res.status(400).json({ code: -1, msg: '缺少 query / core_topic' });
    }

    const coreTopic = String(core_topic || rawQuery).trim();
    const intent = bodyIntent || resolveIntent(body);
    const userPrompt = buildCozeMessage({
      coreTopic,
      style: style || 'AI智能推荐风格',
      technique: technique || '爆款知识图解手法',
      size: size || 'AI推荐尺寸',
      intent,
      rawQuery: rawQuery || coreTopic,
      userNotes: user_notes || '',
    });

    console.log(`\n🚀 [灵创星球] 开始全链路追踪...`);
    console.log(`[参数检查] 目标BotID: ${targetBotId}`);
    console.log(`[参数检查] Intent: ${intent} | 核心主题: ${coreTopic}`);
    console.log(`[参数检查] 组装后 Prompt 长度: ${userPrompt.length}`);
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

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120000);

    const outgoing = {
      bot_id: targetBotId,
      user_id: clientUserId,
      stream: true,
      auto_save_history: true,
      conversation_id: activeConversationId,
      additional_messages: [
        {
          role: 'user',
          content: userPrompt,
          content_type: 'text'
        }
      ]
    };

    const response = await fetch('https://api.coze.cn/v3/chat', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resolvedToken.trim()}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(outgoing),
      signal: controller.signal
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.log(`[扣子响应原始状态码]: ${response.status}`);
      console.log(`[扣子响应原始文本]: ${errorText}`);
      return res.status(500).json({ code: response.status, msg: `【扣子官方拒绝了请求】状态码: ${response.status}`, detail: errorText });
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let lastEvent = '';
    let conversationId = '';
    let botId = '';
    let chatId = '';
    let createdChatId = '';
    let assistantText = '';
    let rawEvents = [];

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
            // ignore malformed payload segments
          }
        }
      }
    }

    clearTimeout(timeoutId);

    if (!assistantText) {
      const debugInfo = { sent_body: outgoing, raw_events: rawEvents };
      return res.status(500).json({ code: -1, msg: '【扣子服务未返回助手回答】', detail: rawEvents, debug: debugInfo });
    }

    const finalChatId = chatId || createdChatId || '';

    const purified = purifyAssistantText(assistantText, intent, coreTopic);
    const finalText = purified || assistantText;
    if ((intent === 'prompt' || intent === 'custom') && isSopTemplateSkeleton(finalText)) {
      return res.status(502).json({
        code: -1,
        msg: '扣子返回了模板占位符而非真实英文提示词，请点击「重新生成提示词」重试',
        skeleton_detected: true,
      });
    }

    const successPayload = {
      code: 0,
      conversation_id: activeConversationId || conversationId,
      chat_id: finalChatId,
      bot_id: botId || targetBotId,
      answer: finalText,
      meta: { intent, core_topic: coreTopic, style, technique, size },
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
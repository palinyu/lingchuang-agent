/**
 * Vercel Serverless · 爆款文案 DeepSeek（自包含，不依赖根目录模块，避免 FUNCTION_INVOCATION_FAILED）
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

async function forwardDeepseekClientChat(body) {
  const key = loadEnvValue('DEEPSEEK_API_KEY');
  if (!key) {
    return {
      code: -1,
      msg: '未配置 DEEPSEEK_API_KEY：请在 Vercel → Settings → Environment Variables 添加后重新部署',
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
        httpStatus: r.status === 401 ? 500 : 502,
      };
    }
    const content = extractDeepseekChoiceContent(data);
    if (!content) {
      return { code: -1, msg: 'DeepSeek 返回内容为空', httpStatus: 502 };
    }
    return {
      code: 0,
      answer: content,
      meta: { engine: 'deepseek', mode: 'lc_ds_chat' },
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

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  try {
    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }
    if (req.method !== 'POST') {
      return res.status(405).json({ code: -1, msg: 'Method Not Allowed' });
    }

    const body = readJsonBody(req);
    if (!body.lc_ds_chat || !Array.isArray(body.messages) || !body.messages.length) {
      return res.status(400).json({
        code: -1,
        msg: '缺少 lc_ds_chat 或 messages，请更新 zhishi_mofang.html 后重试',
      });
    }

    const result = await forwardDeepseekClientChat(body);
    if (!result || typeof result !== 'object') {
      return res.status(500).json({
        code: -1,
        msg: 'DeepSeek 内部返回异常，请确认已部署最新 api/deepseek-copy.js',
      });
    }
    if (result.code !== 0) {
      return res.status(result.httpStatus || 500).json({
        code: -1,
        msg: result.msg || '生成失败',
      });
    }
    return res.status(200).json({
      code: 0,
      answer: result.answer,
      meta: result.meta || {},
    });
  } catch (fatal) {
    console.error('[api/deepseek-copy]', fatal);
    return res.status(500).json({
      code: -1,
      msg:
        '爆款文案接口崩溃：' +
        (fatal && fatal.message ? fatal.message : '请上传 api/deepseek-copy.js 并配置 DEEPSEEK_API_KEY'),
    });
  }
};

/**
 * Vercel Serverless · 仅爆款文案 DeepSeek（避免 /api/generate 被错误反代到 DeepSeek 时缺少 messages）
 */
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { fetchDeepseekCopywrite } = require(path.join(process.cwd(), 'deepseek-copy-util.js'));

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

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const body = readJsonBody(req);
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

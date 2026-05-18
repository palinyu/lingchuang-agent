export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const token = process.env.COZE_TOKEN;
  if (!token) return res.status(500).json({ error: 'COZE_TOKEN未配置，请在Vercel环境变量中设置' });

  try {
    const { query, conversation_id, file_ids } = req.body;

    const payload = {
      bot_id: '7637843723271258153',
      user: 'web_user',
      query: query || '',
      stream: false,
    };

    if (conversation_id) payload.conversation_id = conversation_id;

    // 带文件ID（图片/文档上传后获得）
    if (file_ids && file_ids.length > 0) {
      payload.files = file_ids.map(id => ({ type: 'image', file_id: id }));
    }

    const response = await fetch('https://api.coze.cn/open_api/v2/chat', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Accept': '*/*',
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();
    return res.status(200).json(data);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

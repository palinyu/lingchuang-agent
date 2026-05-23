export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { mode } = req.body;

  // ===== 扣子聊天代理 =====
  if (mode === 'coze') {
    const token = process.env.COZE_TOKEN;
    if (!token) return res.status(500).json({ error: 'COZE_TOKEN未配置' });
    try {
      const { query, conversation_id, file_ids } = req.body;
      const payload = {
        bot_id: '7637843723271258153',
        user: 'web_user',
        query: query || '',
        stream: false,
      };
      if (conversation_id) payload.conversation_id = conversation_id;
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

  // ===== 扣子文件上传代理 =====
  if (mode === 'coze-upload') {
    const token = process.env.COZE_TOKEN;
    if (!token) return res.status(500).json({ error: 'COZE_TOKEN未配置' });
    try {
      const { file_base64, file_name, file_type } = req.body;
      const buffer = Buffer.from(file_base64, 'base64');
      const formData = new FormData();
      const blob = new Blob([buffer], { type: file_type });
      formData.append('file', blob, file_name);
      const response = await fetch('https://api.coze.cn/v1/files/upload', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData,
      });
      const data = await response.json();
      return res.status(200).json(data);
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // ===== 原有DeepSeek代理 =====
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API Key未配置' });
  try {
    const { messages, system } = req.body;
    const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: system ? [{ role: 'system', content: system }, ...messages] : messages,
        max_tokens: 2000,
        temperature: 0.7
      })
    });
    const data = await response.json();
    if (!response.ok) return res.status(response.status).json({ error: data.error?.message || '请求失败' });
    return res.status(200).json({
      content: [{ type: 'text', text: data.choices[0].message.content }]
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const token = process.env.COZE_TOKEN;
  if (!token) return res.status(500).json({ error: 'COZE_TOKEN未配置' });

  try {
    const { file_base64, file_name, file_type } = req.body;

    // base64转Buffer
    const buffer = Buffer.from(file_base64, 'base64');

    // 构建FormData上传到扣子文件服务
    const formData = new FormData();
    const blob = new Blob([buffer], { type: file_type });
    formData.append('file', blob, file_name);

    const response = await fetch('https://api.coze.cn/v1/files/upload', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
      body: formData,
    });

    const data = await response.json();
    // 返回file_id供后续chat使用
    return res.status(200).json(data);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

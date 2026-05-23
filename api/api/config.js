export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  try {
    const cosUrl = 'https://vip-1426371499.cos.ap-guangzhou.myqcloud.com/system/config.json';
    const response = await fetch(cosUrl);
    const config = await response.json();
    return res.status(200).json(config);
  } catch (e) {
    return res.status(500).json({ error: '配置读取失败' });
  }
}

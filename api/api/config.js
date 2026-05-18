export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  const config = {
    free_times: 5,
    cards: {
      次卡: { password: "LC次卡2026", times: 50, price: "9.9", label: "50次体验卡" },
      月卡: { password: "LC月卡2026", days: 30, price: "19.9", label: "30天无限卡" },
      永久卡: { password: "LC永久2026", price: "49.9", label: "永久畅享卡" }
    }
  };
  
  return res.status(200).json(config);
}

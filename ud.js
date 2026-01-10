const { chromium } = require('playwright');
const axios = require('axios');

// 配置信息：从环境变量读取
const token = process.env.CF_API_TOKEN;
const zoneId = process.env.CF_ZONE_ID;
const keyword = process.env.ISP;           // 例如：移动
const record_name = process.env.RECORD_NAME; // 例如：cm.yourdomain.com
const target_url = process.env.TARGET_URL;

async function updateDNS() {
  // 检查关键环境变量是否存在
  if (!token || !zoneId || !keyword || !record_name || !target_url) {
    console.error('错误: 缺少必要的环境变量配置！');
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();

  try {
    console.log(`正在访问目标网页: ${target_url}`);
    // 增加超时设置，防止页面卡死
    await page.goto(target_url, { waitUntil: 'networkidle', timeout: 60000 });

    // 等待表格加载完成
    await page.waitForSelector('tr', { timeout: 30000 });

    // 提取 IP 地址
    const extractedIp = await page.evaluate((kw) => {
      const rows = Array.from(document.querySelectorAll('tr'));
      // 这里的 kw 对应环境变量中的 ISP
      const targetRow = rows.find(row => row.innerText.includes(kw));
      if (targetRow) {
        const ipMatch = targetRow.innerText.match(/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/);
        return ipMatch ? ipMatch[0] : null;
      }
      return null;
    }, keyword);

    if (!extractedIp) {
      console.error(`未能提取到与关键词 "${keyword}" 相关的 IP 地址。`);
      await browser.close();
      process.exit(1);
    }

    console.log(`成功提取到最新 IP: ${extractedIp}`);

    // --- Cloudflare API 操作 ---
    
    // 1. 获取 Record ID
    const { data: dnsData } = await axios.get(
      `https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records?name=${record_name}`,
      { headers: { 'Authorization': `Bearer ${token}` } }
    );

    if (!dnsData.success || dnsData.result.length === 0) {
      throw new Error(`Cloudflare 上未找到域名 ${record_name} 的记录，请确认已手动创建。`);
    }

    const record = dnsData.result[0];

    // 2. 比对并更新
    if (record.content === extractedIp) {
      console.log(`当前解析已经是 ${extractedIp}，无需更新。`);
    } else {
      const updateRes = await axios.put(
        `https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records/${record.id}`,
        {
          type: 'A',
          name: record_name,
          content: extractedIp,
          ttl: 60,
          proxied: false
        },
        { headers: { 'Authorization': `Bearer ${token}` } }
      );

      if (updateRes.data.success) {
        console.log(`✅ 更新成功: ${record_name} -> ${extractedIp}`);
      } else {
        throw new Error('Cloudflare 响应更新失败');
      }
    }

  } catch (error) {
    console.error('❌ 执行过程中出现错误:', error.message);
    process.exit(1);
  } finally {
    await browser.close();
  }
}

updateDNS();

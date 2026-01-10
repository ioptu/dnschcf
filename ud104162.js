//只抓取104、162开头的IP
const { chromium } = require('playwright');
const axios = require('axios');

// 配置信息：从环境变量读取
const token = process.env.CF_API_TOKEN;
const zoneId = process.env.CF_ZONE_ID;
const keyword = process.env.ISP;           // 例如：联通
const record_name = process.env.RECORD_NAME; // 例如：cu.yourdomain.com
const target_url = process.env.TARGET_URL;

async function updateDNS() {
  if (!token || !zoneId || !keyword || !record_name || !target_url) {
    console.error('错误: 缺少必要的环境变量配置！');
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();

  try {
    console.log(`正在访问目标网页: ${target_url}`);
    await page.goto(target_url, { waitUntil: 'networkidle', timeout: 60000 });

    // 等待表格加载
    await page.waitForSelector('tr', { timeout: 30000 });

    // 提取符合条件的 IP
    const extractedIp = await page.evaluate((kw) => {
      const rows = Array.from(document.querySelectorAll('tr'));
      // 1. 先找到包含关键词（如“联通”）的所有行
      const targetRows = rows.filter(row => row.innerText.includes(kw));
      
      for (let row of targetRows) {
        // 2. 匹配该行中的所有 IPv4 地址
        const ipMatches = row.innerText.match(/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/g);
        if (ipMatches) {
          for (let ip of ipMatches) {
            // 3. 核心过滤逻辑：只接受 104. 或 162. 开头的 IP
            if (ip.startsWith('104.') || ip.startsWith('162.')) {
              return ip; // 找到第一个符合条件的就返回
            }
          }
        }
      }
      return null; // 如果该关键词下没有符合条件的 IP，返回 null
    }, keyword);

    if (!extractedIp) {
      console.log(`⚠️ 未能在 "${keyword}" 线路下找到以 104 或 162 开头的有效 IP。跳过本次更新。`);
      await browser.close();
      return; // 结束执行，不修改 DNS
    }

    console.log(`✅ 匹配到符合条件的 IP: ${extractedIp}`);

    // --- Cloudflare API 操作 ---
    
    const { data: dnsData } = await axios.get(
      `https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records?name=${record_name}`,
      { headers: { 'Authorization': `Bearer ${token}` } }
    );

    if (!dnsData.success || dnsData.result.length === 0) {
      throw new Error(`未找到域名 ${record_name} 的记录。`);
    }

    const record = dnsData.result[0];

    if (record.content === extractedIp) {
      console.log(`ℹ️ DNS 记录已是最新 (${extractedIp})，无需操作。`);
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
        console.log(`🚀 更新成功: ${record_name} -> ${extractedIp}`);
      }
    }

  } catch (error) {
    console.error('❌ 执行错误:', error.message);
    process.exit(1);
  } finally {
    await browser.close();
  }
}

updateDNS();

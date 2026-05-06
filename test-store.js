// test-store.js - 测试 Chrome Web Store 爬取
import axios from 'axios';
import * as cheerio from 'cheerio';

async function testChromeStore() {
  console.log('测试 Chrome Web Store 爬取...\n');

  const http = axios.create({
    timeout: 30000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1'
    }
  });

  // 测试1: 直接访问搜索页面
  console.log('1. 测试搜索页面...');
  try {
    const response = await http.get('https://chromewebstore.google.com/search/instagram+video+extension');
    const $ = cheerio.load(response.data);

    console.log(`   状态: ${response.status}`);
    console.log(`   HTML 长度: ${response.data.length}`);

    // 尝试找到插件列表
    const title = $('title').text();
    console.log(`   标题: ${title}`);

    // 查找所有链接
    const links = $('a[href*="/detail/"]');
    console.log(`   插件链接数量: ${links.length}`);

    // 打印前5个
    links.slice(0, 5).each((i, el) => {
      const href = $(el).attr('href');
      const text = $(el).text().trim();
      console.log(`   [${i+1}] ${text} -> ${href}`);
    });

    // 尝试 JSON 数据
    const scriptTags = $('script[type="application/ld+json"]');
    console.log(`   JSON-LD 标签数量: ${scriptTags.length}`);

    // 尝试 __AUE_DATA__ 或类似的数据
    const bodyText = $('body').text();
    const dataMatch = bodyText.match(/("itemListElement":\s*\[)/);
    console.log(`   列表数据: ${dataMatch ? '找到' : '未找到'}`);

  } catch (err) {
    console.log(`   错误: ${err.message}`);
  }

  // 测试2: 尝试官方 API
  console.log('\n2. 测试 Chrome Web Store API...');
  try {
    // 尝试店铺搜索 API
    const apiUrl = 'https://chromewebstore.google.com/_/WebStoreChromeApi/DataSearchRequest?source=1&hl=en&gl=US&mce=api';
    const response = await http.post(apiUrl, {
      "action":"search",
      "searchParams":[
        {"type":2,"value":"instagram"}
      ],
      "numLines":10
    });
    console.log(`   API 状态: ${response.status}`);
    console.log(`   数据长度: ${JSON.stringify(response.data).length}`);
  } catch (err) {
    console.log(`   API 错误: ${err.message}`);
  }

  // 测试3: 尝试直接搜索 URL
  console.log('\n3. 测试直接搜索...');
  try {
    const response = await http.get('https://chromewebstore.google.com/search?q=instagram+video&hl=en');
    console.log(`   状态: ${response.status}`);

    // 保存 HTML 样本
    const $ = cheerio.load(response.data);
    console.log(`   页面标题: ${$('title').text()}`);

    // 检查是否有反爬
    const hasCaptcha = response.data.includes('captcha') || response.data.includes('CAPTCHA');
    console.log(`   验证码检测: ${hasCaptcha ? '可能需要验证码' : '正常'}`);

  } catch (err) {
    console.log(`   错误: ${err.message}`);
  }
}

testChromeStore();

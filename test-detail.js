// test-detail.js - 测试详情页解析
import axios from 'axios';
import * as cheerio from 'cheerio';

async function testDetail() {
  console.log('测试 Chrome Web Store 详情页...\n');

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://chromewebstore.google.com/'
  };

  // 测试一个真实的插件详情页
  const testUrls = [
    'https://chromewebstore.google.com/detail/controls-for-instagram-vi/eigfbedabacomcacemdnkelnlhgbiacn',
    'https://chromewebstore.google.com/detail/turbo-downloader-for-inst/cpgaheeihidjmolbakklolchdplenjai'
  ];

  for (const url of testUrls) {
    console.log(`\n测试: ${url}`);

    try {
      const response = await axios.get(url, { headers, timeout: 30000 });
      const $ = cheerio.load(response.data);
      const bodyText = $('body').text();

      console.log(`HTML 长度: ${response.data.length}`);

      // 打印部分 HTML 结构
      const mainContent = $('main').html()?.substring(0, 2000) || '无 main 标签';
      console.log(`\nMain 内容预览:\n${mainContent.substring(0, 500)}...`);

      // 尝试多种选择器
      console.log('\n尝试提取数据:');

      // 1. 名称
      const name1 = $('h1').first().text().trim();
      const name2 = $('[class*="title"]').first().text().trim();
      const name3 = $('title').text().split('-')[0].trim();
      console.log(`  名称: h1="${name1}", title-class="${name2}", title="${name3}"`);

      // 2. 安装量 - 尝试各种模式
      console.log(`\n  查找安装量...`);

      // 搜索 body 中的安装量模式
      const installPatterns = [
        /([\d,]+(?:\.\d+)?)\s*(?:million|M)\s*(?:users?|install)/i,
        /([\d,]+)\s*(?:users?|install|download)/i,
        /(\d+)\s*(?:user|users)/i
      ];

      for (const pattern of installPatterns) {
        const match = bodyText.match(pattern);
        if (match) {
          console.log(`    匹配 "${pattern}": ${match[0]}`);
          break;
        }
      }

      // 查找包含 "users" 的文本片段
      const usersMatch = bodyText.match(/.{50}(?:users?|install|download).{50}/i);
      if (usersMatch) {
        console.log(`    上下文: "...${usersMatch[0]}..."`);
      }

      // 3. 更新日期
      const updatedPatterns = [
        /Updated[:\s]+([A-Za-z]+\s+\d+,?\s+\d{4})/i,
        /(\d{4}-\d{2}-\d{2})/,
        /(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d+,?\s+\d{4}/i
      ];

      for (const pattern of updatedPatterns) {
        const match = bodyText.match(pattern);
        if (match) {
          console.log(`    更新日期: ${match[0]}`);
          break;
        }
      }

      // 4. 版本
      const versionMatch = bodyText.match(/Version[:\s]+([^\s\n]+)/i);
      if (versionMatch) {
        console.log(`    版本: ${versionMatch[1]}`);
      }

    } catch (err) {
      console.log(`  错误: ${err.message}`);
    }
  }
}

testDetail();

// test-selector.js - 测试选择器
import axios from 'axios';
import * as cheerio from 'cheerio';

async function testSelector() {
  console.log('测试 Chrome Store 选择器...\n');

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9'
  };

  const url = 'https://chromewebstore.google.com/search/instagram+video';

  try {
    const response = await axios.get(url, { headers, timeout: 30000 });
    const $ = cheerio.load(response.data);

    console.log(`状态: ${response.status}`);
    console.log(`HTML 长度: ${response.data.length}`);

    // 尝试不同的选择器
    console.log('\n尝试选择器:');

    // 1. a[href*="/detail/"]
    const links1 = $('a[href*="/detail/"]');
    console.log(`1. a[href*="/detail/"]: ${links1.length}`);

    // 2. a[href*="detail"]
    const links2 = $('a[href*="detail"]');
    console.log(`2. a[href*="detail"]: ${links2.length}`);

    // 3. 任何包含 detail 的链接
    const allLinks = $('a');
    let detailCount = 0;
    allLinks.each((i, el) => {
      const href = $(el).attr('href') || '';
      if (href.includes('detail')) {
        detailCount++;
        if (detailCount <= 5) {
          console.log(`   [${detailCount}] href="${href}", text="${$(el).text().trim().substring(0, 50)}"`);
        }
      }
    });
    console.log(`3. 所有包含 "detail" 的链接: ${detailCount}`);

    // 打印前几个链接看看格式
    console.log('\n打印所有链接前10个:');
    allLinks.slice(0, 20).each((i, el) => {
      const href = $(el).attr('href') || '';
      const text = $(el).text().trim().substring(0, 30);
      console.log(`[${i}] href="${href.substring(0, 80)}" text="${text}"`);
    });

  } catch (err) {
    console.log(`错误: ${err.message}`);
  }
}

testSelector();

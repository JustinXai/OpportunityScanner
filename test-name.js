// test-name.js - 查找插件名称位置
import axios from 'axios';
import * as cheerio from 'cheerio';

async function testName() {
  console.log('查找插件名称位置...\n');

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9'
  };

  const url = 'https://chromewebstore.google.com/search/instagram+video';

  try {
    const response = await axios.get(url, { headers, timeout: 30000 });
    const $ = cheerio.load(response.data);

    // 找到所有包含 detail 的链接
    const detailLinks = $('a[href*="/detail/"]');

    console.log(`找到 ${detailLinks.length} 个插件链接\n`);

    // 对每个链接，查找附近的文本
    detailLinks.each((i, el) => {
      const href = $(el).attr('href');
      const parent = $(el).parent();
      const grandparent = parent.parent();

      // 尝试从父元素获取名称
      let name = '';

      // 1. 从链接文本
      name = $(el).text().trim();

      // 2. 从父元素的标题
      if (!name) {
        name = parent.find('h2, h3, .title, [class*="title"]').first().text().trim();
      }

      // 3. 从祖父元素的标题
      if (!name) {
        name = grandparent.find('h2, h3, .title, [class*="title"]').first().text().trim();
      }

      // 4. 从最近的兄弟元素
      if (!name) {
        const siblings = $(el).siblings();
        siblings.each((j, sib) => {
          const sibText = $(sib).text().trim();
          if (sibText && sibText.length < 100) {
            name = sibText;
            return false;
          }
        });
      }

      // 5. 从链接周围的文本
      if (!name) {
        const surrounding = $(el).closest('[class*="card"], [class*="item"], [class*="result"]').text();
        if (surrounding) {
          // 提取第一个短文本
          const match = surrounding.match(/^([A-Za-z][A-Za-z0-9\s:&\-']{5,50})/);
          if (match) name = match[1].trim();
        }
      }

      console.log(`[${i+1}] ${name || '(无名称)'} -> ${href}`);
    });

    // 打印一个链接的完整上下文
    console.log('\n\n--- 一个链接的完整 HTML 结构 ---');
    const firstLink = detailLinks.first();
    const context = firstLink.parent().html() || '';
    console.log(context.substring(0, 2000));

  } catch (err) {
    console.log(`错误: ${err.message}`);
  }
}

testName();

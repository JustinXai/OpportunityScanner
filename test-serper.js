// test-serper.js - 测试 Serper API
import axios from 'axios';

const apiKey = '4702a14c9f6bef49a8a786fc1b823edd08212c97';

async function testSerper() {
  console.log('测试 Serper API...\n');

  // 测试不同的搜索关键词
  const keywords = [
    'chrome extension "not working" 2024',
    'abandoned chrome extension popular 100000 users',
    'chrome extension "stopped working" broken',
    'instagram chrome extension abandoned',
    'chrome extension last updated 2023'
  ];

  for (const keyword of keywords) {
    try {
      console.log(`\n搜索: "${keyword}"`);

      const response = await axios.post(
        'https://google.serper.dev/search',
        { q: keyword, num: 10 },
        {
          headers: {
            'X-API-KEY': apiKey,
            'Content-Type': 'application/json'
          },
          timeout: 30000
        }
      );

      console.log(`  状态: ${response.status}`);
      console.log(`  结果数量: ${response.data?.organic?.length || 0}`);

      if (response.data?.organic?.length > 0) {
        const results = response.data.organic.slice(0, 3);
        for (const r of results) {
          console.log(`  - ${r.title?.substring(0, 60)}`);
          console.log(`    ${r.url}`);
        }
      }

      if (response.data?.searchParameters) {
        console.log(`  搜索参数:`, response.data.searchParameters);
      }

      // 延迟
      await new Promise(r => setTimeout(r, 2000));
    } catch (err) {
      console.log(`  错误: ${err.message}`);
      if (err.response) {
        console.log(`  状态码: ${err.response.status}`);
        console.log(`  数据:`, err.response.data);
      }
    }
  }
}

testSerper();

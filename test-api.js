// test-api.js - 测试 Tinyfish API
import axios from 'axios';

const apiKey = 'sk-tinyfish-YZTgjALfyXLsnMx3YJp_zAZhJwDPOA59';

async function testApi() {
  console.log('测试 Tinyfish API...\n');

  // 测试 1: 不带 API Key
  try {
    console.log('1. 测试不带 API Key...');
    const res1 = await axios.post(
      'https://agent.tinyfish.ai/v1/automation/run-sse',
      { url: 'https://example.com', goal: 'Return OK' },
      { timeout: 10000 }
    );
    console.log('结果:', res1.status, res1.data);
  } catch (e) {
    console.log('错误:', e.response?.status, e.response?.data?.error?.code);
  }

  // 测试 2: 带 API Key
  try {
    console.log('\n2. 测试带 X-API-Key...');
    const res2 = await axios.post(
      'https://agent.tinyfish.ai/v1/automation/run-sse',
      { url: 'https://example.com', goal: 'Return OK' },
      {
        timeout: 10000,
        headers: { 'X-API-Key': apiKey, 'Content-Type': 'application/json' }
      }
    );
    console.log('结果:', res2.status, res2.data);
  } catch (e) {
    console.log('错误:', e.response?.status, e.response?.data?.error?.code, e.response?.data?.error?.message);
  }

  // 测试 3: 带 Bearer 认证（对比）
  try {
    console.log('\n3. 测试带 Bearer 认证...');
    const res3 = await axios.post(
      'https://agent.tinyfish.ai/v1/automation/run-sse',
      { url: 'https://example.com', goal: 'Return OK' },
      {
        timeout: 10000,
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' }
      }
    );
    console.log('结果:', res3.status, res3.data);
  } catch (e) {
    console.log('错误:', e.response?.status, e.response?.data?.error?.code, e.response?.data?.error?.message);
  }
}

testApi();

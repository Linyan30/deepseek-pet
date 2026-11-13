'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  searchWeb,
  buildSearchContext,
  normalizeResults,
  parseDuckDuckGo,
  parseTavily,
  parseSearxng,
  parseBing
} = require('../src/main/search');

const BING_HTML = `<!DOCTYPE html><html><body><ol id="b_results">
  <li class="b_algo" data-id iid=SERP.1>
    <h2><a target="_blank" href="https://www.deepseek.com/news/v4">DeepSeek &amp; 新模型 &lt;V4&gt;</a></h2>
    <p class="b_lineclamp2">2026年10月29日&ensp;DeepSeek 发布新版本，支持多模态。</p>
  </li>
  <li class="b_algo">
    <h2><a href="https://example.com/b?x=1&amp;y=2">第二条 <strong>结果</strong></a></h2>
    <p>摘要二</p>
  </li>
  <li class="b_algo"><h2>没有链接的块</h2></li>
</ol></body></html>`;

test('必应：解析网页结果、实体与摘要', () => {
  const results = parseBing(BING_HTML, 5);
  assert.equal(results.length, 2);
  assert.equal(results[0].title, 'DeepSeek & 新模型 <V4>');
  assert.equal(results[0].url, 'https://www.deepseek.com/news/v4');
  assert.match(results[0].snippet, /支持多模态/);
  assert.equal(results[1].url, 'https://example.com/b?x=1&y=2');
});

test('自动模式：必应可用时优先用必应', async () => {
  const result = await searchWeb({
    settings: { searchProvider: 'auto' },
    query: 'DeepSeek',
    request: async (url) => {
      assert.match(url, /cn\.bing\.com/);
      return { status: 200, body: BING_HTML };
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.provider, 'bing');
  assert.equal(result.results.length, 2);
});

test('DuckDuckGo 连不上时自动回退到必应', async () => {
  const result = await searchWeb({
    settings: { searchProvider: 'duckduckgo' },
    query: '今天的新闻',
    request: async (url) => {
      if (url.includes('duckduckgo')) {
        const error = new Error('getaddrinfo ENOTFOUND api.duckduckgo.com');
        error.code = 'ENOTFOUND';
        throw error;
      }
      return { status: 200, body: BING_HTML };
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.provider, 'bing');
  assert.ok(result.results.length > 0);
});

test('Tavily 没有 Key 时给出提示，不回退到别的服务', async () => {
  let called = false;
  const result = await searchWeb({
    settings: { searchProvider: 'tavily', tavilyApiKey: '' },
    query: '测试',
    request: async () => {
      called = true;
      return { status: 200, body: {} };
    }
  });

  assert.equal(result.ok, false);
  assert.equal(called, false);
  assert.match(result.error, /Key/);
});

test('Tavily：POST 请求体正确，结果会被裁剪', async () => {
  let captured = null;
  const result = await searchWeb({
    settings: { searchProvider: 'tavily', tavilyApiKey: 'tvly-test', searchResults: 4 },
    query: 'DeepSeek 最新模型',
    request: async (url, options) => {
      captured = { url, options };
      return {
        status: 200,
        body: {
          answer: '这是摘要',
          results: [
            { title: 'A', url: 'https://a.example.com/1', content: '第一段' },
            { title: 'B', url: 'https://b.example.com/2', content: '第二段' },
            { title: '重复', url: 'https://a.example.com/1', content: '重复链接应被去掉' }
          ]
        }
      };
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.provider, 'tavily');
  assert.equal(result.results.length, 2);
  assert.equal(result.answer, '这是摘要');
  assert.equal(captured.options.method, 'POST');
  assert.equal(captured.options.body.api_key, 'tvly-test');
  assert.equal(captured.options.body.query, 'DeepSeek 最新模型');
  assert.equal(captured.options.body.max_results, 4);
});

test('Tavily：没有 Key 时直接给出提示，不发请求', async () => {
  let called = false;
  const result = await searchWeb({
    settings: { searchProvider: 'tavily', tavilyApiKey: '' },
    query: '测试',
    request: async () => {
      called = true;
      return { status: 200, body: {} };
    }
  });

  assert.equal(result.ok, false);
  assert.equal(called, false);
  assert.match(result.error, /Key/);
});

test('SearXNG：GET 会拼上 format=json 与语言参数', async () => {
  let capturedUrl = '';
  const result = await searchWeb({
    settings: {
      searchProvider: 'searxng',
      searxngUrl: 'https://searx.example.com/',
      searchResults: 3
    },
    query: '桌面宠物',
    request: async (url) => {
      capturedUrl = url;
      return {
        status: 200,
        body: { results: [{ title: '结果', url: 'https://r.example.com', content: '摘要' }] }
      };
    }
  });

  assert.equal(result.ok, true);
  assert.match(capturedUrl, /^https:\/\/searx\.example\.com\/search\?/);
  assert.match(capturedUrl, /format=json/);
  assert.match(capturedUrl, /language=zh-CN/);
  assert.equal(result.results.length, 1);
});

test('SearXNG：地址不合法时给出提示', async () => {
  const result = await searchWeb({
    settings: { searchProvider: 'searxng', searxngUrl: 'ftp://bad' },
    query: '测试',
    request: async () => ({ status: 200, body: {} })
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /SearXNG/);
});

test('DuckDuckGo：免费兜底能解析摘要与相关话题', async () => {
  const result = await searchWeb({
    settings: { searchProvider: 'duckduckgo' },
    query: '什么是鲸鱼',
    request: async () => ({
      status: 200,
      body: {
        Heading: '鲸',
        AbstractText: '鲸是海洋哺乳动物。',
        AbstractURL: 'https://zh.wikipedia.org/wiki/鲸',
        RelatedTopics: [
          { Text: '鲸目', FirstURL: 'https://zh.wikipedia.org/wiki/鲸目' },
          { Topics: [{ Text: '海豚', FirstURL: 'https://zh.wikipedia.org/wiki/海豚' }] }
        ]
      }
    })
  });

  assert.equal(result.ok, true);
  assert.equal(result.provider, 'duckduckgo');
  assert.equal(result.answer, '鲸是海洋哺乳动物。');
  assert.ok(result.results.length >= 3);
  assert.ok(result.results.every((item) => item.url.startsWith('https://')));
});

test('网络错误会翻译成中文提示', async () => {
  const result = await searchWeb({
    settings: { searchProvider: 'duckduckgo' },
    query: '测试',
    request: async () => {
      const error = new Error('getaddrinfo ENOTFOUND api.duckduckgo.com');
      error.code = 'ENOTFOUND';
      throw error;
    }
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /网络|连不上/);
});

test('normalizeResults 会过滤非 http 链接并限制条数', () => {
  const results = normalizeResults(
    [
      { title: 'a', url: 'https://a.com' },
      { title: 'b', url: 'javascript:alert(1)' },
      { title: 'c', url: 'http://c.com' },
      { title: 'd', url: 'https://d.com' }
    ],
    2
  );
  assert.equal(results.length, 2);
  assert.equal(results[0].url, 'https://a.com');
  assert.equal(results[1].url, 'http://c.com');
});

test('解析函数能容忍空数据', () => {
  assert.deepEqual(parseTavily(null), { answer: '', results: [] });
  assert.deepEqual(parseSearxng(undefined).results, []);
  assert.deepEqual(parseDuckDuckGo(null).results, []);
});

test('buildSearchContext 会带上序号、标题、摘要和链接', () => {
  const context = buildSearchContext({
    results: [
      { title: '标题一', url: 'https://one.com', snippet: '摘要一' },
      { title: '标题二', url: 'https://two.com', snippet: '摘要二' }
    ]
  });
  assert.match(context, /\[1\] 标题一/);
  assert.match(context, /https:\/\/one\.com/);
  assert.match(context, /\[2\] 标题二/);
  assert.equal(buildSearchContext({ results: [] }), '');
});

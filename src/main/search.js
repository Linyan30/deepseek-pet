'use strict';

const { requestJSON } = require('./http');

const PROVIDERS = ['auto', 'bing', 'tavily', 'searxng', 'duckduckgo'];

const PROVIDER_LABELS = {
  auto: '自动选择',
  bing: '必应',
  tavily: 'Tavily',
  searxng: 'SearXNG',
  duckduckgo: 'DuckDuckGo（免费）'
};

const BING_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  Accept: 'text/html,application/xhtml+xml'
};

function trimText(value, max) {
  const text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function decodeEntities(text) {
  const named = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
    ensp: ' ',
    emsp: ' ',
    hellip: '…',
    mdash: '—',
    ndash: '–',
    ldquo: '“',
    rdquo: '”',
    lsquo: '‘',
    rsquo: '’',
    middot: '·',
    copy: '©',
    reg: '®',
    trade: '™'
  };
  return String(text == null ? '' : text)
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match, num) => String.fromCodePoint(Number(num)))
    .replace(/&([a-z]+);/gi, (match, name) => (named[name.toLowerCase()] != null ? named[name.toLowerCase()] : match));
}

function stripTags(html) {
  return decodeEntities(String(html || '').replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeResults(items, limit) {
  const results = [];
  const seen = new Set();
  (Array.isArray(items) ? items : []).forEach((item) => {
    if (!item) return;
    const url = String(item.url || item.link || item.FirstURL || '').trim();
    if (!/^https?:\/\//i.test(url) || seen.has(url)) return;
    seen.add(url);
    results.push({
      title: trimText(item.title || item.Text || url, 120),
      url,
      snippet: trimText(item.snippet || item.content || item.Text || '', 240)
    });
  });
  return results.slice(0, limit);
}

function flattenDuckDuckGoTopics(topics, output) {
  if (!Array.isArray(topics)) return output;
  topics.forEach((topic) => {
    if (!topic) return;
    if (Array.isArray(topic.Topics)) flattenDuckDuckGoTopics(topic.Topics, output);
    else output.push(topic);
  });
  return output;
}

/** DuckDuckGo Instant Answer：不需要 Key，适合概念/百科类问题。 */
function parseDuckDuckGo(body) {
  if (!body || typeof body !== 'object') return { answer: '', results: [] };
  const answer = trimText(body.AbstractText || body.Answer || body.Definition || '', 500);
  const items = [];
  if (body.AbstractURL) {
    items.push({
      title: body.Heading || body.AbstractSource || 'DuckDuckGo',
      url: body.AbstractURL,
      snippet: body.AbstractText || ''
    });
  }
  flattenDuckDuckGoTopics(body.RelatedTopics, []).forEach((topic) => {
    if (topic.FirstURL) {
      items.push({ title: topic.Text || topic.FirstURL, url: topic.FirstURL, snippet: topic.Text || '' });
    }
  });
  return { answer, results: items };
}

function parseTavily(body) {
  if (!body || typeof body !== 'object') return { answer: '', results: [] };
  return {
    answer: trimText(body.answer || '', 800),
    results: Array.isArray(body.results) ? body.results : []
  };
}

function parseSearxng(body) {
  if (!body || typeof body !== 'object') return { answer: '', results: [] };
  return { answer: '', results: Array.isArray(body.results) ? body.results : [] };
}

/**
 * 必应网页版结果解析。国内可直连，不需要 Key。
 * 结果块形如：<li class="b_algo"><h2><a href="...">标题</a></h2> ... <p>摘要</p>
 */
function parseBing(html, limit) {
  if (typeof html !== 'string' || !html) return [];
  const blocks = html.split('<li class="b_algo"').slice(1);
  const items = [];

  blocks.forEach((block) => {
    const anchor = block.match(/<h2[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!anchor) return;

    const url = decodeEntities(anchor[1]).trim();
    if (!/^https?:\/\//i.test(url)) return;
    if (/^([a-z0-9-]+\.)*bing\.com\//i.test(url.replace(/^https?:\/\//i, ''))) return;

    const paragraph = block.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
    const title = stripTags(anchor[2]);
    if (!title) return;

    items.push({
      title,
      url,
      snippet: paragraph ? stripTags(paragraph[1]) : ''
    });
  });

  return normalizeResults(items, limit);
}

function friendlyError(provider, error) {
  const message = (error && error.message) || '未知错误';
  const label = PROVIDER_LABELS[provider] || provider;
  if (/超时/.test(message)) return `${label} 搜索超时，检查一下网络或代理。`;
  if (/HTTP 401|HTTP 403/.test(message)) return `${label} 拒绝了请求，检查 Key 或服务地址。`;
  if (/ENOTFOUND|EAI_AGAIN/i.test(message)) return `连不上 ${label}，检查网络或 DNS。`;
  return `${label} 搜索失败：${message}`;
}

async function runTavily(settings, query, limit, request) {
  if (!settings.tavilyApiKey) {
    throw new Error('没有填写 Tavily API Key');
  }
  const response = await request('https://api.tavily.com/search', {
    method: 'POST',
    body: {
      api_key: settings.tavilyApiKey,
      query,
      max_results: limit,
      include_answer: true,
      search_depth: 'basic'
    }
  });
  if (response.status < 200 || response.status >= 300) throw new Error(`HTTP ${response.status}`);
  const parsed = parseTavily(response.body);
  return { answer: parsed.answer, results: normalizeResults(parsed.results, limit) };
}

async function runSearxng(settings, query, limit, request) {
  const base = String(settings.searxngUrl || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\/[^\s/]+/i.test(base)) {
    throw new Error('SearXNG 地址不正确（需要类似 https://searx.example.com 的地址）');
  }
  const url = `${base}/search?q=${encodeURIComponent(query)}&format=json&language=zh-CN`;
  const response = await request(url, { method: 'GET' });
  if (response.status < 200 || response.status >= 300) throw new Error(`HTTP ${response.status}`);
  const parsed = parseSearxng(response.body);
  return { answer: parsed.answer, results: normalizeResults(parsed.results, limit) };
}

async function runBing(query, limit, request) {
  const url =
    'https://cn.bing.com/search?q=' +
    encodeURIComponent(query) +
    `&setlang=zh-CN&count=${Math.max(6, limit + 2)}`;
  const response = await request(url, { method: 'GET', headers: BING_HEADERS });
  if (response.status < 200 || response.status >= 300) throw new Error(`HTTP ${response.status}`);

  const html = typeof response.body === 'string' ? response.body : response.raw;
  const results = parseBing(html, limit);
  if (results.length === 0) throw new Error('必应没有返回可解析的结果');
  return { answer: '', results };
}

async function runDuckDuckGo(query, limit, request) {
  const url =
    'https://api.duckduckgo.com/?q=' +
    encodeURIComponent(query) +
    '&format=json&no_html=1&skip_disambig=1&kl=cn-zh';
  const response = await request(url, { method: 'GET' });
  if (response.status < 200 || response.status >= 300) throw new Error(`HTTP ${response.status}`);
  const parsed = parseDuckDuckGo(response.body);
  const results = normalizeResults(parsed.results, limit);
  if (results.length === 0) throw new Error('DuckDuckGo 只返回了空结果');
  return { answer: parsed.answer, results };
}

/** 哪些提供商按什么顺序尝试；DuckDuckGo 在国内不可用时自动回退必应。 */
function providerOrder(provider) {
  if (provider === 'auto') return ['bing', 'duckduckgo'];
  if (provider === 'duckduckgo') return ['duckduckgo', 'bing'];
  if (provider === 'bing') return ['bing', 'duckduckgo'];
  return [provider];
}

/**
 * 联网搜索。失败时返回 ok:false 而不是抛异常；request 可注入，方便测试。
 */
async function searchWeb(options) {
  const opts = options || {};
  const settings = opts.settings || {};
  const query = String(opts.query || '').trim();
  const limit = Math.max(1, Math.min(10, Number(opts.limit) || settings.searchResults || 5));
  const request = opts.request || requestJSON;

  if (!query) {
    return { ok: false, provider: 'none', query, results: [], answer: '', error: '搜索内容不能为空' };
  }

  const configured = PROVIDERS.includes(settings.searchProvider) ? settings.searchProvider : 'auto';
  const order = providerOrder(configured);
  let lastError = '';

  for (const provider of order) {
    try {
      let payload;
      if (provider === 'tavily') payload = await runTavily(settings, query, limit, request);
      else if (provider === 'searxng') payload = await runSearxng(settings, query, limit, request);
      else if (provider === 'bing') payload = await runBing(query, limit, request);
      else payload = await runDuckDuckGo(query, limit, request);

      if (payload.results.length > 0) {
        return {
          ok: true,
          provider,
          query,
          answer: payload.answer || '',
          results: payload.results
        };
      }
      lastError = `${PROVIDER_LABELS[provider] || provider} 没有搜到结果`;
    } catch (error) {
      lastError = friendlyError(provider, error);
    }
  }

  const fallbackHint =
    configured === 'tavily' || configured === 'searxng'
      ? ''
      : ' 可以到设置里换用「必应（国内可用）」或填一个 Tavily Key。';

  return { ok: false, provider: configured, query, results: [], answer: '', error: `${lastError}${fallbackHint}` };
}

/** 把搜索结果拼成给模型看的上下文。 */
function buildSearchContext(payload, limit) {
  const results = (payload && payload.results) || [];
  if (results.length === 0) return '';
  const lines = results.slice(0, limit || results.length).map((item, index) => {
    return `[${index + 1}] ${item.title}\n${item.snippet}\n${item.url}`;
  });
  return lines.join('\n\n');
}

module.exports = {
  PROVIDERS,
  PROVIDER_LABELS,
  searchWeb,
  buildSearchContext,
  normalizeResults,
  parseTavily,
  parseSearxng,
  parseDuckDuckGo,
  parseBing,
  decodeEntities
};

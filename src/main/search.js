'use strict';

const { requestJSON } = require('./http');

const PROVIDERS = ['tavily', 'searxng', 'duckduckgo'];

const PROVIDER_LABELS = {
  tavily: 'Tavily',
  searxng: 'SearXNG',
  duckduckgo: 'DuckDuckGo（免费）'
};

function trimText(value, max) {
  const text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
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

function friendlyError(provider, error) {
  const message = (error && error.message) || '未知错误';
  if (/超时/.test(message)) return '搜索超时，检查一下网络或代理。';
  if (/401|403/.test(message)) return `${PROVIDER_LABELS[provider] || provider} 拒绝了请求，检查 Key 或服务地址。`;
  if (/ENOTFOUND|EAI_AGAIN/i.test(message)) return '连不上搜索服务，检查网络或 DNS。';
  return `搜索失败：${message}`;
}

/**
 * 联网搜索。provider 决定走哪个服务，失败时返回 ok:false 而不是抛异常。
 * request 可注入，方便测试。
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

  const provider = PROVIDERS.includes(settings.searchProvider) ? settings.searchProvider : 'duckduckgo';

  try {
    if (provider === 'tavily') {
      if (!settings.tavilyApiKey) {
        return {
          ok: false,
          provider,
          query,
          results: [],
          answer: '',
          error: '还没填 Tavily API Key，可以在设置里换用免费的 DuckDuckGo。'
        };
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
      if (response.status < 200 || response.status >= 300) {
        throw new Error(`HTTP ${response.status}`);
      }
      const parsed = parseTavily(response.body);
      return {
        ok: true,
        provider,
        query,
        answer: parsed.answer,
        results: normalizeResults(parsed.results, limit)
      };
    }

    if (provider === 'searxng') {
      const base = String(settings.searxngUrl || '').trim().replace(/\/+$/, '');
      if (!/^https?:\/\/[^\s/]+/i.test(base)) {
        return {
          ok: false,
          provider,
          query,
          results: [],
          answer: '',
          error: 'SearXNG 地址不正确，需要类似 https://searx.example.com 的地址。'
        };
      }
      const url = `${base}/search?q=${encodeURIComponent(query)}&format=json&language=zh-CN`;
      const response = await request(url, { method: 'GET' });
      if (response.status < 200 || response.status >= 300) {
        throw new Error(`HTTP ${response.status}`);
      }
      const parsed = parseSearxng(response.body);
      return {
        ok: true,
        provider,
        query,
        answer: parsed.answer,
        results: normalizeResults(parsed.results, limit)
      };
    }

    const url =
      'https://api.duckduckgo.com/?q=' +
      encodeURIComponent(query) +
      '&format=json&no_html=1&skip_disambig=1&kl=cn-zh';
    const response = await request(url, { method: 'GET' });
    if (response.status < 200 || response.status >= 300) throw new Error(`HTTP ${response.status}`);
    const parsed = parseDuckDuckGo(response.body);
    return {
      ok: true,
      provider,
      query,
      answer: parsed.answer,
      results: normalizeResults(parsed.results, limit)
    };
  } catch (error) {
    return {
      ok: false,
      provider,
      query,
      results: [],
      answer: '',
      error: friendlyError(provider, error)
    };
  }
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
  parseDuckDuckGo
};

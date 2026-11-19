'use strict';

const https = require('node:https');
const http = require('node:http');
const { URL } = require('node:url');

/**
 * 兼容用户填写的各种 Base URL：
 *   https://api.deepseek.com          -> .../chat/completions
 *   https://api.deepseek.com/v1       -> .../v1/chat/completions
 *   https://api.deepseek.com/v1/chat/completions -> 原样使用
 *   https://my-proxy.example.com/v1   -> .../v1/chat/completions
 */
function normalizeBaseUrl(baseUrl) {
  let base = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(base)) base = 'https://api.deepseek.com';
  return base;
}

function chatEndpoint(baseUrl) {
  const base = normalizeBaseUrl(baseUrl);
  if (/\/chat\/completions$/i.test(base)) return base;
  return `${base}/chat/completions`;
}

function modelsEndpoint(baseUrl) {
  const base = normalizeBaseUrl(baseUrl);
  if (/\/chat\/completions$/i.test(base)) return base.replace(/\/chat\/completions$/i, '/models');
  if (/\/models$/i.test(base)) return base;
  return `${base}/models`;
}

class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/** 把底层网络/HTTP 错误翻译成对用户友好的中文提示。 */
function friendlyMessage(error, status) {
  const code = error && error.code;
  if (status === 401) return 'API Key 无效或已过期，请在设置里检查一下。';
  if (status === 402) return '账户余额不足，请先到 DeepSeek 开放平台充值。';
  if (status === 403) return '这个 Key 没有访问权限，或者请求被拦截了。';
  if (status === 404) return '接口地址不对，检查一下 Base URL（默认 https://api.deepseek.com）。';
  if (status === 429) return '请求太频繁啦，休息几秒再试试。';
  if (status >= 500) return `服务器开小差了（HTTP ${status}），稍后再试。`;
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return '连不上 API 服务器，请检查网络或 DNS。';
  if (code === 'ECONNREFUSED') return 'API 服务器拒绝连接，可能是代理没开。';
  if (code === 'ETIMEDOUT' || (error && error.message === '请求超时，请检查网络')) {
    return '请求超时了，检查一下网络或代理设置。';
  }
  if (code === 'CERT_HAS_EXPIRED' || (error && /certificate/i.test(error.message || ''))) {
    return 'SSL 证书校验失败，可能是代理拦截了 HTTPS。';
  }
  return (error && error.message) || '出了点小问题，再试一次？';
}

function extractApiMessage(raw) {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && parsed.error && parsed.error.message) return String(parsed.error.message);
  } catch {
    /* 忽略非 JSON 响应 */
  }
  return '';
}

function createRequestOptions(url, apiKey, { stream, method }) {
  const lib = url.protocol === 'http:' ? http : https;
  return {
    lib,
    options: {
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || (url.protocol === 'http:' ? 80 : 443),
      path: `${url.pathname}${url.search}`,
      method: method || 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: stream ? 'text/event-stream' : 'application/json',
        'User-Agent': 'DeepSeekPet/1.0'
      }
    }
  };
}

/**
 * 以 SSE 方式调用 /chat/completions。
 * @returns {{abort: () => void}}
 */
function streamChat({ settings, messages, onDelta, onReasoning, onDone, onError }) {
  let settled = false;
  const finish = () => {
    if (settled) return;
    settled = true;
    onDone();
  };
  const fail = (error, status) => {
    if (settled) return;
    settled = true;
    onError(friendlyMessage(error, status));
  };

  let url;
  try {
    url = new URL(chatEndpoint(settings.baseUrl));
  } catch {
    fail(new Error('Base URL 格式不正确'));
    return { abort() {} };
  }

  const payload = JSON.stringify({
    model: settings.model || 'deepseek-chat',
    messages,
    stream: true,
    temperature: typeof settings.temperature === 'number' ? settings.temperature : 1
  });

  const { lib, options } = createRequestOptions(url, settings.apiKey, { stream: true });
  options.headers['Content-Type'] = 'application/json';
  options.headers['Content-Length'] = Buffer.byteLength(payload);

  let req;
  try {
    req = lib.request(options, (res) => {
      const status = res.statusCode || 0;
      if (status < 200 || status >= 300) {
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          raw += chunk;
        });
        res.on('end', () => {
          const detail = extractApiMessage(raw);
          fail(new ApiError(detail || `HTTP ${status}`, status), status);
        });
        return;
      }

      res.setEncoding('utf8');
      let buffer = '';
      const handleLine = (line) => {
        if (!line.startsWith('data:')) return;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') return;
        let json;
        try {
          json = JSON.parse(data);
        } catch {
          return;
        }
        const choice = json && Array.isArray(json.choices) ? json.choices[0] : null;
        const delta = choice && choice.delta;
        if (!delta) return;
        if (delta.reasoning_content) onReasoning(String(delta.reasoning_content));
        if (delta.content) onDelta(String(delta.content));
      };

      res.on('data', (chunk) => {
        buffer += chunk;
        let index;
        while ((index = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, index).replace(/\r$/, '');
          buffer = buffer.slice(index + 1);
          handleLine(line);
        }
      });
      res.on('end', () => {
        if (buffer.trim()) handleLine(buffer.trim());
        finish();
      });
      res.on('error', (error) => fail(error));
    });
  } catch (error) {
    fail(error);
    return { abort() {} };
  }

  req.on('error', (error) => {
    // 用户主动中断时 req.destroy() 也会触发 error，这里不当作失败
    if (req.destroyed && settled) return;
    fail(error);
  });

  req.setTimeout(90000, () => {
    req.destroy(new Error('请求超时，请检查网络'));
  });

  req.write(payload);
  req.end();

  return {
    abort() {
      if (settled) return;
      settled = true;
      try {
        req.destroy();
      } catch {
        /* 已经结束 */
      }
      onDone();
    }
  };
}

/**
 * 设置页的“测试连接”：请求 /models 并返回可用模型列表。
 * @returns {Promise<{ok: boolean, message: string, models: string[]}>}
 */
function testConnection(settings) {
  return new Promise((resolve) => {
    let url;
    try {
      url = new URL(modelsEndpoint(settings.baseUrl));
    } catch {
      resolve({ ok: false, message: 'Base URL 格式不正确', models: [] });
      return;
    }

    const { lib, options } = createRequestOptions(url, settings.apiKey, { stream: false, method: 'GET' });
    const req = lib.request(options, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        raw += chunk;
      });
      res.on('end', () => {
        const status = res.statusCode || 0;
        if (status < 200 || status >= 300) {
          const detail = extractApiMessage(raw);
          resolve({ ok: false, message: friendlyMessage(new ApiError(detail, status), status), models: [] });
          return;
        }
        let models = [];
        try {
          const parsed = JSON.parse(raw);
          if (parsed && Array.isArray(parsed.data)) {
            models = parsed.data.map((item) => item && item.id).filter(Boolean);
          }
        } catch {
          /* 某些代理不返回 JSON，视为连通 */
        }
        resolve({ ok: true, message: '连接成功，Key 可用。', models });
      });
    });

    req.on('error', (error) => resolve({ ok: false, message: friendlyMessage(error), models: [] }));
    req.setTimeout(20000, () => req.destroy(new Error('请求超时，请检查网络')));
    req.end();
  });
}

/**
 * 非流式对话，用于「从聊天里提取长期记忆」这类后台小任务。
 * @returns {Promise<string>}
 */
function completeChat({ settings, messages, maxTokens = 400, temperature = 0.2 }) {
  return new Promise((resolve, reject) => {
    let url;
    try {
      url = new URL(chatEndpoint(settings.baseUrl));
    } catch {
      reject(new Error('Base URL 格式不正确'));
      return;
    }

    const payload = JSON.stringify({
      model: settings.model || 'deepseek-chat',
      messages,
      stream: false,
      temperature,
      max_tokens: maxTokens
    });

    const { lib, options } = createRequestOptions(url, settings.apiKey, { stream: false });
    options.headers['Content-Type'] = 'application/json';
    options.headers['Content-Length'] = Buffer.byteLength(payload);

    const req = lib.request(options, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        raw += chunk;
      });
      res.on('end', () => {
        const status = res.statusCode || 0;
        if (status < 200 || status >= 300) {
          const detail = extractApiMessage(raw);
          reject(new Error(friendlyMessage(new ApiError(detail || `HTTP ${status}`, status), status)));
          return;
        }
        try {
          const parsed = JSON.parse(raw);
          const content =
            parsed && parsed.choices && parsed.choices[0] && parsed.choices[0].message
              ? parsed.choices[0].message.content
              : '';
          resolve(String(content || ''));
        } catch {
          reject(new Error('返回内容不是合法 JSON'));
        }
      });
      res.on('error', reject);
    });

    req.on('error', (error) => reject(new Error(friendlyMessage(error))));
    req.setTimeout(30000, () => req.destroy(new Error('请求超时，请检查网络')));
    req.write(payload);
    req.end();
  });
}

module.exports = {
  ApiError,
  chatEndpoint,
  modelsEndpoint,
  normalizeBaseUrl,
  friendlyMessage,
  streamChat,
  completeChat,
  testConnection
};

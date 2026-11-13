'use strict';

const http = require('node:http');
const https = require('node:https');
const { URL } = require('node:url');

const MAX_BODY = 2 * 1024 * 1024;

function tooLargeError() {
  const error = new Error('响应内容过大');
  error.code = 'ETOOLARGE';
  return error;
}

/**
 * 一个很小的 JSON 请求器：支持重定向、超时、POST，不依赖第三方库。
 * 返回 { status, headers, body }，body 会尽量解析成 JSON，解析失败则保留文本。
 */
function requestJSON(urlString, options) {
  const opts = options || {};
  const method = (opts.method || 'GET').toUpperCase();
  const timeout = opts.timeout || 15000;
  const maxRedirects = opts.maxRedirects == null ? 3 : opts.maxRedirects;
  const headers = Object.assign(
    {
      Accept: 'application/json',
      'Accept-Encoding': 'identity',
      'User-Agent': 'DeepSeekPet/1.0'
    },
    opts.headers || {}
  );

  let payload = null;
  if (opts.body != null) {
    payload = typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body);
    headers['Content-Type'] = headers['Content-Type'] || 'application/json';
    headers['Content-Length'] = Buffer.byteLength(payload);
  }

  return new Promise((resolve, reject) => {
    let url;
    try {
      url = new URL(urlString);
    } catch {
      reject(new Error(`地址格式不正确：${urlString}`));
      return;
    }

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      reject(new Error('只支持 http/https 地址'));
      return;
    }

    const lib = url.protocol === 'http:' ? http : https;
    const request = lib.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || (url.protocol === 'http:' ? 80 : 443),
        path: `${url.pathname}${url.search}`,
        method,
        headers
      },
      (response) => {
        const status = response.statusCode || 0;
        const location = response.headers.location;

        if (status >= 300 && status < 400 && location && maxRedirects > 0) {
          response.resume();
          const nextUrl = new URL(location, url).toString();
          const nextMethod = status === 303 ? 'GET' : method;
          requestJSON(nextUrl, {
            ...opts,
            method: nextMethod,
            body: nextMethod === 'GET' ? undefined : opts.body,
            maxRedirects: maxRedirects - 1,
            headers: opts.headers
          }).then(resolve, reject);
          return;
        }

        let raw = '';
        let size = 0;
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          size += Buffer.byteLength(chunk);
          if (size > MAX_BODY) {
            response.destroy(tooLargeError());
            return;
          }
          raw += chunk;
        });
        response.on('end', () => {
          let body = raw;
          try {
            body = raw ? JSON.parse(raw) : null;
          } catch {
            /* 保留原始文本，交给调用方判断 */
          }
          resolve({ status, headers: response.headers, body, raw });
        });
        response.on('error', reject);
      }
    );

    request.setTimeout(timeout, () => {
      request.destroy(new Error('请求超时'));
    });
    request.on('error', reject);
    if (payload) request.write(payload);
    request.end();
  });
}

module.exports = { requestJSON };

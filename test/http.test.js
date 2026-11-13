'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const { requestJSON } = require('../src/main/http');

function startServer(handler) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler);
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

function closeServer(server) {
  return new Promise((resolve) => server.close(resolve));
}

test('GET 会解析 JSON，并跟随 302 重定向', async () => {
  const { server, port } = await startServer((req, res) => {
    if (req.url === '/start') {
      res.writeHead(302, { Location: '/data' });
      res.end();
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, path: req.url }));
  });

  const response = await requestJSON(`http://127.0.0.1:${port}/start`);
  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.path, '/data');

  await closeServer(server);
});

test('POST 会发送 JSON，并把非 JSON 响应原样返回', async () => {
  let received = null;
  const { server, port } = await startServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      received = { method: req.method, body, type: req.headers['content-type'] };
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('不是 JSON');
    });
  });

  const response = await requestJSON(`http://127.0.0.1:${port}/submit`, {
    method: 'POST',
    body: { hello: 'world' }
  });

  assert.equal(received.method, 'POST');
  assert.match(received.type, /application\/json/);
  assert.deepEqual(JSON.parse(received.body), { hello: 'world' });
  assert.equal(response.raw, '不是 JSON');
  assert.equal(typeof response.body, 'string');

  await closeServer(server);
});

test('HTTP 错误状态会原样返回，交给调用方处理', async () => {
  const { server, port } = await startServer((req, res) => {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'forbidden' }));
  });

  const response = await requestJSON(`http://127.0.0.1:${port}/forbidden`);
  assert.equal(response.status, 403);
  assert.equal(response.body.error, 'forbidden');

  await closeServer(server);
});

test('非法协议会被拒绝，不会挂起', async () => {
  await assert.rejects(() => requestJSON('ftp://example.com/file'), /http\/https/);
});

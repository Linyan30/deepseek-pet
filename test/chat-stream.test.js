'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const { streamChat, testConnection, completeChat } = require('../src/main/chat');

function startServer(handler) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler);
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: server.address().port });
    });
  });
}

function closeServer(server) {
  return new Promise((resolve) => server.close(resolve));
}

function sseChunk(json) {
  return `data: ${JSON.stringify(json)}\n\n`;
}

test('真实 HTTP 请求：解析流式 SSE、拆分跨包的 data 行', async () => {
  let received = null;
  const { server, port } = await startServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      received = {
        method: req.method,
        url: req.url,
        auth: req.headers.authorization,
        body: JSON.parse(body)
      };

      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(sseChunk({ choices: [{ delta: { role: 'assistant' } }] }));
      // 故意把一条 data 拆成两个 TCP 包，验证缓冲区拼接
      const line = sseChunk({ choices: [{ delta: { content: '你' } }] });
      res.write(line.slice(0, 12));
      setTimeout(() => {
        res.write(line.slice(12));
        res.write(sseChunk({ choices: [{ delta: { content: '好' } }] }));
        res.write(sseChunk({ choices: [{ delta: { content: '呀' } }] }));
        res.write('data: [DONE]\n\n');
        res.end();
      }, 20);
    });
  });

  const deltas = [];
  const reasoning = [];
  await new Promise((resolve, reject) => {
    streamChat({
      settings: {
        apiKey: 'sk-test',
        baseUrl: `http://127.0.0.1:${port}/v1`,
        model: 'deepseek-chat',
        temperature: 0.7
      },
      messages: [
        { role: 'system', content: '你是小鲸鱼' },
        { role: 'user', content: '你好' }
      ],
      onDelta: (text) => deltas.push(text),
      onReasoning: (text) => reasoning.push(text),
      onDone: resolve,
      onError: reject
    });
  });

  assert.equal(deltas.join(''), '你好呀');
  assert.deepEqual(reasoning, []);
  assert.equal(received.method, 'POST');
  assert.equal(received.url, '/v1/chat/completions');
  assert.equal(received.auth, 'Bearer sk-test');
  assert.equal(received.body.stream, true);
  assert.equal(received.body.model, 'deepseek-chat');
  assert.equal(received.body.temperature, 0.7);
  assert.equal(received.body.messages.length, 2);

  await closeServer(server);
});

test('deepseek-reasoner 的 reasoning_content 会单独回调', async () => {
  const { server, port } = await startServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write(sseChunk({ choices: [{ delta: { reasoning_content: '先想一下' } }] }));
    res.write(sseChunk({ choices: [{ delta: { content: '答案' } }] }));
    res.end();
  });

  const deltas = [];
  const reasoning = [];
  await new Promise((resolve, reject) => {
    streamChat({
      settings: { apiKey: 'sk-test', baseUrl: `http://127.0.0.1:${port}`, model: 'deepseek-reasoner' },
      messages: [{ role: 'user', content: '1+1' }],
      onDelta: (text) => deltas.push(text),
      onReasoning: (text) => reasoning.push(text),
      onDone: resolve,
      onError: reject
    });
  });

  assert.deepEqual(reasoning, ['先想一下']);
  assert.equal(deltas.join(''), '答案');
  await closeServer(server);
});

test('HTTP 401 会给出中文 Key 提示，而不是抛原始错误', async () => {
  const { server, port } = await startServer((req, res) => {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'Authentication Fails' } }));
  });

  const error = await new Promise((resolve) => {
    streamChat({
      settings: { apiKey: 'sk-bad', baseUrl: `http://127.0.0.1:${port}` },
      messages: [{ role: 'user', content: 'hi' }],
      onDelta: () => {},
      onReasoning: () => {},
      onDone: () => resolve(null),
      onError: resolve
    });
  });

  assert.match(error, /API Key/);
  await closeServer(server);
});

test('主动中断只会回调一次 done', async () => {
  const { server, port } = await startServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write(sseChunk({ choices: [{ delta: { content: '半句' } }] }));
    // 不结束响应，等客户端 abort
  });

  let doneCount = 0;
  let errorCount = 0;
  const stream = streamChat({
    settings: { apiKey: 'sk-test', baseUrl: `http://127.0.0.1:${port}` },
    messages: [{ role: 'user', content: 'hi' }],
    onDelta: () => {},
    onReasoning: () => {},
    onDone: () => {
      doneCount += 1;
    },
    onError: () => {
      errorCount += 1;
    }
  });

  await new Promise((resolve) => setTimeout(resolve, 120));
  stream.abort();
  await new Promise((resolve) => setTimeout(resolve, 80));

  assert.equal(doneCount, 1);
  assert.equal(errorCount, 0);
  server.closeAllConnections();
  await closeServer(server);
});

test('测试连接会读取 /models 返回的模型列表', async () => {
  const { server, port } = await startServer((req, res) => {
    assert.equal(req.url, '/models');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ data: [{ id: 'deepseek-chat' }, { id: 'deepseek-reasoner' }] }));
  });

  const result = await testConnection({
    apiKey: 'sk-test',
    baseUrl: `http://127.0.0.1:${port}`
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.models, ['deepseek-chat', 'deepseek-reasoner']);
  await closeServer(server);
});

test('completeChat 返回非流式内容，用于记忆提取', async () => {
  let received = null;
  const { server, port } = await startServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      received = JSON.parse(body);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          choices: [{ message: { role: 'assistant', content: '["用户喜欢猫"]' } }]
        })
      );
    });
  });

  const content = await completeChat({
    settings: { apiKey: 'sk-test', baseUrl: `http://127.0.0.1:${port}`, model: 'deepseek-chat' },
    messages: [{ role: 'user', content: '提取记忆' }],
    maxTokens: 100
  });

  assert.equal(content, '["用户喜欢猫"]');
  assert.equal(received.stream, false);
  assert.equal(received.max_tokens, 100);
  await closeServer(server);
});

test('completeChat 遇到 401 会抛出可读错误', async () => {
  const { server, port } = await startServer((req, res) => {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'Authentication Fails' } }));
  });

  try {
    await assert.rejects(
      () =>
        completeChat({
          settings: { apiKey: 'bad', baseUrl: `http://127.0.0.1:${port}`, model: 'deepseek-chat' },
          messages: [{ role: 'user', content: 'hi' }]
        }),
      /API Key/
    );
  } finally {
    await closeServer(server);
  }
});

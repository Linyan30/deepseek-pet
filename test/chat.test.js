'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  chatEndpoint,
  modelsEndpoint,
  friendlyMessage,
  ApiError
} = require('../src/main/chat');

test('Base URL 会被补全成 chat/completions', () => {
  assert.equal(chatEndpoint('https://api.deepseek.com'), 'https://api.deepseek.com/chat/completions');
  assert.equal(chatEndpoint('https://api.deepseek.com/'), 'https://api.deepseek.com/chat/completions');
  assert.equal(chatEndpoint('https://api.deepseek.com/v1'), 'https://api.deepseek.com/v1/chat/completions');
  assert.equal(
    chatEndpoint('https://api.deepseek.com/v1/chat/completions'),
    'https://api.deepseek.com/v1/chat/completions'
  );
  assert.equal(
    chatEndpoint('https://proxy.example.com/v1/chat/completions'),
    'https://proxy.example.com/v1/chat/completions'
  );
});

test('空或非法的 Base URL 回落到官方地址', () => {
  assert.equal(chatEndpoint(''), 'https://api.deepseek.com/chat/completions');
  assert.equal(chatEndpoint(undefined), 'https://api.deepseek.com/chat/completions');
  assert.equal(chatEndpoint('ftp://evil'), 'https://api.deepseek.com/chat/completions');
});

test('/models 端点推导正确', () => {
  assert.equal(modelsEndpoint('https://api.deepseek.com'), 'https://api.deepseek.com/models');
  assert.equal(modelsEndpoint('https://api.deepseek.com/v1'), 'https://api.deepseek.com/v1/models');
  assert.equal(
    modelsEndpoint('https://api.deepseek.com/v1/chat/completions'),
    'https://api.deepseek.com/v1/models'
  );
});

test('常见错误会翻译成中文提示', () => {
  assert.match(friendlyMessage(new Error('x'), 401), /API Key/);
  assert.match(friendlyMessage(new Error('x'), 402), /余额/);
  assert.match(friendlyMessage(new Error('x'), 429), /频繁/);
  assert.match(friendlyMessage(new Error('x'), 503), /服务器/);
  assert.match(friendlyMessage(Object.assign(new Error(''), { code: 'ENOTFOUND' })), /网络/);
  assert.match(friendlyMessage(Object.assign(new Error(''), { code: 'ECONNREFUSED' })), /代理/);
  assert.match(friendlyMessage(new ApiError('boom', 500), 500), /服务器/);
});

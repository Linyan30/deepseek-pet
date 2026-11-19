'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createMemoryStore, MAX_FACTS, MAX_MESSAGES } = require('../src/main/memory');

function tempStore(options) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-memory-'));
  return {
    dir,
    store: createMemoryStore({
      memoryFile: path.join(dir, 'memory.json'),
      chatFile: path.join(dir, 'chats.json'),
      logger: { warn() {} },
      ...(options || {})
    })
  };
}

test('记忆可以新增、去重、删除和清空', () => {
  const { store } = tempStore();
  assert.equal(store.stats().facts, 0);

  store.addFact('用户在写一个 Electron 桌宠');
  store.addFact('  用户在写一个 Electron 桌宠  ');
  store.addFact('用户住在杭州');
  assert.equal(store.stats().facts, 2);

  assert.equal(store.removeFacts('杭州'), 1);
  assert.equal(store.stats().facts, 1);

  store.clearFacts();
  assert.equal(store.stats().facts, 0);
});

test('记忆会生成注入上下文，并限制条数', () => {
  const { store } = tempStore();
  store.addFact('第一条');
  store.addFact('第二条');
  const context = store.buildMemoryContext(1);
  assert.match(context, /长期记忆/);
  assert.match(context, /第二条/);
  assert.doesNotMatch(context, /第一条/);
  assert.equal(store.buildMemoryContext(5).split('\n').length, 3);
});

test('记忆超过上限会丢弃最旧的', () => {
  const { store } = tempStore();
  for (let index = 0; index < MAX_FACTS + 10; index += 1) {
    store.addFact(`事实 ${index}`);
  }
  assert.equal(store.stats().facts, MAX_FACTS);
  assert.equal(store.listFacts()[0].text, `事实 ${MAX_FACTS + 9}`);
});

test('聊天记录会落盘并在重建后恢复', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-memory-'));
  const options = {
    memoryFile: path.join(dir, 'memory.json'),
    chatFile: path.join(dir, 'chats.json'),
    logger: { warn() {} }
  };
  const first = createMemoryStore(options);
  first.appendMessage('user', '你好', { hasImage: true });
  first.appendMessage('assistant', '你好呀，我是小深');

  const second = createMemoryStore(options);
  const messages = second.listMessages();
  assert.equal(messages.length, 2);
  assert.equal(messages[0].content, '你好');
  assert.equal(messages[0].hasImage, true);
  assert.equal(messages[1].role, 'assistant');
});

test('聊天记录有上限，清空后不再恢复', () => {
  const { store } = tempStore();
  for (let index = 0; index < MAX_MESSAGES + 20; index += 1) {
    store.appendMessage(index % 2 === 0 ? 'user' : 'assistant', `消息 ${index}`);
  }
  assert.equal(store.stats().messages, MAX_MESSAGES);
  assert.equal(store.recentMessages(1)[0].content, `消息 ${MAX_MESSAGES + 19}`);

  store.clearMessages();
  assert.equal(store.stats().messages, 0);
});

test('损坏的文件不会导致崩溃', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-memory-'));
  fs.writeFileSync(path.join(dir, 'memory.json'), '{ 坏掉的 JSON', 'utf8');
  fs.writeFileSync(path.join(dir, 'chats.json'), '不是 JSON', 'utf8');
  const store = createMemoryStore({
    memoryFile: path.join(dir, 'memory.json'),
    chatFile: path.join(dir, 'chats.json'),
    logger: { warn() {} }
  });
  assert.equal(store.stats().facts, 0);
  store.addFact('仍然能写入');
  assert.equal(store.stats().facts, 1);
});

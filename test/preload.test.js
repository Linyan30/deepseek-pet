'use strict';

const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

let api = null;
const sent = [];
const invoked = [];

before(() => {
  const electronMock = {
    contextBridge: {
      exposeInMainWorld(name, value) {
        assert.equal(name, 'api');
        api = value;
      }
    },
    ipcRenderer: {
      send(channel, payload) {
        sent.push({ channel, payload });
      },
      invoke(channel, ...args) {
        invoked.push({ channel, args });
        return Promise.resolve(null);
      },
      on() {},
      removeListener() {}
    }
  };

  const originalLoad = Module._load;
  Module._load = function patched(request, parent, isMain) {
    if (request === 'electron') return electronMock;
    return originalLoad.call(this, request, parent, isMain);
  };
  require('../preload.js');
  Module._load = originalLoad;
});

test('preload 暴露了完整的 api 对象', () => {
  assert.ok(api);
  assert.equal(typeof api.sendChat, 'function');
  assert.equal(typeof api.getSettings, 'function');
});

test('sendChat 传入对象时保留 messages 与 search', () => {
  sent.length = 0;
  api.sendChat({ messages: [{ role: 'user', content: '你好' }], search: true });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].channel, 'chat:send');
  assert.deepEqual(sent[0].payload.messages, [{ role: 'user', content: '你好' }]);
  assert.equal(sent[0].payload.search, true);
});

test('sendChat 传入数组时自动包装成 { messages }', () => {
  sent.length = 0;
  api.sendChat([{ role: 'user', content: '旧写法' }]);
  assert.deepEqual(sent[0].payload, { messages: [{ role: 'user', content: '旧写法' }] });
});

test('sendChat 传空值时不会崩溃', () => {
  sent.length = 0;
  api.sendChat(null);
  assert.deepEqual(sent[0].payload, { messages: [] });
});

test('图片消息会原样透传给主进程', () => {
  sent.length = 0;
  const image = 'data:image/png;base64,iVBORw0KGgo=';
  api.sendChat({ messages: [{ role: 'user', content: '看图', image }], search: false });
  assert.equal(sent[0].payload.messages[0].image, image);
});

test('设置保存通过 invoke 调用 settings:save', async () => {
  invoked.length = 0;
  await api.saveSettings({ petName: '测试' });
  assert.equal(invoked[0].channel, 'settings:save');
  assert.deepEqual(invoked[0].args[0], { petName: '测试' });
});

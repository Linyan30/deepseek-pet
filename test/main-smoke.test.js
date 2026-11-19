'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const { installElectronMock } = require('../test-support/electron-mock');
const { LINES } = require('../src/shared/quips');

let mock;
let settingsDir;
let petWindow;
let chatWindow;
let settingsWindow;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate, timeout = 3000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const value = predicate();
    if (value) return value;
    await wait(25);
  }
  throw new Error('等待超时');
}

before(async () => {
  settingsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-main-'));
  mock = installElectronMock({ userDataDir: settingsDir });
  require('../main.js');
  await wait(50);
  petWindow = mock.windows.find((win) => win.loadedFile && win.loadedFile.endsWith('pet.html'));
});

after(() => {
  try {
    mock.app.emit('before-quit');
  } catch {
    /* 忽略 */
  }
  mock.dispose();
  fs.rmSync(settingsDir, { recursive: true, force: true });
});

test('启动后出现透明小窗口，并注册了显示/隐藏快捷键', () => {
  assert.ok(petWindow, '应该创建宠物窗口');
  assert.equal(petWindow.bounds.width, 210);
  assert.equal(petWindow.bounds.height, 290);
  assert.equal(petWindow.options.transparent, true);
  assert.equal(petWindow.options.frame, false);
  assert.equal(petWindow.options.skipTaskbar, true);
  assert.equal(petWindow.options.webPreferences.contextIsolation, true);
  assert.equal(petWindow.options.webPreferences.nodeIntegration, false);
  assert.equal(petWindow.options.webPreferences.sandbox, true);
  assert.equal(petWindow.ignoreMouse, true);
  assert.ok(mock.electron.globalShortcut.isRegistered('CommandOrControl+Shift+Alt+D'));
});

test('宠物窗口读不到 API Key', async () => {
  const settings = await mock.ipcMain.invoke('settings:get', petWindow.webContents.id);
  assert.equal(settings.apiKey, undefined);
  assert.equal(settings.hasApiKey, false);
  assert.equal(settings.petName, '小深');
});

test('宠物可以打开聊天窗口', async () => {
  mock.ipcMain.emitFrom('window:chat', petWindow.webContents.id);
  await wait(50);
  chatWindow = mock.windows.find((win) => win.loadedFile && win.loadedFile.endsWith('chat.html'));
  assert.ok(chatWindow, '应该创建聊天窗口');
  assert.equal(chatWindow.visible, true);
});

test('没有 API Key 时用内置台词流式回复，不会发网络请求', async () => {
  mock.ipcMain.emitFrom('chat:send', chatWindow.webContents.id, {
    messages: [{ role: 'user', content: '你好呀' }]
  });

  const done = await waitFor(() =>
    chatWindow.webContents.sent.filter((item) => item.channel === 'chat:done').pop()
  );
  assert.equal(done.payload.offline, true);

  const deltas = chatWindow.webContents.sent.filter((item) => item.channel === 'chat:delta');
  const reply = deltas.map((item) => item.payload.delta).join('');
  assert.ok(reply.length > 8, '应该收到逐字输出');
  assert.ok(LINES.offline.includes(reply), `应该是内置台词之一，实际收到：${reply}`);
  assert.match(reply, /API Key|设置/);
});

test('带图片的消息在未配置 Key 时也能走离线回复', async () => {
  const before = chatWindow.webContents.sent.filter((item) => item.channel === 'chat:done').length;
  mock.ipcMain.emitFrom('chat:send', chatWindow.webContents.id, {
    messages: [
      { role: 'user', content: '看看这张图', image: 'data:image/png;base64,iVBORw0KGgo=' }
    ],
    search: false
  });

  const done = await waitFor(() => {
    const list = chatWindow.webContents.sent.filter((item) => item.channel === 'chat:done');
    return list.length > before ? list[list.length - 1] : null;
  });
  assert.ok(done);
});

test('/记住 会把内容写入长期记忆，并返回本地回复', async () => {
  const before = chatWindow.webContents.sent.filter((item) => item.channel === 'chat:done').length;

  mock.ipcMain.emitFrom('chat:send', chatWindow.webContents.id, {
    messages: [{ role: 'user', content: '/记住 我养了一只猫叫豆豆' }],
    search: false
  });

  await waitFor(
    () => chatWindow.webContents.sent.filter((item) => item.channel === 'chat:done').length > before
  );

  const factFile = path.join(settingsDir, 'deepseek-pet', 'memory.json');
  assert.ok(fs.existsSync(factFile), 'memory.json 应已生成');
  const data = JSON.parse(fs.readFileSync(factFile, 'utf8'));
  assert.ok(data.facts.some((fact) => fact.text.includes('豆豆')));

  const stats = await mock.ipcMain.invoke('memory:stats', chatWindow.webContents.id);
  assert.ok(stats.facts >= 1);
});

test('聊天记录会保存到本地，并且可以清空', async () => {
  const chatFile = path.join(settingsDir, 'deepseek-pet', 'chats.json');
  assert.ok(fs.existsSync(chatFile), 'chats.json 应已生成');
  const data = JSON.parse(fs.readFileSync(chatFile, 'utf8'));
  assert.ok(data.messages.length > 0);

  const cleared = await mock.ipcMain.invoke('memory:clear', chatWindow.webContents.id, 'messages');
  assert.equal(cleared.ok, true);
  assert.equal(cleared.stats.messages, 0);

  const clearedFacts = await mock.ipcMain.invoke('memory:clear', chatWindow.webContents.id, 'facts');
  assert.equal(clearedFacts.stats.facts, 0);
});

test('搜索测试接口只允许设置窗口调用', async () => {
  const denied = await mock.ipcMain.invoke('search:test', petWindow.webContents.id, { query: 'x' });
  assert.equal(denied.ok, false);
});

test('设置窗口保存后立即生效：名字、大小、密钥', async () => {
  mock.ipcMain.emitFrom('window:settings', petWindow.webContents.id);
  await wait(50);
  settingsWindow = mock.windows.find((win) => win.loadedFile && win.loadedFile.endsWith('settings.html'));
  assert.ok(settingsWindow, '应该创建设置窗口');

  const full = await mock.ipcMain.invoke('settings:get', settingsWindow.webContents.id);
  assert.equal(full.apiKey, '', '设置窗口可以读到完整配置');

  const result = await mock.ipcMain.invoke('settings:save', settingsWindow.webContents.id, {
    petName: '鲸鲸',
    scale: 1.2,
    apiKey: 'sk-test',
    workMinutes: 30,
    visionModel: 'gpt-4o'
  });

  assert.equal(result.ok, true);
  assert.equal(result.settings.apiKey, 'sk-test');
  assert.equal(result.settings.visionModel, 'gpt-4o');
  assert.equal(petWindow.bounds.width, 252);
  assert.equal(petWindow.bounds.height, 348);
  assert.equal(petWindow.zoomFactor, 1.2);

  const changed = petWindow.webContents.sent.filter((item) => item.channel === 'settings:changed').pop();
  assert.equal(changed.payload.petName, '鲸鲸');
  assert.equal(changed.payload.apiKey, undefined);
  assert.equal(changed.payload.hasApiKey, true);

  const onDisk = JSON.parse(
    fs.readFileSync(path.join(settingsDir, 'deepseek-pet', 'settings.json'), 'utf8')
  );
  assert.equal(onDisk.apiKey, 'sk-test');
  assert.equal(onDisk.scale, 1.2);
});

test('宠物窗口没有权限修改设置', async () => {
  const denied = await mock.ipcMain.invoke('settings:save', petWindow.webContents.id, { petName: 'hacked' });
  assert.equal(denied.ok, false);
});

test('亲密度：启动见面分、摸头加分、冷却期内不重复加', async () => {
  const initial = await mock.ipcMain.invoke('state:get', petWindow.webContents.id);
  assert.ok(initial, '宠物应该能读取亲密度');
  assert.ok(initial.affinity >= 2, '启动时会有一点点见面分');
  assert.equal(initial.level, 1);

  mock.ipcMain.emitFrom('state:interact', petWindow.webContents.id, 'pat');
  const afterPat = await mock.ipcMain.invoke('state:get', petWindow.webContents.id);
  assert.equal(afterPat.affinity, initial.affinity + 1);
  assert.equal(afterPat.stats.pats, 1);

  mock.ipcMain.emitFrom('state:interact', petWindow.webContents.id, 'pat');
  const afterSecond = await mock.ipcMain.invoke('state:get', petWindow.webContents.id);
  assert.equal(afterSecond.affinity, afterPat.affinity, '冷却期内不应该重复加分');
});

test('托盘菜单显示亲密度，并提供快捷指令与整点报时', () => {
  const menu = mock.menus[mock.menus.length - 1];
  const labels = menu.template.map((item) => item.label).filter(Boolean);
  assert.ok(labels.some((label) => label.startsWith('亲密度 Lv.')), '托盘应显示亲密度');
  assert.ok(labels.includes('快捷指令'));
  assert.ok(labels.includes('整点报时'));
});

test('随机表情包会发到聊天窗口，且图片存在', () => {
  const before = chatWindow.webContents.sent.filter((item) => item.channel === 'chat:sticker').length;
  mock.ipcMain.emitFrom('sticker:random', chatWindow.webContents.id);
  const stickers = chatWindow.webContents.sent.filter((item) => item.channel === 'chat:sticker');
  assert.equal(stickers.length, before + 1);

  const payload = stickers[stickers.length - 1].payload;
  const file = path.join(__dirname, '..', 'src', 'renderer', 'assets', 'stickers', `${payload.id}.png`);
  assert.ok(fs.existsSync(file), `表情文件不存在：${payload.id}`);
});

test('剪贴板只开放给聊天窗口读取', async () => {
  const text = await mock.ipcMain.invoke('clipboard:read', chatWindow.webContents.id);
  assert.match(text, /剪贴板/);
  const denied = await mock.ipcMain.invoke('clipboard:read', petWindow.webContents.id);
  assert.equal(denied, '');
});

test('其他来源拿不到亲密度数据', async () => {
  const denied = await mock.ipcMain.invoke('state:get', 999999);
  assert.equal(denied, null);
});

test('拖拽会按像素移动窗口，鼠标穿透开关生效', () => {
  const before = petWindow.getBounds();
  mock.ipcMain.emitFrom('pet:drag', petWindow.webContents.id, { dx: 12, dy: -7 });
  const after = petWindow.getBounds();
  assert.equal(after.x, before.x + 12);
  assert.equal(after.y, before.y - 7);

  mock.ipcMain.emitFrom('pet:mouse-ignore', petWindow.webContents.id, false);
  assert.equal(petWindow.ignoreMouse, false);
});

test('宠物可以控制番茄钟', async () => {
  mock.ipcMain.emitFrom('pomodoro:command', petWindow.webContents.id, 'start');
  const snapshot = await mock.ipcMain.invoke('pomodoro:state');
  assert.equal(snapshot.phase, 'work');
  assert.equal(snapshot.running, true);
  assert.equal(snapshot.total, 30 * 60, '应该使用设置里的 30 分钟');

  const tick = petWindow.webContents.sent.filter((item) => item.channel === 'pomodoro:tick').pop();
  assert.equal(tick.payload.phase, 'work');

  mock.ipcMain.emitFrom('pomodoro:command', petWindow.webContents.id, 'reset');
  const reset = await mock.ipcMain.invoke('pomodoro:state');
  assert.equal(reset.phase, 'idle');
});

test('右键可以弹出原生菜单', () => {
  const before = mock.menus.length;
  mock.ipcMain.emitFrom('pet:context-menu', petWindow.webContents.id);
  assert.ok(mock.menus.length > before);
  const labels = mock.menus[mock.menus.length - 1].template.map((item) => item.label).filter(Boolean);
  assert.ok(labels.includes('和小鲸鱼聊天'));
  assert.ok(labels.includes('退出'));
});

test('发图片时会切换到视觉模型，并按多模态格式请求', async () => {
  let captured = null;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      captured = JSON.parse(body);
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write('data: {"choices":[{"delta":{"content":"看到啦"}}]}\n\n');
      res.end('data: [DONE]\n\n');
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  try {
    const saved = await mock.ipcMain.invoke('settings:save', settingsWindow.webContents.id, {
      apiKey: 'sk-test',
      baseUrl: `http://127.0.0.1:${port}/v1`,
      model: 'text-model',
      visionModel: 'vision-test'
    });
    assert.equal(saved.ok, true);

    const before = chatWindow.webContents.sent.filter((item) => item.channel === 'chat:done').length;
    mock.ipcMain.emitFrom('chat:send', chatWindow.webContents.id, {
      messages: [
        {
          role: 'user',
          content: '这是什么？',
          image: 'data:image/png;base64,iVBORw0KGgo='
        }
      ],
      search: false
    });

    await waitFor(
      () => chatWindow.webContents.sent.filter((item) => item.channel === 'chat:done').length > before
    );
    await waitFor(() => captured);

    assert.equal(captured.model, 'vision-test');
    const last = captured.messages[captured.messages.length - 1];
    assert.ok(Array.isArray(last.content));
    assert.equal(last.content[0].type, 'text');
    assert.equal(last.content[1].type, 'image_url');
    assert.match(last.content[1].image_url.url, /^data:image\/png;base64,/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('退出时清理计时器', () => {
  mock.ipcMain.emitFrom('app:quit', petWindow.webContents.id);
  assert.equal(mock.app.quitCalled, true);
});

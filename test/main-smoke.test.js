'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

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
  assert.equal(petWindow.bounds.width, 200);
  assert.equal(petWindow.bounds.height, 250);
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
    workMinutes: 30
  });

  assert.equal(result.ok, true);
  assert.equal(result.settings.apiKey, 'sk-test');
  assert.equal(petWindow.bounds.width, 240);
  assert.equal(petWindow.bounds.height, 300);
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

test('退出时清理计时器', () => {
  mock.ipcMain.emitFrom('app:quit', petWindow.webContents.id);
  assert.equal(mock.app.quitCalled, true);
});

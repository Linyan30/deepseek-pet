'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const {
  createUpdater,
  isNewerVersion,
  parseVersion,
  parseRepo,
  releaseApiUrl,
  releasePageUrl
} = require('../src/main/updater');

const PACKAGE = {
  version: '1.2.0',
  repository: { type: 'git', url: 'https://github.com/Linyan30/deepseek-pet.git' }
};

function fakeApp(packaged, version) {
  return {
    isPackaged: Boolean(packaged),
    getVersion: () => version || '1.2.0'
  };
}

function fakeAutoUpdater() {
  const emitter = new EventEmitter();
  emitter.autoDownload = false;
  emitter.autoInstallOnAppQuit = false;
  emitter.checkForUpdates = async () => {
    emitter.emit('checking-for-update');
  };
  emitter.quitAndInstall = () => {
    emitter.installed = true;
  };
  return emitter;
}

test('版本比较：正式版、预发布版和非法输入', () => {
  assert.equal(isNewerVersion('1.2.1', '1.2.0'), true);
  assert.equal(isNewerVersion('v1.3.0', '1.2.9'), true);
  assert.equal(isNewerVersion('2.0.0', '1.9.9'), true);
  assert.equal(isNewerVersion('1.2.0', '1.2.0'), false);
  assert.equal(isNewerVersion('1.1.9', '1.2.0'), false);
  assert.equal(isNewerVersion('1.2.0-beta.1', '1.2.0'), false);
  assert.equal(isNewerVersion('1.2.0', '1.2.0-beta.1'), true);
  assert.equal(isNewerVersion('不是版本号', '1.0.0'), false);
  assert.equal(parseVersion('v1.2.3').patch, 3);
  assert.equal(parseVersion('bad'), null);
});

test('仓库地址解析与发布链接', () => {
  assert.deepEqual(parseRepo(PACKAGE), { owner: 'Linyan30', repo: 'deepseek-pet' });
  assert.deepEqual(parseRepo({ repository: 'git@github.com:foo/bar.git' }), {
    owner: 'foo',
    repo: 'bar'
  });
  assert.equal(parseRepo({}), null);
  assert.equal(
    releaseApiUrl({ owner: 'a', repo: 'b' }),
    'https://api.github.com/repos/a/b/releases/latest'
  );
  assert.match(releasePageUrl({ owner: 'a', repo: 'b' }, 'v1.2.0'), /releases\/tag\/v1\.2\.0$/);
});

test('开发模式不检查更新', async () => {
  const bubbles = [];
  const updater = createUpdater({
    app: fakeApp(false),
    packageJson: PACKAGE,
    bubble: (text) => bubbles.push(text),
    env: {}
  });

  updater.init();
  assert.equal(updater.getState().phase, 'dev');
  const state = await updater.check({ manual: true });
  assert.equal(state.phase, 'dev');
  assert.ok(bubbles.some((text) => /开发模式/.test(text)));
});

test('便携版：查 GitHub Releases，发现新版本进入 manual 状态', async () => {
  const bubbles = [];
  let requestedUrl = '';
  const updater = createUpdater({
    app: fakeApp(true),
    env: { PORTABLE_EXECUTABLE_FILE: 'C:/apps/DeepSeekPet.exe' },
    packageJson: PACKAGE,
    bubble: (text) => bubbles.push(text),
    request: async (url) => {
      requestedUrl = url;
      return { status: 200, body: { tag_name: 'v1.3.0' } };
    }
  });

  updater.init();
  assert.equal(updater.getState().portable, true);

  const state = await updater.check({ manual: true });
  assert.equal(state.phase, 'manual');
  assert.equal(state.version, '1.3.0');
  assert.match(state.manualUrl, /releases\/tag\/v1\.3\.0$/);
  assert.match(requestedUrl, /api\.github\.com\/repos\/Linyan30\/deepseek-pet\/releases\/latest/);
  assert.ok(bubbles.length > 0);
});

test('便携版：已经是最新版本时只提示', async () => {
  const bubbles = [];
  const updater = createUpdater({
    app: fakeApp(true),
    env: { PORTABLE_EXECUTABLE_DIR: 'C:/apps' },
    packageJson: PACKAGE,
    bubble: (text) => bubbles.push(text),
    request: async () => ({ status: 200, body: { tag_name: 'v1.2.0' } })
  });

  const state = await updater.check({ manual: true });
  assert.equal(state.phase, 'idle');
  assert.ok(bubbles.some((text) => /最新/.test(text)));
});

test('便携版：检查失败会给出提示', async () => {
  const bubbles = [];
  const updater = createUpdater({
    app: fakeApp(true),
    env: { PORTABLE_EXECUTABLE_FILE: 'C:/apps/DeepSeekPet.exe' },
    packageJson: PACKAGE,
    bubble: (text) => bubbles.push(text),
    request: async () => {
      throw new Error('getaddrinfo ENOTFOUND api.github.com');
    }
  });

  const state = await updater.check({ manual: true });
  assert.equal(state.phase, 'error');
  assert.ok(bubbles.some((text) => /失败/.test(text)));
});

test('安装版：下载完成后可以重启安装', async () => {
  const fake = fakeAutoUpdater();
  const bubbles = [];
  const notifications = [];
  const updater = createUpdater({
    app: fakeApp(true),
    env: {},
    packageJson: PACKAGE,
    autoUpdaterFactory: () => fake,
    bubble: (text) => bubbles.push(text),
    notify: (title, body) => notifications.push({ title, body })
  });

  updater.init();
  await updater.check({ manual: true });

  fake.emit('update-available', { version: '1.3.0' });
  assert.equal(updater.getState().phase, 'downloading');

  fake.emit('download-progress', { percent: 42.6 });
  assert.equal(updater.getState().progress, 43);

  fake.emit('update-downloaded', { version: '1.3.0' });
  assert.equal(updater.getState().phase, 'ready');
  assert.equal(updater.installNow(), true);
  assert.equal(fake.installed, true);
  assert.ok(notifications.length > 0);
});

test('安装版：没有更新时回到 idle', async () => {
  const fake = fakeAutoUpdater();
  const bubbles = [];
  const updater = createUpdater({
    app: fakeApp(true),
    env: {},
    packageJson: PACKAGE,
    autoUpdaterFactory: () => fake,
    bubble: (text) => bubbles.push(text)
  });

  updater.init();
  await updater.check({ manual: true });
  fake.emit('update-not-available', {});
  assert.equal(updater.getState().phase, 'idle');
  assert.ok(bubbles.some((text) => /最新/.test(text)));
});

test('安装版：更新出错进入 error 状态', async () => {
  const fake = fakeAutoUpdater();
  const bubbles = [];
  const updater = createUpdater({
    app: fakeApp(true),
    env: {},
    packageJson: PACKAGE,
    autoUpdaterFactory: () => fake,
    bubble: (text) => bubbles.push(text)
  });

  updater.init();
  await updater.check({ manual: true });
  fake.emit('error', new Error('网络错误'));
  assert.equal(updater.getState().phase, 'error');
  assert.ok(bubbles.some((text) => /失败/.test(text)));
});

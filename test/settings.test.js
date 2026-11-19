'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  DEFAULT_SETTINGS,
  sanitizeSettings,
  loadSettings,
  saveSettings
} = require('../src/main/settings');

test('缺失配置文件时返回默认值', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-settings-'));
  const file = path.join(dir, 'settings.json');
  const settings = loadSettings(file);
  assert.deepEqual(settings, DEFAULT_SETTINGS);
});

test('损坏的 JSON 不会让程序崩溃', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-settings-'));
  const file = path.join(dir, 'settings.json');
  fs.writeFileSync(file, '{ 这不是 JSON', 'utf8');
  const settings = loadSettings(file);
  assert.equal(settings.petName, DEFAULT_SETTINGS.petName);
});

test('保存后可以原样读回', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-settings-'));
  const file = path.join(dir, 'settings.json');
  const saved = saveSettings(file, {
    petName: '鲸鲸',
    apiKey: 'sk-test',
    scale: 1.2,
    waterInterval: 90
  });
  const loaded = loadSettings(file);
  assert.deepEqual(loaded, saved);
  assert.equal(loaded.petName, '鲸鲸');
  assert.equal(loaded.scale, 1.2);
});

test('数值会被限制在合理范围', () => {
  const settings = sanitizeSettings({
    scale: 99,
    temperature: -5,
    waterInterval: 5,
    workMinutes: 999,
    breakMinutes: 0
  });
  assert.equal(settings.scale, 1.6);
  assert.equal(settings.temperature, 0);
  assert.equal(settings.waterInterval, 15);
  assert.equal(settings.workMinutes, 120);
  assert.equal(settings.breakMinutes, 1);
});

test('非法 Base URL 和未知字段会被丢弃', () => {
  const settings = sanitizeSettings({
    baseUrl: 'javascript:alert(1)',
    model: 'deepseek-chat',
    evil: 'hack',
    position: { x: 12, y: 34 }
  });
  assert.equal(settings.baseUrl, DEFAULT_SETTINGS.baseUrl);
  assert.equal('evil' in settings, false);
  assert.deepEqual(Object.keys(settings).sort(), Object.keys(DEFAULT_SETTINGS).sort());
  assert.deepEqual(settings.position, { x: 12, y: 34 });
});

test('Base URL 会去掉结尾斜杠，支持自定义代理', () => {
  const settings = sanitizeSettings({ baseUrl: 'https://my-proxy.example.com/v1/' });
  assert.equal(settings.baseUrl, 'https://my-proxy.example.com/v1');
});

test('position 支持负坐标（多显示器），异常值会被清空', () => {
  assert.deepEqual(sanitizeSettings({ position: { x: -1200, y: 40 } }).position, { x: -1200, y: 40 });
  assert.equal(sanitizeSettings({ position: { x: 999999, y: 0 } }).position, null);
  assert.equal(sanitizeSettings({ position: 'bad' }).position, null);
});

test('形象风格只接受 girl / whale', () => {
  assert.equal(sanitizeSettings({ petStyle: 'whale' }).petStyle, 'whale');
  assert.equal(sanitizeSettings({ petStyle: 'girl' }).petStyle, 'girl');
  assert.equal(sanitizeSettings({ petStyle: 'dragon' }).petStyle, 'girl');
  assert.equal(sanitizeSettings({}).petStyle, 'girl');
});

test('整点报时默认开启，可关闭', () => {
  assert.equal(sanitizeSettings({}).hourlyChime, true);
  assert.equal(sanitizeSettings({ hourlyChime: false }).hourlyChime, false);
  assert.equal(sanitizeSettings({ hourlyChime: 'no' }).hourlyChime, true);
});

test('漫游、记忆与语音的默认值', () => {
  const settings = sanitizeSettings({});
  assert.equal(settings.roaming, true);
  assert.equal(settings.followCursor, true);
  assert.equal(settings.memoryEnabled, true);
  assert.equal(settings.saveChatHistory, true);
  assert.equal(settings.voiceEnabled, false);
  assert.equal(settings.voiceRate, 1);

  assert.equal(sanitizeSettings({ roaming: false }).roaming, false);
  assert.equal(sanitizeSettings({ voiceEnabled: true, voiceRate: 9 }).voiceRate, 1.6);
  assert.equal(sanitizeSettings({ voiceRate: 0.1 }).voiceRate, 0.6);
});

test('自动检查更新默认开启', () => {
  assert.equal(sanitizeSettings({}).autoUpdate, true);
  assert.equal(sanitizeSettings({ autoUpdate: false }).autoUpdate, false);
  assert.equal(sanitizeSettings({ autoUpdate: 'no' }).autoUpdate, true);
});

test('联网搜索与图片模型配置校验', () => {
  const settings = sanitizeSettings({
    searchProvider: 'tavily',
    tavilyApiKey: '  tvly-x  ',
    searxngUrl: 'https://searx.example.com/',
    searchResults: 99,
    visionModel: 'gpt-4o',
    musicEnabled: false,
    musicResults: 5
  });
  assert.equal(settings.searchProvider, 'tavily');
  assert.equal(settings.tavilyApiKey, 'tvly-x');
  assert.equal(settings.searxngUrl, 'https://searx.example.com');
  assert.equal(settings.searchResults, 10);
  assert.equal(settings.visionModel, 'gpt-4o');
  assert.equal(settings.musicEnabled, false);
  assert.equal(settings.musicResults, 5);

  assert.equal(sanitizeSettings({ searchProvider: 'google' }).searchProvider, 'auto');
  assert.equal(sanitizeSettings({ searxngUrl: 'ftp://bad' }).searxngUrl, '');
});

test('API Key 只保留一份，且长度受限', () => {
  const settings = sanitizeSettings({ apiKey: `  sk-${'x'.repeat(1000)}  ` });
  assert.equal(settings.apiKey.length, 400);
  assert.equal(settings.apiKey.startsWith('sk-'), true);
});

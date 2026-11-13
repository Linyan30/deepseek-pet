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

test('API Key 只保留一份，且长度受限', () => {
  const settings = sanitizeSettings({ apiKey: `  sk-${'x'.repeat(1000)}  ` });
  assert.equal(settings.apiKey.length, 400);
  assert.equal(settings.apiKey.startsWith('sk-'), true);
});

'use strict';

const fs = require('node:fs');
const path = require('node:path');

/**
 * 默认配置。所有可写入磁盘的字段都必须在这里声明，
 * sanitizeSettings 会把用户文件里多余的键丢掉。
 */
const DEFAULT_SETTINGS = Object.freeze({
  apiKey: '',
  baseUrl: 'https://api.deepseek.com',
  model: 'deepseek-chat',
  temperature: 1,
  systemPrompt:
    '你是“小深”，一只住在用户电脑桌面上的 DeepSeek 小鲸鱼。你说话简短、软萌、有元气，回答默认不超过 3 句话；用户明确要求详细解释时再展开。回答用中文，可以偶尔用颜文字，但不要滥用。',
  petName: '小深',
  petStyle: 'girl',
  scale: 1,
  alwaysOnTop: true,
  autoLaunch: false,
  idleTalk: true,
  waterReminder: true,
  waterInterval: 60,
  workMinutes: 25,
  breakMinutes: 5,
  position: null
});

const LIMITS = Object.freeze({
  apiKey: 400,
  baseUrl: 300,
  model: 120,
  systemPrompt: 4000,
  petName: 24
});

function cloneDefaults() {
  return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
}

function cleanString(value, maxLength, fallback) {
  if (typeof value !== 'string') return fallback;
  return value.trim().slice(0, maxLength);
}

function cleanBool(value, fallback) {
  return typeof value === 'boolean' ? value : fallback;
}

function cleanNumber(value, min, max, fallback) {
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num)) return fallback;
  if (num < min) return min;
  if (num > max) return max;
  return Math.round(num * 100) / 100;
}

function cleanBaseUrl(value, fallback) {
  const raw = cleanString(value, LIMITS.baseUrl, fallback);
  const stripped = raw.replace(/\/+$/, '');
  if (!/^https?:\/\/[^\s/]+/i.test(stripped)) return fallback;
  try {
    // eslint-disable-next-line no-new
    new URL(stripped);
    return stripped;
  } catch {
    return fallback;
  }
}

function cleanPosition(value) {
  if (!value || typeof value !== 'object') return null;
  const x = Math.round(Number(value.x));
  const y = Math.round(Number(value.y));
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  // 允许负坐标（多显示器），但挡住明显异常的数值
  if (Math.abs(x) > 32000 || Math.abs(y) > 32000) return null;
  return { x, y };
}

/**
 * 把任意输入（来自磁盘或渲染进程）合并到一份合法配置上。
 * @param {object} input
 * @param {object} [base]
 */
function sanitizeSettings(input, base = DEFAULT_SETTINGS) {
  const source = input && typeof input === 'object' ? input : {};
  const result = {
    apiKey: cleanString(source.apiKey, LIMITS.apiKey, base.apiKey),
    baseUrl: cleanBaseUrl(source.baseUrl, base.baseUrl),
    model: cleanString(source.model, LIMITS.model, base.model) || base.model,
    temperature: cleanNumber(source.temperature, 0, 2, base.temperature),
    systemPrompt: cleanString(source.systemPrompt, LIMITS.systemPrompt, base.systemPrompt),
    petName: cleanString(source.petName, LIMITS.petName, base.petName) || base.petName,
    petStyle: source.petStyle === 'whale' ? 'whale' : 'girl',
    scale: cleanNumber(source.scale, 0.7, 1.6, base.scale),
    alwaysOnTop: cleanBool(source.alwaysOnTop, base.alwaysOnTop),
    autoLaunch: cleanBool(source.autoLaunch, base.autoLaunch),
    idleTalk: cleanBool(source.idleTalk, base.idleTalk),
    waterReminder: cleanBool(source.waterReminder, base.waterReminder),
    waterInterval: cleanNumber(source.waterInterval, 15, 240, base.waterInterval),
    workMinutes: cleanNumber(source.workMinutes, 1, 120, base.workMinutes),
    breakMinutes: cleanNumber(source.breakMinutes, 1, 60, base.breakMinutes),
    position: 'position' in source ? cleanPosition(source.position) : base.position
  };
  return result;
}

function loadSettings(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return sanitizeSettings(parsed);
  } catch (error) {
    if (error && error.code !== 'ENOENT') {
      console.warn('[settings] 读取配置失败，使用默认配置：', error.message);
    }
    return cloneDefaults();
  }
}

function saveSettings(filePath, settings) {
  const clean = sanitizeSettings(settings);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(clean, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, filePath);
  return clean;
}

module.exports = {
  DEFAULT_SETTINGS,
  cloneDefaults,
  sanitizeSettings,
  loadSettings,
  saveSettings
};

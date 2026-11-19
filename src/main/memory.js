'use strict';

const fs = require('node:fs');
const path = require('node:path');

const MAX_FACTS = 80;
const MAX_FACT_LENGTH = 160;
const MAX_MESSAGES = 240;
const MAX_MESSAGE_LENGTH = 6000;
const MAX_CONTEXT_FACTS = 12;

function cleanText(value, maxLength) {
  return String(value == null ? '' : value)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function writeJson(filePath, payload, logger) {
  const text = `${JSON.stringify(payload, null, 2)}\n`;
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tmp = `${filePath}.tmp`;
    fs.writeFileSync(tmp, text, 'utf8');
    try {
      fs.renameSync(tmp, filePath);
    } catch {
      fs.writeFileSync(filePath, text, 'utf8');
      try {
        fs.unlinkSync(tmp);
      } catch {
        /* 临时文件可能已被清理 */
      }
    }
  } catch (error) {
    logger.warn('[memory] 保存失败：', error.message);
  }
}

function readJson(filePath, fallback, logger) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    if (error && error.code !== 'ENOENT') {
      logger.warn('[memory] 读取失败，使用空数据：', error.message);
    }
    return fallback;
  }
}

/**
 * 长期记忆 + 聊天记录，全部存本地。
 * - memory.json：关于用户的事实，供每次聊天注入系统提示；
 * - chats.json：最近的对话，用于重启后恢复聊天窗口。
 */
function createMemoryStore(options) {
  const opts = options || {};
  const memoryFile = opts.memoryFile;
  const chatFile = opts.chatFile;
  const logger = opts.logger || console;
  const now = typeof opts.now === 'function' ? opts.now : () => new Date();

  function loadFacts() {
    const raw = readJson(memoryFile, { facts: [] }, logger);
    const list = raw && Array.isArray(raw.facts) ? raw.facts : [];
    return list
      .map((item) => {
        const text = cleanText(item && item.text, MAX_FACT_LENGTH);
        if (!text) return null;
        return {
          id: String((item && item.id) || `f-${text.length}-${text.slice(0, 8)}`),
          text,
          source: item && item.source === 'auto' ? 'auto' : 'manual',
          at: String((item && item.at) || '')
        };
      })
      .filter(Boolean)
      .slice(0, MAX_FACTS);
  }

  function loadMessages() {
    const raw = readJson(chatFile, { messages: [] }, logger);
    const list = raw && Array.isArray(raw.messages) ? raw.messages : [];
    return list
      .map((item) => {
        const content = cleanText(item && item.content, MAX_MESSAGE_LENGTH);
        if (!content) return null;
        const message = {
          role: item.role === 'assistant' ? 'assistant' : 'user',
          content,
          at: String((item && item.at) || '')
        };
        if (item && item.hasImage) message.hasImage = true;
        return message;
      })
      .filter(Boolean)
      .slice(-MAX_MESSAGES);
  }

  let facts = loadFacts();
  let messages = loadMessages();

  function saveFacts() {
    writeJson(memoryFile, { facts, updatedAt: now().toISOString() }, logger);
  }

  function saveMessages() {
    writeJson(chatFile, { messages, updatedAt: now().toISOString() }, logger);
  }

  function addFact(text, source) {
    const clean = cleanText(text, MAX_FACT_LENGTH);
    if (!clean) return null;

    const key = clean.toLowerCase();
    const existing = facts.find((fact) => fact.text.toLowerCase() === key);
    if (existing) return Object.assign({}, existing);

    const fact = {
      id: `f-${now().getTime()}-${Math.random().toString(36).slice(2, 7)}`,
      text: clean,
      source: source === 'auto' ? 'auto' : 'manual',
      at: now().toISOString()
    };
    facts.unshift(fact);
    if (facts.length > MAX_FACTS) facts = facts.slice(0, MAX_FACTS);
    saveFacts();
    return Object.assign({}, fact);
  }

  function removeFacts(keyword) {
    const target = cleanText(keyword, MAX_FACT_LENGTH).toLowerCase();
    if (!target) return 0;
    const before = facts.length;
    facts = facts.filter((fact) => !fact.text.toLowerCase().includes(target));
    if (facts.length !== before) saveFacts();
    return before - facts.length;
  }

  function listFacts() {
    return facts.map((fact) => Object.assign({}, fact));
  }

  function clearFacts() {
    facts = [];
    saveFacts();
  }

  function buildMemoryContext(limit) {
    const max = Math.max(1, Math.min(MAX_CONTEXT_FACTS, Number(limit) || MAX_CONTEXT_FACTS));
    const list = facts.slice(0, max);
    if (list.length === 0) return '';
    return [
      '以下是关于用户的长期记忆（可能过时，以用户当前的说法为准）：',
      ...list.map((fact) => `- ${fact.text}`)
    ].join('\n');
  }

  function appendMessage(role, content, meta) {
    const clean = cleanText(content, MAX_MESSAGE_LENGTH);
    if (!clean) return null;

    const message = {
      role: role === 'assistant' ? 'assistant' : 'user',
      content: clean,
      at: now().toISOString()
    };
    if (meta && meta.hasImage) message.hasImage = true;

    messages.push(message);
    if (messages.length > MAX_MESSAGES) messages = messages.slice(-MAX_MESSAGES);
    saveMessages();
    return Object.assign({}, message);
  }

  function listMessages() {
    return messages.map((message) => Object.assign({}, message));
  }

  function recentMessages(limit) {
    const count = Math.max(1, Math.min(MAX_MESSAGES, Number(limit) || 20));
    return messages.slice(-count).map((message) => Object.assign({}, message));
  }

  function clearMessages() {
    messages = [];
    saveMessages();
  }

  function stats() {
    return { facts: facts.length, messages: messages.length };
  }

  return {
    addFact,
    removeFacts,
    listFacts,
    clearFacts,
    buildMemoryContext,
    appendMessage,
    listMessages,
    recentMessages,
    clearMessages,
    stats,
    memoryFile,
    chatFile
  };
}

module.exports = {
  MAX_FACTS,
  MAX_MESSAGES,
  MAX_CONTEXT_FACTS,
  cleanText,
  createMemoryStore
};

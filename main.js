'use strict';

const path = require('node:path');
const {
  app,
  BrowserWindow,
  ipcMain,
  screen,
  Tray,
  Menu,
  nativeImage,
  shell,
  Notification,
  globalShortcut,
  clipboard
} = require('electron');

const { DEFAULT_SETTINGS, loadSettings, saveSettings, sanitizeSettings } = require('./src/main/settings');
const { streamChat, testConnection } = require('./src/main/chat');
const { Pomodoro, PHASE, formatClock } = require('./src/main/pomodoro');
const { createStateStore } = require('./src/main/state');
const { searchWeb, buildSearchContext } = require('./src/main/search');
const { searchMusic } = require('./src/main/music');
const { LINES, pick } = require('./src/shared/quips');
const { STICKERS, findSticker, randomSticker, maybeSticker } = require('./src/shared/stickers');
const { COMMANDS, findCommand, buildPrompt } = require('./src/shared/commands');
const {
  CHAT_SIZE,
  SETTINGS_SIZE,
  petSize,
  clampToWorkArea,
  resolvePetPosition,
  chatWindowPosition,
  centeredPosition
} = require('./src/main/windows');

const APP_ID = 'com.deepseek.pet';
const HOME_DIR = __dirname;
const TOGGLE_SHORTCUT = 'CommandOrControl+Shift+Alt+D';

// 固定 userData 目录名，避免开发模式（deepseek-pet）与打包版（DeepSeekPet）
// 使用两份不同的配置。必须在 requestSingleInstanceLock 之前设置。
try {
  app.setPath('userData', path.join(app.getPath('appData'), 'deepseek-pet'));
} catch {
  /* 某些平台不允许提前改路径时保持默认 */
}

let settings = { ...DEFAULT_SETTINGS };
let settingsFile = '';
let stateStore = null;
let stateFile = '';
let petWin = null;
let chatWin = null;
let settingsWin = null;
let tray = null;
let pomodoro = null;
let activeStream = null;
let waterTimer = null;
let idleTimer = null;
let chimeTimer = null;
let positionTimer = null;
let lastTickSecond = -1;
let lastBubbleText = '';
let lastBubbleAt = 0;
let lastStickerAt = 0;
let currentTrack = null;
let musicPlaying = false;
let lastMusicTrayUpdate = 0;

// ---------------------------------------------------------------- 基础工具

function isAlive(win) {
  return Boolean(win) && !win.isDestroyed();
}

function send(win, channel, payload) {
  if (!isAlive(win)) return;
  win.webContents.send(channel, payload);
}

function sendPet(channel, payload) {
  send(petWin, channel, payload);
}

function sendChat(channel, payload) {
  send(chatWin, channel, payload);
}

function sendSettings(channel, payload) {
  send(settingsWin, channel, payload);
}

/** 去掉 apiKey，给宠物和聊天窗口用。 */
function publicSettings() {
  const { apiKey, ...rest } = settings;
  return { ...rest, hasApiKey: Boolean(apiKey) };
}

function bubble(text, mood = 'happy', duration = 4200) {
  if (!text) return;
  const now = Date.now();
  if (text === lastBubbleText && now - lastBubbleAt < 1200) return;
  lastBubbleText = text;
  lastBubbleAt = now;
  sendPet('pet:bubble', { text, mood, duration });
}

function notify(title, body) {
  if (!Notification.isSupported()) return;
  try {
    new Notification({ title, body, silent: true }).show();
  } catch {
    /* 通知失败不影响主流程 */
  }
}

function persistPosition() {
  if (!isAlive(petWin)) return;
  clearTimeout(positionTimer);
  positionTimer = setTimeout(() => {
    if (!isAlive(petWin)) return;
    const bounds = petWin.getBounds();
    applySettings({ position: { x: bounds.x, y: bounds.y } }, { silent: true });
  }, 400);
}

// ---------------------------------------------------------------- 亲密度 / 表情包

function stateSnapshot() {
  const stickers = STICKERS.map((sticker) => ({
    id: sticker.id,
    file: sticker.file,
    caption: sticker.caption,
    minLevel: sticker.minLevel,
    unlocked: false
  }));

  if (!stateStore) {
    return {
      affinity: 0,
      level: 1,
      levelName: '初次见面',
      progress: 0,
      nextThreshold: 80,
      nextLevelName: '有点熟了',
      toNext: 80,
      stats: { pats: 0, chats: 0, pomodoros: 0, days: 0 },
      daily: { date: '', gained: 0, counts: {} },
      stickers
    };
  }

  const snapshot = stateStore.snapshot();
  stickers.forEach((sticker) => {
    sticker.unlocked = snapshot.level >= sticker.minLevel;
  });
  return { ...snapshot, stickers };
}

function broadcastState() {
  const snapshot = stateSnapshot();
  sendPet('state:changed', snapshot);
  sendChat('state:changed', snapshot);
  sendSettings('state:changed', snapshot);
  updateTrayMenu();
}

function announceLevelUp(snapshot) {
  bubble(`亲密度升到 Lv.${snapshot.level} 啦！`, 'love', 5600);
  sendStickerToPet('love', 3200);
  notify(`${settings.petName} · 亲密度提升`, `现在是 Lv.${snapshot.level}「${snapshot.levelName}」`);
}

/** 记录一次互动（摸头 / 聊天 / 完成番茄），到等级就庆祝。 */
function registerInteraction(type) {
  if (!stateStore) return null;
  const result = stateStore.add(type);
  if (result.added > 0) {
    broadcastState();
    if (result.leveledUp) announceLevelUp(result);
  }
  return result;
}

function sendStickerToPet(id, duration = 2600) {
  if (!findSticker(id)) return;
  sendPet('pet:sticker', { id, duration });
}

/** 回复完成后，有概率再补一张表情包（亲密度越高越常见）。 */
function maybeChatSticker(text) {
  if (!stateStore) return;
  const snapshot = stateStore.snapshot();
  const now = Date.now();
  if (now - lastStickerAt < 15000) return;

  const sticker = maybeSticker(text, snapshot.level);
  if (!sticker) return;

  lastStickerAt = now;
  sendChat('chat:sticker', { id: sticker.id, caption: sticker.caption });
}

function whenChatReady(callback) {
  if (!isAlive(chatWin)) return;
  if (chatWin.webContents.isLoading()) {
    chatWin.webContents.once('did-finish-load', callback);
  } else {
    callback();
  }
}

/** 托盘 / 右键菜单里的快捷指令：自动带上剪贴板内容。 */
function runQuickCommand(id) {
  const command = findCommand(id);
  if (!command) return;

  if (command.sticker) {
    const snapshot = stateSnapshot();
    const sticker = randomSticker(snapshot.level) || findSticker('happy');
    if (!sticker) return;
    openChat();
    whenChatReady(() => {
      sendChat('chat:sticker', { id: sticker.id, caption: sticker.caption });
      sendChat('chat:focus', {});
    });
    sendStickerToPet(sticker.id, 2600);
    bubble(sticker.caption, 'happy', 2400);
    return;
  }

  let content = '';
  try {
    content = String(clipboard.readText() || '').trim().slice(0, 4000);
  } catch {
    content = '';
  }

  const prompt = buildPrompt(command, content);
  openChat();
  whenChatReady(() => {
    sendChat('chat:prefill', {
      text: prompt,
      command: command.id,
      fromClipboard: Boolean(content)
    });
    sendChat('chat:focus', {});
  });
}

// ---------------------------------------------------------------- 设置生效

function applySettings(patch, { silent = false } = {}) {
  const previous = settings;
  const next = sanitizeSettings(patch, settings);
  settings = next;

  try {
    saveSettings(settingsFile, settings);
  } catch (error) {
    console.warn('[settings] 保存失败：', error.message);
  }

  if (next.scale !== previous.scale && isAlive(petWin)) {
    const { width, height } = petSize(next.scale);
    const bounds = petWin.getBounds();
    petWin.setZoomFactor(next.scale);
    const pos = clampToWorkArea(bounds.x, bounds.y, width, height);
    petWin.setBounds({ ...pos, width, height });
  }

  if (next.alwaysOnTop !== previous.alwaysOnTop) {
    applyAlwaysOnTop();
  }

  if (next.autoLaunch !== previous.autoLaunch) {
    applyAutoLaunch();
  }

  if (
    next.waterReminder !== previous.waterReminder ||
    next.waterInterval !== previous.waterInterval
  ) {
    scheduleWaterReminder();
  }

  if (next.idleTalk !== previous.idleTalk) {
    scheduleIdleTalk();
  }

  if (next.hourlyChime !== previous.hourlyChime) {
    scheduleHourlyChime();
  }

  if (
    next.workMinutes !== previous.workMinutes ||
    next.breakMinutes !== previous.breakMinutes
  ) {
    pomodoro.setDurations(next.workMinutes, next.breakMinutes);
  }

  if (!silent) {
    sendPet('settings:changed', publicSettings());
    sendChat('settings:changed', publicSettings());
  }
  updateTrayMenu();

  return settings;
}

function applyAlwaysOnTop() {
  const level = 'floating';
  [petWin, chatWin].forEach((win) => {
    if (!isAlive(win)) return;
    win.setAlwaysOnTop(settings.alwaysOnTop, level);
    if (process.platform === 'darwin') {
      win.setVisibleOnAllWorkspaces(settings.alwaysOnTop, { visibleOnFullScreen: true });
    }
  });
}

function applyAutoLaunch() {
  if (process.platform !== 'win32' && process.platform !== 'darwin') return;
  try {
    app.setLoginItemSettings({ openAtLogin: settings.autoLaunch, args: [] });
  } catch (error) {
    console.warn('[autoLaunch] 设置失败：', error.message);
  }
}

// ---------------------------------------------------------------- 窗口

function createPetWindow() {
  const { width, height } = petSize(settings.scale);
  const position = resolvePetPosition(settings.position, width, height);

  petWin = new BrowserWindow({
    ...position,
    width,
    height,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    alwaysOnTop: settings.alwaysOnTop,
    title: 'DeepSeek 小鲸鱼',
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(HOME_DIR, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required',
      zoomFactor: settings.scale
    }
  });

  petWin.setAlwaysOnTop(settings.alwaysOnTop, 'floating');
  petWin.setIgnoreMouseEvents(true, { forward: true });
  if (process.platform === 'darwin') {
    petWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }

  petWin.loadFile(path.join(HOME_DIR, 'src/renderer/pet.html'));

  petWin.once('ready-to-show', () => {
    petWin.showInactive();
  });

  petWin.on('moved', persistPosition);
  petWin.on('closed', () => {
    petWin = null;
  });

  petWin.webContents.on('render-process-gone', () => {
    // 渲染进程崩了就重建，保持“宠物一直在”的体验
    if (!app.isQuitting) {
      setTimeout(() => {
        if (!isAlive(petWin)) createPetWindow();
      }, 800);
    }
  });
}

function ensureChatWindow() {
  if (isAlive(chatWin)) return chatWin;
  const position = isAlive(petWin)
    ? chatWindowPosition(petWin.getBounds())
    : centeredPosition(CHAT_SIZE.width, CHAT_SIZE.height);

  chatWin = new BrowserWindow({
    width: CHAT_SIZE.width,
    height: CHAT_SIZE.height,
    x: position.x,
    y: position.y,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    hasShadow: false,
    show: false,
    skipTaskbar: false,
    alwaysOnTop: settings.alwaysOnTop,
    title: '和小鲸鱼聊天',
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(HOME_DIR, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  });

  chatWin.setAlwaysOnTop(settings.alwaysOnTop, 'floating');
  chatWin.loadFile(path.join(HOME_DIR, 'src/renderer/chat.html'));

  chatWin.once('ready-to-show', () => {
    chatWin.show();
    chatWin.focus();
  });

  chatWin.on('closed', () => {
    chatWin = null;
    if (activeStream) {
      activeStream.abort();
      activeStream = null;
    }
  });

  chatWin.webContents.on('did-finish-load', () => {
    sendChat('settings:changed', publicSettings());
    sendChat('state:changed', stateSnapshot());
  });

  return chatWin;
}

function ensureSettingsWindow() {
  if (isAlive(settingsWin)) return settingsWin;
  const position = centeredPosition(SETTINGS_SIZE.width, SETTINGS_SIZE.height);

  settingsWin = new BrowserWindow({
    width: SETTINGS_SIZE.width,
    height: SETTINGS_SIZE.height,
    x: position.x,
    y: position.y,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    hasShadow: false,
    show: false,
    title: '小鲸鱼设置',
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(HOME_DIR, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  });

  settingsWin.loadFile(path.join(HOME_DIR, 'src/renderer/settings.html'));

  settingsWin.once('ready-to-show', () => {
    settingsWin.show();
    settingsWin.focus();
  });

  settingsWin.on('closed', () => {
    settingsWin = null;
  });

  return settingsWin;
}

function openChat() {
  const win = ensureChatWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  whenChatReady(() => sendChat('chat:focus', {}));
}

function openSettings() {
  const win = ensureSettingsWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  sendSettings('settings:changed-full', { ...settings });
}

function showPet() {
  if (!isAlive(petWin)) {
    createPetWindow();
    return;
  }
  petWin.showInactive();
}

function togglePet() {
  if (!isAlive(petWin)) {
    createPetWindow();
    return;
  }
  if (petWin.isVisible()) {
    petWin.hide();
  } else {
    petWin.showInactive();
  }
}

function quitApp() {
  app.isQuitting = true;
  try {
    globalShortcut.unregisterAll();
    if (pomodoro) pomodoro.dispose();
    clearTimeout(waterTimer);
    clearTimeout(idleTimer);
    clearTimeout(chimeTimer);
    clearTimeout(positionTimer);
    if (activeStream) activeStream.abort();
  } catch {
    /* 退出阶段忽略清理错误 */
  }
  app.quit();
}

// ---------------------------------------------------------------- 托盘

function updateTrayMenu() {
  if (!tray) return;
  const snapshot = pomodoro ? pomodoro.snapshot() : null;
  const timerLabel = snapshot && snapshot.running
    ? `番茄钟 ${formatClock(snapshot.remaining)}`
    : '番茄钟';
  const affinity = stateSnapshot();

  const template = [
    {
      label: '和小鲸鱼聊天',
      click: () => openChat()
    },
    {
      label: isAlive(petWin) && petWin.isVisible() ? '隐藏小鲸鱼' : '显示小鲸鱼',
      click: () => togglePet()
    },
    { type: 'separator' },
    {
      label: `亲密度 Lv.${affinity.level} · ${affinity.affinity}`,
      enabled: false
    },
    {
      label: timerLabel,
      submenu: [
        {
          label: snapshot && snapshot.running ? '暂停' : '开始专注',
          click: () => {
            if (pomodoro) {
              pomodoro.toggle();
              sendPet('pomodoro:tick', pomodoro.snapshot());
              updateTrayMenu();
            }
          }
        },
        {
          label: '重置',
          click: () => {
            if (pomodoro) {
              pomodoro.reset();
              sendPet('pomodoro:tick', pomodoro.snapshot());
              updateTrayMenu();
            }
          }
        }
      ]
    },
    {
      label: '快捷指令',
      submenu: COMMANDS.map((command) => ({
        label: `${command.icon} ${command.label}`,
        click: () => runQuickCommand(command.id)
      }))
    },
    {
      label: '整点报时',
      type: 'checkbox',
      checked: settings.hourlyChime,
      click: (item) => applySettings({ hourlyChime: item.checked })
    },
    {
      label: '喝水提醒',
      type: 'checkbox',
      checked: settings.waterReminder,
      click: (item) => applySettings({ waterReminder: item.checked })
    },
    {
      label: '偶尔说说话',
      type: 'checkbox',
      checked: settings.idleTalk,
      click: (item) => {
        applySettings({ idleTalk: item.checked });
        scheduleIdleTalk();
      }
    },
    { type: 'separator' },
    { label: '设置…', click: () => openSettings() },
    { type: 'separator' },
    { label: '退出', click: () => quitApp() }
  ];

  tray.setContextMenu(Menu.buildFromTemplate(template));
  let tip = `${settings.petName} · Lv.${affinity.level} · 点我聊天`;
  if (snapshot && snapshot.running) {
    tip = `${settings.petName} · Lv.${affinity.level} · 番茄钟 ${formatClock(snapshot.remaining)}`;
  }
  tray.setToolTip(tip);
}

function createTray() {
  const iconPath = path.join(HOME_DIR, 'src', 'renderer', 'assets', 'tray.png');
  let image = nativeImage.createFromPath(iconPath);
  if (image.isEmpty()) {
    image = nativeImage.createEmpty();
  } else {
    image = image.resize({ width: 32, height: 32 });
  }
  tray = new Tray(image);
  updateTrayMenu();
  tray.on('click', () => openChat());
  tray.on('double-click', () => openChat());
}

// ---------------------------------------------------------------- 小功能定时器

function scheduleWaterReminder() {
  clearTimeout(waterTimer);
  if (!settings.waterReminder) return;
  const delay = Math.max(1, settings.waterInterval) * 60 * 1000;
  waterTimer = setTimeout(() => {
    bubble(pick(LINES.water), 'happy', 6000);
    scheduleWaterReminder();
  }, delay);
}

function scheduleIdleTalk() {
  clearTimeout(idleTimer);
  if (!settings.idleTalk) return;
  const delay = (180 + Math.floor(Math.random() * 300)) * 1000; // 3 ~ 8 分钟
  idleTimer = setTimeout(() => {
    const chatFocused = isAlive(chatWin) && chatWin.isFocused();
    if (!chatFocused && isAlive(petWin) && petWin.isVisible()) {
      bubble(pick(LINES.idle), 'idle', 5000);
    }
    scheduleIdleTalk();
  }, delay);
}

/** 整点报时的文案：几点 + 问候 + 到点提醒。 */
function chimeText(date) {
  const hour = date.getHours();
  const time = `${String(hour).padStart(2, '0')}:00`;
  let part = '晚上好';
  if (hour < 5) part = '夜深了';
  else if (hour < 11) part = '上午好';
  else if (hour < 14) part = '中午好';
  else if (hour < 18) part = '下午好';

  const extras = {
    9: '该开始今天的第一件事啦',
    12: '记得吃午饭',
    15: '起来活动一下肩颈',
    18: '该吃晚饭啦',
    23: '早点睡，别熬夜'
  };
  const extra = extras[hour] || '';
  return `现在是 ${time}，${part}～${extra ? ` ${extra}` : ''}`;
}

/** 对齐到下一个整点，避免定时器漂移；系统睡眠唤醒后会重新对齐。 */
function scheduleHourlyChime() {
  clearTimeout(chimeTimer);
  chimeTimer = null;
  if (!settings.hourlyChime) return;

  const now = new Date();
  const next = new Date(now.getTime());
  next.setMinutes(0, 0, 0);
  next.setHours(next.getHours() + 1);
  const delay = Math.max(5000, next.getTime() - now.getTime() + 800);

  chimeTimer = setTimeout(() => {
    chimeTimer = null;
    if (isAlive(petWin) && petWin.isVisible()) {
      bubble(chimeText(new Date()), 'idle', 5600);
    }
    scheduleHourlyChime();
  }, delay);
}

function startPomodoro() {
  pomodoro = new Pomodoro({
    workMinutes: settings.workMinutes,
    breakMinutes: settings.breakMinutes,
    onTick: (snapshot) => {
      const second = Math.ceil(snapshot.remaining);
      if (second === lastTickSecond) return;
      lastTickSecond = second;
      sendPet('pomodoro:tick', snapshot);
      if (snapshot.running) updateTrayMenu();
    },
    onPhaseEnd: (phase) => {
      if (phase === PHASE.WORK) {
        bubble(pick(LINES.workEnd), 'happy', 7000);
        notify(settings.petName, pick(LINES.workEnd));
        registerInteraction('pomodoro');
      } else {
        bubble(pick(LINES.breakEnd), 'idle', 6000);
        notify(settings.petName, pick(LINES.breakEnd));
      }
      lastTickSecond = -1;
      updateTrayMenu();
    }
  });
}

// ---------------------------------------------------------------- 聊天

const MAX_IMAGE_CHARS = 8 * 1024 * 1024;
const IMAGE_DATA_URL = /^data:image\/(?:png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=\s]+$/;

function sanitizeMessages(input) {
  if (!Array.isArray(input)) return [];
  return input
    .slice(-24)
    .filter((item) => item && typeof item.content === 'string')
    .map((item) => {
      const message = {
        role: item.role === 'assistant' ? 'assistant' : 'user',
        content: item.content.trim().slice(0, 8000)
      };
      if (
        typeof item.image === 'string' &&
        item.image.length <= MAX_IMAGE_CHARS &&
        IMAGE_DATA_URL.test(item.image)
      ) {
        message.image = item.image;
      }
      return message;
    })
    .filter((item) => item.content.length > 0 || item.image);
}

/** 转成 OpenAI 多模态格式；只保留最后一张图，避免上下文过大。 */
function toApiMessages(messages) {
  let lastImageIndex = -1;
  messages.forEach((message, index) => {
    if (message.image) lastImageIndex = index;
  });

  return messages.map((message, index) => {
    if (!message.image) {
      return { role: message.role, content: message.content };
    }
    if (index === lastImageIndex) {
      return {
        role: message.role,
        content: [
          { type: 'text', text: message.content || '请看看这张图片。' },
          { type: 'image_url', image_url: { url: message.image } }
        ]
      };
    }
    return { role: message.role, content: `${message.content}\n（这张图片已省略）` };
  });
}

function offlineReply(userText) {
  const text = pick(LINES.offline);
  let index = 0;
  const timer = setInterval(() => {
    if (!isAlive(chatWin)) {
      clearInterval(timer);
      return;
    }
    index = Math.min(text.length, index + 2);
    sendChat('chat:delta', { delta: text.slice(index - 2, index) });
    if (index >= text.length) {
      clearInterval(timer);
      sendChat('chat:done', { offline: true });
      maybeChatSticker(userText);
    }
  }, 45);
  return {
    abort() {
      clearInterval(timer);
      sendChat('chat:done', { offline: true, aborted: true });
    }
  };
}

async function handleChatSend(event, payload) {
  if (!isAlive(chatWin) || event.sender.id !== chatWin.webContents.id) return;
  const messages = sanitizeMessages(payload && payload.messages);
  if (messages.length === 0) return;
  const lastMessage = messages[messages.length - 1];
  const userText = lastMessage.content || '（发了一张图片）';
  const hasImage = messages.some((message) => Boolean(message.image));

  registerInteraction('chat');

  if (activeStream) {
    activeStream.abort();
    activeStream = null;
  }

  // 需要联网时先搜索，再把结果作为上下文交给模型（发图片时不搜）
  let searchPayload = null;
  if (payload && payload.search && !hasImage) {
    const result = await searchWeb({ settings, query: userText, limit: settings.searchResults });
    searchPayload = {
      query: userText,
      provider: result.provider,
      results: result.results,
      answer: result.answer,
      error: result.error || ''
    };
    sendChat('chat:search', searchPayload);
  }

  if (!settings.apiKey) {
    activeStream = offlineReply(userText);
    return;
  }

  const withSystem = [{ role: 'system', content: settings.systemPrompt }];
  if (searchPayload && searchPayload.results.length > 0) {
    withSystem.push({
      role: 'system',
      content:
        `下面是刚刚联网搜索到的资料（${new Date().toLocaleString()}）。` +
        '回答时优先使用这些资料，并在引用处用 [1] [2] 这样的序号标注来源；资料不足时直接说明。\n\n' +
        buildSearchContext(searchPayload)
    });
  }
  withSystem.push(...toApiMessages(messages));

  // 发图片时优先用「图片识别模型」，没填就用主模型
  const requestSettings =
    hasImage && settings.visionModel ? { ...settings, model: settings.visionModel } : settings;

  let produced = false;
  activeStream = streamChat({
    settings: requestSettings,
    messages: withSystem,
    onDelta: (delta) => {
      produced = true;
      sendChat('chat:delta', { delta });
    },
    onReasoning: (delta) => {
      sendChat('chat:reasoning', { delta });
    },
    onDone: () => {
      activeStream = null;
      sendChat('chat:done', {});
      if (produced) bubble('✨', 'happy', 1600);
      maybeChatSticker(userText);
    },
    onError: (message) => {
      activeStream = null;
      const hint =
        hasImage && !settings.visionModel
          ? '\n当前模型可能不支持图片。可以在设置里填写「图片识别模型」，或换一个支持视觉的接口。'
          : '';
      sendChat('chat:error', { message: `${message}${hint}` });
      bubble('呜呜，我连不上服务器…', 'sleepy', 5000);
    }
  });
}

// ---------------------------------------------------------------- 右键菜单

function showPetMenu(event) {
  if (!isAlive(petWin) || event.sender.id !== petWin.webContents.id) return;
  const affinity = stateSnapshot();
  const menu = Menu.buildFromTemplate([
    { label: '和小鲸鱼聊天', click: () => openChat() },
    {
      label: '摸摸头',
      click: () => {
        registerInteraction('pat');
        bubble(pick(LINES.click), 'happy', 3000);
        sendPet('pet:pat', {});
      }
    },
    {
      label: '快捷指令',
      submenu: COMMANDS.map((command) => ({
        label: `${command.icon} ${command.label}`,
        click: () => runQuickCommand(command.id)
      }))
    },
    { type: 'separator' },
    {
      label: `亲密度 Lv.${affinity.level} · ${affinity.affinity}（${affinity.levelName}）`,
      enabled: false
    },
    {
      label: '番茄钟',
      submenu: [
        {
          label: pomodoro && pomodoro.running ? '暂停' : '开始专注',
          click: () => {
            if (pomodoro) {
              pomodoro.toggle();
              sendPet('pomodoro:tick', pomodoro.snapshot());
              updateTrayMenu();
            }
          }
        },
        {
          label: '重置',
          click: () => {
            if (pomodoro) {
              pomodoro.reset();
              sendPet('pomodoro:tick', pomodoro.snapshot());
              updateTrayMenu();
            }
          }
        }
      ]
    },
    {
      label: '整点报时',
      type: 'checkbox',
      checked: settings.hourlyChime,
      click: (item) => applySettings({ hourlyChime: item.checked })
    },
    {
      label: '喝水提醒',
      type: 'checkbox',
      checked: settings.waterReminder,
      click: (item) => applySettings({ waterReminder: item.checked })
    },
    { type: 'separator' },
    { label: '设置…', click: () => openSettings() },
    { label: '藏起来', click: () => petWin.hide() },
    { label: '退出', click: () => quitApp() }
  ]);
  menu.popup({ window: petWin });
}

// ---------------------------------------------------------------- IPC

function registerIpc() {
  ipcMain.handle('app:version', () => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    platform: process.platform
  }));

  ipcMain.handle('settings:get', (event) => {
    if (isAlive(settingsWin) && event.sender.id === settingsWin.webContents.id) {
      return { ...settings };
    }
    return publicSettings();
  });

  ipcMain.handle('settings:save', (event, patch) => {
    if (!isAlive(settingsWin) || event.sender.id !== settingsWin.webContents.id) {
      return { ok: false, message: '无权修改设置' };
    }
    if (!patch || typeof patch !== 'object') {
      return { ok: false, message: '参数不正确' };
    }
    applySettings(patch);
    bubble('设置好啦～', 'happy', 2600);
    return { ok: true, settings: { ...settings } };
  });

  ipcMain.handle('pet:quips', () => LINES);

  ipcMain.handle('state:get', (event) => {
    const allowed = [petWin, chatWin, settingsWin].some(
      (win) => isAlive(win) && event.sender.id === win.webContents.id
    );
    if (!allowed) return null;
    return stateSnapshot();
  });

  ipcMain.on('state:interact', (event, type) => {
    if (!isAlive(petWin) || event.sender.id !== petWin.webContents.id) return;
    if (type !== 'pat') return;
    const result = registerInteraction('pat');
    const level = stateStore ? stateStore.snapshot().level : 1;
    if (result && result.added > 0 && level >= 2 && Math.random() < 0.25) {
      const sticker = randomSticker(level);
      if (sticker) sendStickerToPet(sticker.id, 2200);
    }
  });

  ipcMain.handle('clipboard:read', (event) => {
    if (!isAlive(chatWin) || event.sender.id !== chatWin.webContents.id) return '';
    try {
      return String(clipboard.readText() || '').slice(0, 4000);
    } catch {
      return '';
    }
  });

  ipcMain.on('sticker:random', (event) => {
    if (!isAlive(chatWin) || event.sender.id !== chatWin.webContents.id) return;
    const level = stateStore ? stateStore.snapshot().level : 1;
    const sticker = randomSticker(level) || findSticker('happy');
    if (!sticker) return;
    sendChat('chat:sticker', { id: sticker.id, caption: sticker.caption });
    sendStickerToPet(sticker.id, 2400);
  });

  ipcMain.handle('search:web', async (event, query) => {
    if (!isAlive(chatWin) || event.sender.id !== chatWin.webContents.id) {
      return { ok: false, provider: 'none', query: '', results: [], answer: '', error: '无权操作' };
    }
    const text = String(query || '').trim().slice(0, 300);
    if (!text) {
      return { ok: false, provider: 'none', query: '', results: [], answer: '', error: '搜索内容不能为空' };
    }
    return searchWeb({ settings, query: text, limit: settings.searchResults });
  });

  ipcMain.handle('search:test', async (event, payload) => {
    if (!isAlive(settingsWin) || event.sender.id !== settingsWin.webContents.id) {
      return { ok: false, provider: 'none', results: [], answer: '', error: '无权操作' };
    }
    const draft = sanitizeSettings({ ...settings, ...(payload || {}) });
    const query = String((payload && payload.query) || 'DeepSeek').slice(0, 100);
    return searchWeb({ settings: draft, query, limit: 3 });
  });

  ipcMain.handle('search:music', async (event, query) => {
    if (!isAlive(chatWin) || event.sender.id !== chatWin.webContents.id) {
      return { ok: false, query: '', source: 'none', results: [], error: '无权操作' };
    }
    if (!settings.musicEnabled) {
      return { ok: false, query: '', source: 'none', results: [], error: '音乐功能已在设置里关闭' };
    }
    const text = String(query || '').trim().slice(0, 200);
    if (!text) {
      return { ok: false, query: '', source: 'none', results: [], error: '想听什么歌？' };
    }
    return searchMusic({ query: text, limit: settings.musicResults });
  });

  ipcMain.on('music:play', (event, track) => {
    if (!isAlive(chatWin) || event.sender.id !== chatWin.webContents.id) return;
    if (!settings.musicEnabled) return;
    if (!track || typeof track !== 'object') return;

    const preview = String(track.preview || '');
    if (!/^https?:\/\//i.test(preview)) return;

    currentTrack = {
      title: String(track.title || '未知歌曲').slice(0, 120),
      artist: String(track.artist || '').slice(0, 80),
      cover: /^https?:\/\//i.test(String(track.cover || '')) ? String(track.cover) : '',
      preview,
      duration: Math.max(1, Math.min(600, Number(track.duration) || 30)),
      source: String(track.source || '').slice(0, 20)
    };
    musicPlaying = true;

    sendPet('music:play', { track: currentTrack });
    sendChat('music:state', {
      playing: true,
      currentTime: 0,
      duration: currentTrack.duration,
      track: currentTrack
    });
    updateTrayMenu();
  });

  ipcMain.on('music:command', (event, action) => {
    const fromChat = isAlive(chatWin) && event.sender.id === chatWin.webContents.id;
    const fromPet = isAlive(petWin) && event.sender.id === petWin.webContents.id;
    if (!fromChat && !fromPet) return;

    const command = ['toggle', 'pause', 'resume', 'stop'].includes(action) ? action : 'toggle';
    if (command === 'stop') {
      musicPlaying = false;
      currentTrack = null;
      sendChat('music:state', { playing: false, stopped: true });
      updateTrayMenu();
    }
    sendPet('music:command', { action: command });
  });

  ipcMain.on('music:state', (event, state) => {
    if (!isAlive(petWin) || event.sender.id !== petWin.webContents.id) return;
    const payload = state && typeof state === 'object' ? state : {};
    const wasPlaying = musicPlaying;
    if (typeof payload.playing === 'boolean') musicPlaying = payload.playing;
    if (payload.track && typeof payload.track === 'object') {
      currentTrack = { ...currentTrack, ...payload.track };
    }
    sendChat('music:state', payload);
    if (wasPlaying !== musicPlaying) updateTrayMenu();
  });

  ipcMain.handle('api:test', async (event, patch) => {
    if (!isAlive(settingsWin) || event.sender.id !== settingsWin.webContents.id) {
      return { ok: false, message: '无权操作', models: [] };
    }
    const draft = sanitizeSettings({ ...settings, ...(patch || {}) });
    if (!draft.apiKey) {
      return { ok: false, message: '还没填 API Key 呢。', models: [] };
    }
    return testConnection(draft);
  });

  ipcMain.on('pet:mouse-ignore', (event, ignore) => {
    if (!isAlive(petWin) || event.sender.id !== petWin.webContents.id) return;
    petWin.setIgnoreMouseEvents(Boolean(ignore), { forward: true });
  });

  ipcMain.on('pet:drag', (event, delta) => {
    if (!isAlive(petWin) || event.sender.id !== petWin.webContents.id) return;
    if (!delta || !Number.isFinite(delta.dx) || !Number.isFinite(delta.dy)) return;
    const bounds = petWin.getBounds();
    petWin.setPosition(Math.round(bounds.x + delta.dx), Math.round(bounds.y + delta.dy));
  });

  ipcMain.on('pet:drag-end', (event) => {
    if (!isAlive(petWin) || event.sender.id !== petWin.webContents.id) return;
    persistPosition();
  });

  ipcMain.on('pet:context-menu', (event) => showPetMenu(event));
  ipcMain.on('pet:hide', () => {
    if (isAlive(petWin)) petWin.hide();
  });

  ipcMain.on('window:chat', () => openChat());
  ipcMain.on('window:settings', () => openSettings());

  ipcMain.on('window:action', (event, action) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!isAlive(win) || win !== chatWin && win !== settingsWin) return;
    if (action === 'close') win.close();
    if (action === 'minimize') win.minimize();
  });

  ipcMain.on('app:quit', () => quitApp());

  ipcMain.on('shell:open', (event, url) => {
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return;
    shell.openExternal(url).catch(() => {});
  });

  ipcMain.on('chat:send', (event, payload) => handleChatSend(event, payload));

  ipcMain.on('chat:abort', (event) => {
    if (!isAlive(chatWin) || event.sender.id !== chatWin.webContents.id) return;
    if (activeStream) {
      activeStream.abort();
      activeStream = null;
    } else {
      sendChat('chat:done', { aborted: true });
    }
  });

  ipcMain.on('pomodoro:command', (event, command) => {
    if (!isAlive(petWin) || event.sender.id !== petWin.webContents.id) return;
    if (!pomodoro) return;
    if (command === 'start') pomodoro.start();
    else if (command === 'pause') pomodoro.pause();
    else if (command === 'reset') pomodoro.reset();
    else if (command === 'toggle') pomodoro.toggle();
    sendPet('pomodoro:tick', pomodoro.snapshot());
    updateTrayMenu();
  });

  ipcMain.handle('pomodoro:state', () => (pomodoro ? pomodoro.snapshot() : null));
}

// ---------------------------------------------------------------- 生命周期

const gotLock = app.requestSingleInstanceLock();

if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    showPet();
    openChat();
  });

  app.on('web-contents-created', (_event, contents) => {
    contents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//i.test(url)) shell.openExternal(url).catch(() => {});
      return { action: 'deny' };
    });
    contents.on('will-navigate', (event, url) => {
      const allowed = ['file://', 'devtools://'];
      if (!allowed.some((prefix) => url.startsWith(prefix))) {
        event.preventDefault();
      }
    });
  });

  app.whenReady().then(() => {
    app.setAppUserModelId(APP_ID);
    settingsFile = path.join(app.getPath('userData'), 'settings.json');
    settings = loadSettings(settingsFile);
    stateFile = path.join(path.dirname(settingsFile), 'state.json');
    stateStore = createStateStore(stateFile);

    startPomodoro();
    registerIpc();
    createPetWindow();
    createTray();
    scheduleWaterReminder();
    scheduleIdleTalk();
    scheduleHourlyChime();
    applyAutoLaunch();
    stateStore.greet();
    broadcastState();

    try {
      globalShortcut.register(TOGGLE_SHORTCUT, () => togglePet());
    } catch {
      /* 快捷键被占用时忽略 */
    }

    if (process.argv.includes('--dev')) {
      petWin.webContents.openDevTools({ mode: 'detach' });
    }
  });

  app.on('activate', () => {
    if (!isAlive(petWin)) createPetWindow();
    else petWin.showInactive();
  });

  app.on('window-all-closed', () => {
    // 托盘常驻应用：关闭窗口不退出，交给托盘菜单
  });

  app.on('before-quit', () => {
    app.isQuitting = true;
    if (pomodoro) pomodoro.dispose();
    clearTimeout(waterTimer);
    clearTimeout(idleTimer);
    clearTimeout(chimeTimer);
    clearTimeout(positionTimer);
  });
}

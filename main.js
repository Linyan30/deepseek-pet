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
  globalShortcut
} = require('electron');

const { DEFAULT_SETTINGS, loadSettings, saveSettings, sanitizeSettings } = require('./src/main/settings');
const { streamChat, testConnection } = require('./src/main/chat');
const { Pomodoro, PHASE, formatClock } = require('./src/main/pomodoro');
const { LINES, pick } = require('./src/shared/quips');
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
let petWin = null;
let chatWin = null;
let settingsWin = null;
let tray = null;
let pomodoro = null;
let activeStream = null;
let waterTimer = null;
let idleTimer = null;
let positionTimer = null;
let lastTickSecond = -1;
let lastBubbleText = '';
let lastBubbleAt = 0;

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
  if (win.webContents.isLoading()) {
    win.webContents.once('did-finish-load', () => {
      sendChat('chat:focus', {});
    });
  } else {
    sendChat('chat:focus', {});
  }
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
  const tip = snapshot && snapshot.running
    ? `${settings.petName} · 番茄钟 ${formatClock(snapshot.remaining)}`
    : `${settings.petName} · 点我聊天`;
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

function sanitizeMessages(input) {
  if (!Array.isArray(input)) return [];
  return input
    .slice(-24)
    .filter((item) => item && typeof item.content === 'string')
    .map((item) => ({
      role: item.role === 'assistant' ? 'assistant' : 'user',
      content: item.content.trim().slice(0, 8000)
    }))
    .filter((item) => item.content.length > 0);
}

function offlineReply() {
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
    }
  }, 45);
  return {
    abort() {
      clearInterval(timer);
      sendChat('chat:done', { offline: true, aborted: true });
    }
  };
}

function handleChatSend(event, payload) {
  if (!isAlive(chatWin) || event.sender.id !== chatWin.webContents.id) return;
  const messages = sanitizeMessages(payload && payload.messages);
  if (messages.length === 0) return;

  if (activeStream) {
    activeStream.abort();
    activeStream = null;
  }

  if (!settings.apiKey) {
    activeStream = offlineReply();
    return;
  }

  const withSystem = [
    { role: 'system', content: settings.systemPrompt },
    ...messages
  ];

  let produced = false;
  activeStream = streamChat({
    settings,
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
    },
    onError: (message) => {
      activeStream = null;
      sendChat('chat:error', { message });
      bubble('呜呜，我连不上服务器…', 'sleepy', 5000);
    }
  });
}

// ---------------------------------------------------------------- 右键菜单

function showPetMenu(event) {
  if (!isAlive(petWin) || event.sender.id !== petWin.webContents.id) return;
  const menu = Menu.buildFromTemplate([
    { label: '和小鲸鱼聊天', click: () => openChat() },
    {
      label: '摸摸头',
      click: () => {
        bubble(pick(LINES.click), 'happy', 3000);
        sendPet('pet:pat', {});
      }
    },
    { type: 'separator' },
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

    startPomodoro();
    registerIpc();
    createPetWindow();
    createTray();
    scheduleWaterReminder();
    scheduleIdleTalk();
    applyAutoLaunch();

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
    clearTimeout(positionTimer);
  });
}

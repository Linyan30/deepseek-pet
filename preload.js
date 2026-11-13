'use strict';

const { contextBridge, ipcRenderer } = require('electron');

function on(channel) {
  return (callback) => {
    if (typeof callback !== 'function') return () => {};
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  };
}

contextBridge.exposeInMainWorld('api', {
  platform: process.platform,

  // 设置
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (patch) => ipcRenderer.invoke('settings:save', patch),
  testApi: (patch) => ipcRenderer.invoke('api:test', patch),
  getVersion: () => ipcRenderer.invoke('app:version'),
  getQuips: () => ipcRenderer.invoke('pet:quips'),

  // 亲密度 / 表情包 / 剪贴板
  getState: () => ipcRenderer.invoke('state:get'),
  reportPat: () => ipcRenderer.send('state:interact', 'pat'),
  readClipboard: () => ipcRenderer.invoke('clipboard:read'),
  requestSticker: () => ipcRenderer.send('sticker:random'),
  onStateChanged: on('state:changed'),
  onChatSticker: on('chat:sticker'),
  onChatPrefill: on('chat:prefill'),
  onPetSticker: on('pet:sticker'),

  // 联网搜索 / 音乐
  searchWeb: (query) => ipcRenderer.invoke('search:web', query),
  searchMusic: (query) => ipcRenderer.invoke('search:music', query),
  testSearch: (patch, query) => ipcRenderer.invoke('search:test', { ...(patch || {}), query }),
  playMusic: (track) => ipcRenderer.send('music:play', track),
  musicCommand: (action) => ipcRenderer.send('music:command', action),
  musicState: (payload) => ipcRenderer.send('music:state', payload),
  onMusicPlay: on('music:play'),
  onMusicCommand: on('music:command'),
  onMusicState: on('music:state'),
  onChatSearch: on('chat:search'),

  // 宠物窗口
  setIgnoreMouse: (ignore) => ipcRenderer.send('pet:mouse-ignore', Boolean(ignore)),
  dragBy: (dx, dy) => ipcRenderer.send('pet:drag', { dx, dy }),
  dragEnd: () => ipcRenderer.send('pet:drag-end'),
  petMenu: () => ipcRenderer.send('pet:context-menu'),
  hidePet: () => ipcRenderer.send('pet:hide'),

  // 聊天
  // 兼容两种调用方式：直接传消息数组，或传 { messages, search }
  sendChat: (payload) => {
    const normalized = Array.isArray(payload) ? { messages: payload } : payload || { messages: [] };
    ipcRenderer.send('chat:send', normalized);
  },
  abortChat: () => ipcRenderer.send('chat:abort'),
  onChatDelta: on('chat:delta'),
  onChatReasoning: on('chat:reasoning'),
  onChatDone: on('chat:done'),
  onChatError: on('chat:error'),
  onChatFocus: on('chat:focus'),

  // 番茄钟
  pomodoroCommand: (command) => ipcRenderer.send('pomodoro:command', command),
  pomodoroState: () => ipcRenderer.invoke('pomodoro:state'),
  onPomodoroTick: on('pomodoro:tick'),

  // 通用事件
  onBubble: on('pet:bubble'),
  onPat: on('pet:pat'),
  onSettingsChanged: on('settings:changed'),

  // 窗口与系统
  openChat: () => ipcRenderer.send('window:chat'),
  openSettings: () => ipcRenderer.send('window:settings'),
  windowAction: (action) => ipcRenderer.send('window:action', action),
  openExternal: (url) => ipcRenderer.send('shell:open', url),
  quit: () => ipcRenderer.send('app:quit')
});

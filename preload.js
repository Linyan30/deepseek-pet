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

  // 宠物窗口
  setIgnoreMouse: (ignore) => ipcRenderer.send('pet:mouse-ignore', Boolean(ignore)),
  dragBy: (dx, dy) => ipcRenderer.send('pet:drag', { dx, dy }),
  dragEnd: () => ipcRenderer.send('pet:drag-end'),
  petMenu: () => ipcRenderer.send('pet:context-menu'),
  hidePet: () => ipcRenderer.send('pet:hide'),

  // 聊天
  sendChat: (messages) => ipcRenderer.send('chat:send', { messages }),
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

'use strict';

/**
 * 浏览器预览用的假 API。
 * 直接在 Chrome 里打开 src/renderer/*.html 时可以看界面效果，
 * Electron 里 window.api 由 preload.js 注入，不会用到这个文件。
 */
(function (root) {
  const DEFAULTS = {
    apiKey: '',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-chat',
    temperature: 1,
    systemPrompt: '你是小深，一只住在桌面上的 DeepSeek 小鲸鱼。',
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
    position: null,
    hasApiKey: false
  };

  const DEMO_LINES = {
    idle: ['今天也要好好写代码哦～', '有点想喝水……你也一起？'],
    click: ['咕噜咕噜～', '摸摸头，喜欢！', '嘿嘿，痒痒的。'],
    happy: ['耶！', '开心到喷水～'],
    water: ['该喝水啦，去接一杯吧～'],
    workStart: ['番茄钟开始，先专注 25 分钟吧！'],
    workEnd: ['叮！这一颗番茄熟啦，休息一下～'],
    breakEnd: ['休息结束，回来继续吗？'],
    offline: ['我还没连上大模型呢，先去设置里填个 API Key 吧～'],
    thinking: ['让我想想……']
  };

  const listeners = new Map();

  function on(channel) {
    return (callback) => {
      if (typeof callback !== 'function') return () => {};
      if (!listeners.has(channel)) listeners.set(channel, new Set());
      listeners.get(channel).add(callback);
      return () => listeners.get(channel).delete(callback);
    };
  }

  function emit(channel, payload) {
    const set = listeners.get(channel);
    if (!set) return;
    set.forEach((callback) => callback(payload));
  }

  function createPreviewApi() {
    let settings = { ...DEFAULTS };

    return {
      platform: 'browser',
      demo: true,
      getSettings: async () => ({ ...settings }),
      saveSettings: async (patch) => {
        settings = { ...settings, ...(patch || {}), hasApiKey: Boolean((patch || {}).apiKey || settings.apiKey) };
        emit('settings:changed', settings);
        return { ok: true, settings: { ...settings } };
      },
      testApi: async () => ({ ok: false, message: '浏览器预览模式无法连接 API。', models: [] }),
      getVersion: async () => ({ version: '1.0.0', electron: 'preview', platform: 'browser' }),
      getQuips: async () => DEMO_LINES,
      setIgnoreMouse: () => {},
      dragBy: () => {},
      dragEnd: () => {},
      petMenu: () => window.alert('预览模式：右键菜单只在应用里可用'),
      hidePet: () => {},
      sendChat: (messages) => {
        const last = Array.isArray(messages) ? messages[messages.length - 1] : null;
        const text = `（预览）收到：${last ? last.content : ''} —— 在真正的应用里，这里会显示 DeepSeek 的流式回答。`;
        let index = 0;
        const timer = setInterval(() => {
          index = Math.min(text.length, index + 2);
          emit('chat:delta', { delta: text.slice(index - 2, index) });
          if (index >= text.length) {
            clearInterval(timer);
            emit('chat:done', {});
          }
        }, 40);
      },
      abortChat: () => emit('chat:done', { aborted: true }),
      onChatDelta: on('chat:delta'),
      onChatReasoning: on('chat:reasoning'),
      onChatDone: on('chat:done'),
      onChatError: on('chat:error'),
      onChatFocus: on('chat:focus'),
      pomodoroCommand: () => {},
      pomodoroState: async () => ({ phase: 'idle', running: false, remaining: 1500, total: 1500 }),
      onPomodoroTick: on('pomodoro:tick'),
      onBubble: on('pet:bubble'),
      onPat: on('pet:pat'),
      onSettingsChanged: on('settings:changed'),
      openChat: () => {},
      openSettings: () => {},
      windowAction: (action) => {
        if (action === 'close') window.close();
      },
      openExternal: (url) => window.open(url, '_blank', 'noopener'),
      quit: () => {}
    };
  }

  root.createPreviewApi = createPreviewApi;
})(window);

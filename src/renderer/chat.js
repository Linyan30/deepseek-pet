'use strict';

(function () {
  const api = window.api || window.createPreviewApi();
  const md = window.DSMarkdown || {
    renderMarkdownLite: (text) => String(text == null ? '' : text),
    escapeHtml: (text) => String(text == null ? '' : text)
  };

  const els = {
    petName: document.getElementById('pet-name'),
    status: document.getElementById('status'),
    messages: document.getElementById('messages'),
    welcome: document.getElementById('welcome'),
    chips: document.getElementById('chips'),
    banner: document.getElementById('banner'),
    bannerText: document.getElementById('banner-text'),
    bannerAction: document.getElementById('banner-action'),
    input: document.getElementById('input'),
    send: document.getElementById('send'),
    composer: document.getElementById('composer'),
    btnNew: document.getElementById('btn-new'),
    btnSettings: document.getElementById('btn-settings'),
    btnClose: document.getElementById('btn-close')
  };

  let settings = { petName: '小深', hasApiKey: false, model: 'deepseek-chat' };
  let history = [];
  let streaming = false;
  let current = null;
  let rafId = 0;
  let bannerHandler = null;

  // ------------------------------------------------------------ 界面状态

  function setStatus(text, busy) {
    els.status.textContent = text;
    els.status.classList.toggle('busy', Boolean(busy));
  }

  function showBanner(text, actionLabel, handler) {
    els.bannerText.textContent = text;
    if (actionLabel && handler) {
      els.bannerAction.style.display = '';
      els.bannerAction.textContent = actionLabel;
      bannerHandler = handler;
    } else {
      els.bannerAction.style.display = 'none';
      bannerHandler = null;
    }
    els.banner.classList.remove('hidden');
  }

  function hideBanner() {
    els.banner.classList.add('hidden');
    bannerHandler = null;
  }

  function scrollToBottom() {
    els.messages.scrollTop = els.messages.scrollHeight;
  }

  function setStreamingUI(on) {
    els.send.textContent = on ? '■' : '➤';
    els.send.classList.toggle('stopping', on);
    els.send.title = on ? '停止生成' : '发送';
    els.send.setAttribute('aria-label', on ? '停止生成' : '发送');
  }

  // ------------------------------------------------------------ 消息渲染

  function createMessageNode(role) {
    const wrap = document.createElement('div');
    wrap.className = `msg ${role}`;

    let items;
    if (role === 'assistant') {
      const avatar = document.createElement('img');
      avatar.className = 'who';
      avatar.src = 'assets/avatar.svg';
      avatar.alt = '';
      wrap.appendChild(avatar);

      items = document.createElement('div');
      items.className = 'msg-items';
      wrap.appendChild(items);
    } else {
      items = document.createElement('div');
      items.className = 'msg-items';
      wrap.appendChild(items);
    }

    const text = document.createElement('div');
    text.className = 'text';
    items.appendChild(text);

    els.messages.appendChild(wrap);
    scrollToBottom();

    return { wrap, items, text };
  }

  function appendMessage(role, content) {
    const node = createMessageNode(role);
    node.text.innerHTML = md.renderMarkdownLite(content);
    scrollToBottom();
    return node;
  }

  /** 用户输入按纯文本渲染，避免把用户打的星号、尖括号当成格式。 */
  function appendUserMessage(text) {
    const node = createMessageNode('user');
    node.text.textContent = text;
    scrollToBottom();
    return node;
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      /* file:// 下可能没有 clipboard API，退回 execCommand */
    }
    try {
      const helper = document.createElement('textarea');
      helper.value = text;
      helper.style.position = 'fixed';
      helper.style.opacity = '0';
      helper.style.pointerEvents = 'none';
      document.body.appendChild(helper);
      helper.select();
      const ok = document.execCommand('copy');
      helper.remove();
      return ok;
    } catch {
      return false;
    }
  }

  function addCopyButton(node) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'copy-btn';
    button.textContent = '复制';
    button.addEventListener('click', async () => {
      const ok = await copyText(node.text.innerText);
      button.textContent = ok ? '已复制' : '复制失败';
      setTimeout(() => {
        button.textContent = '复制';
      }, 1400);
    });
    node.items.appendChild(button);
  }

  function addReasoning(node) {
    if (node.reason) return node.reason;
    const details = document.createElement('details');
    details.className = 'reason';
    const summary = document.createElement('summary');
    summary.textContent = '深度思考';
    const body = document.createElement('div');
    body.className = 'reason-body';
    details.appendChild(summary);
    details.appendChild(body);
    node.items.insertBefore(details, node.text);
    node.reason = details;
    node.reasonBody = body;
    return details;
  }

  function scheduleRender() {
    if (rafId) return;
    rafId = window.requestAnimationFrame(() => {
      rafId = 0;
      if (!current) return;
      current.node.text.innerHTML = md.renderMarkdownLite(current.text);
      scrollToBottom();
    });
  }

  // ------------------------------------------------------------ 发送与流式接收

  function finish(payload) {
    if (!streaming) return;
    streaming = false;
    setStreamingUI(false);
    const offline = Boolean(payload && payload.offline);
    setStatus(offline ? '未配置 API Key' : '在线');

    if (!current) {
      els.input.focus();
      return;
    }

    const node = current.node;
    node.text.classList.remove('typing');
    const content = current.text.trim();

    if (content) {
      node.text.innerHTML = md.renderMarkdownLite(content);
      history.push({ role: 'assistant', content });
      if (history.length > 24) history = history.slice(-24);
      addCopyButton(node);
    } else {
      node.text.classList.add('error');
      node.text.textContent = '（这次没有收到内容，再试一次？）';
    }

    current = null;
    scrollToBottom();
    els.input.focus();
  }

  function send() {
    if (streaming) return;
    const text = els.input.value.trim();
    if (!text) return;

    els.input.value = '';
    autoResize();
    hideBanner();
    els.welcome.classList.add('hidden');

    appendUserMessage(text);
    history.push({ role: 'user', content: text });
    if (history.length > 20) history = history.slice(-20);

    const node = createMessageNode('assistant');
    node.text.classList.add('typing');
    current = { node, text: '', reasoning: '' };

    streaming = true;
    setStreamingUI(true);
    setStatus('正在思考…', true);

    api.sendChat(history.slice());
  }

  function abort() {
    if (!streaming) return;
    api.abortChat();
  }

  function resetConversation() {
    if (streaming) abort();
    history = [];
    current = null;
    streaming = false;
    setStreamingUI(false);
    setStatus(settings.hasApiKey ? '在线' : '未配置 API Key');

    els.messages.querySelectorAll('.msg').forEach((node) => node.remove());
    els.welcome.classList.remove('hidden');
    hideBanner();
    els.input.value = '';
    autoResize();
    els.input.focus();

    if (!settings.hasApiKey) {
      showBanner('还没配置 API Key，先去设置里填一下吧～', '去设置', () => api.openSettings());
    }
  }

  function autoResize() {
    els.input.style.height = 'auto';
    const next = Math.min(96, Math.max(34, els.input.scrollHeight));
    els.input.style.height = `${next}px`;
  }

  // ------------------------------------------------------------ 事件绑定

  els.composer.addEventListener('submit', (event) => {
    event.preventDefault();
    if (streaming) abort();
    else send();
  });

  els.send.addEventListener('click', (event) => {
    if (streaming) {
      event.preventDefault();
      abort();
    }
  });

  els.input.addEventListener('input', autoResize);

  els.input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      send();
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      window.api && window.api.windowAction('close');
    }
  });

  els.chips.addEventListener('click', (event) => {
    const button = event.target.closest('[data-prompt]');
    if (!button) return;
    els.input.value = button.dataset.prompt;
    autoResize();
    send();
  });

  els.bannerAction.addEventListener('click', () => {
    if (bannerHandler) bannerHandler();
  });

  els.btnNew.addEventListener('click', resetConversation);
  els.btnSettings.addEventListener('click', () => api.openSettings());
  els.btnClose.addEventListener('click', () => api.windowAction('close'));

  // ------------------------------------------------------------ 主进程事件

  api.onChatDelta((payload) => {
    if (!streaming || !current || !payload) return;
    current.text += payload.delta || '';
    scheduleRender();
  });

  api.onChatReasoning((payload) => {
    if (!streaming || !current || !payload) return;
    addReasoning(current.node);
    current.reasoning += payload.delta || '';
    if (current.node.reasonBody) {
      current.node.reasonBody.textContent = current.reasoning;
    }
    scrollToBottom();
  });

  api.onChatDone((payload) => finish(payload));

  api.onChatError((payload) => {
    if (!streaming) return;
    streaming = false;
    setStreamingUI(false);
    setStatus('连接出错了');

    const message = (payload && payload.message) || '出了点小问题，再试一次？';
    if (current) {
      current.node.text.classList.remove('typing');
      if (!current.text.trim()) {
        current.node.text.classList.add('error');
        current.node.text.textContent = message;
      } else {
        const note = document.createElement('div');
        note.className = 'text error';
        note.textContent = message;
        current.node.items.appendChild(note);
      }
      current = null;
    }
    showBanner(message, '去设置', () => api.openSettings());
    els.input.focus();
  });

  api.onChatFocus(() => {
    els.input.focus();
  });

  api.onSettingsChanged((next) => {
    if (!next) return;
    settings = Object.assign({}, settings, next);
    applySettingsToUi();
  });

  function applySettingsToUi() {
    els.petName.textContent = settings.petName || '小深';
    document.title = `${settings.petName || '小鲸鱼'} · 聊天`;
    if (!streaming) {
      setStatus(settings.hasApiKey ? '在线' : '未配置 API Key');
    }
    if (settings.hasApiKey) {
      if (els.bannerText.textContent && els.bannerText.textContent.includes('API Key')) hideBanner();
    }
  }

  // ------------------------------------------------------------ 启动

  async function boot() {
    try {
      const loaded = await api.getSettings();
      if (loaded) settings = Object.assign(settings, loaded);
    } catch {
      /* 用默认值兜底 */
    }

    applySettingsToUi();

    if (!settings.hasApiKey) {
      showBanner('还没有配置 API Key，聊天的内容会用内置台词回复。', '去设置', () => api.openSettings());
    }

    const params = new URLSearchParams(window.location.search);
    if (params.get('demo') === '1') {
      settings.hasApiKey = true;
      applySettingsToUi();
      hideBanner();
      els.welcome.classList.add('hidden');
      appendMessage('user', '你好呀，小鲸鱼！');
      appendMessage(
        'assistant',
        '你好！我是**小深**，一只住在桌面上的 DeepSeek 小鲸鱼 🐳\n有什么可以帮你的吗？'
      );
      appendMessage('user', '帮我起一个读配置文件的小函数名');
      appendMessage(
        'assistant',
        '试试 **`loadConfig`**，简单直接；\n如果想强调“带默认值”，可以叫 **`loadConfigWithDefaults`**；\n函数式一点的话，**`readConfig`** 也很常见。'
      );
      els.messages.querySelectorAll('.msg.assistant').forEach((node) => {
        if (node.textContent) {
          const copy = document.createElement('button');
          copy.type = 'button';
          copy.className = 'copy-btn';
          copy.textContent = '复制';
          node.querySelector('.msg-items').appendChild(copy);
        }
      });
      scrollToBottom();
    }

    els.input.focus();
  }

  boot();
})();

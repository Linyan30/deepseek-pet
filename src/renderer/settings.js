'use strict';

(function () {
  const api = window.api || window.createPreviewApi();

  const els = {
    petName: document.getElementById('petName'),
    petStyle: document.getElementById('petStyle'),
    scale: document.getElementById('scale'),
    scaleValue: document.getElementById('scale-value'),
    alwaysOnTop: document.getElementById('alwaysOnTop'),
    autoLaunch: document.getElementById('autoLaunch'),
    idleTalk: document.getElementById('idleTalk'),
    hourlyChime: document.getElementById('hourlyChime'),
    apiKey: document.getElementById('apiKey'),
    toggleKey: document.getElementById('toggle-key'),
    baseUrl: document.getElementById('baseUrl'),
    model: document.getElementById('model'),
    visionModel: document.getElementById('visionModel'),
    temperature: document.getElementById('temperature'),
    temperatureValue: document.getElementById('temperature-value'),
    systemPrompt: document.getElementById('systemPrompt'),
    waterReminder: document.getElementById('waterReminder'),
    waterInterval: document.getElementById('waterInterval'),
    workMinutes: document.getElementById('workMinutes'),
    breakMinutes: document.getElementById('breakMinutes'),
    searchProvider: document.getElementById('searchProvider'),
    tavilyApiKey: document.getElementById('tavilyApiKey'),
    searxngUrl: document.getElementById('searxngUrl'),
    searchResults: document.getElementById('searchResults'),
    tavilyField: document.getElementById('tavily-field'),
    searxngField: document.getElementById('searxng-field'),
    btnTestSearch: document.getElementById('btn-test-search'),
    searchTestResult: document.getElementById('search-test-result'),
    testResult: document.getElementById('test-result'),
    btnTest: document.getElementById('btn-test'),
    btnSave: document.getElementById('btn-save'),
    btnCancel: document.getElementById('btn-cancel'),
    btnClose: document.getElementById('btn-close'),
    getKey: document.getElementById('get-key'),
    version: document.getElementById('version'),
    affinityLevel: document.getElementById('affinity-level'),
    affinityScore: document.getElementById('affinity-score'),
    affinityBar: document.getElementById('affinity-bar'),
    affinityStats: document.getElementById('affinity-stats'),
    stickerGrid: document.getElementById('sticker-grid'),
    toast: document.getElementById('toast')
  };

  let toastTimer = 0;

  function toast(text) {
    els.toast.textContent = text;
    els.toast.classList.add('show');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => els.toast.classList.remove('show'), 1800);
  }

  function setScaleLabel() {
    const value = Number(els.scale.value);
    els.scaleValue.textContent = `${Math.round(value * 100)}%`;
  }

  function setTemperatureLabel() {
    els.temperatureValue.textContent = Number(els.temperature.value).toFixed(1);
  }

  function syncSearchFields() {
    const provider = els.searchProvider.value;
    els.tavilyField.style.display = provider === 'tavily' ? '' : 'none';
    els.searxngField.style.display = provider === 'searxng' ? '' : 'none';
  }

  function fill(settings) {
    els.petName.value = settings.petName || '小深';
    els.petStyle.value = settings.petStyle === 'whale' ? 'whale' : 'girl';
    els.scale.value = String(settings.scale || 1);
    els.alwaysOnTop.checked = Boolean(settings.alwaysOnTop);
    els.autoLaunch.checked = Boolean(settings.autoLaunch);
    els.idleTalk.checked = Boolean(settings.idleTalk);
    els.hourlyChime.checked = Boolean(settings.hourlyChime);
    els.apiKey.value = settings.apiKey || '';
    els.baseUrl.value = settings.baseUrl || 'https://api.deepseek.com';
    els.model.value = settings.model || 'deepseek-chat';
    els.visionModel.value = settings.visionModel || '';
    els.temperature.value = String(settings.temperature == null ? 1 : settings.temperature);
    els.systemPrompt.value = settings.systemPrompt || '';
    els.waterReminder.checked = Boolean(settings.waterReminder);
    els.waterInterval.value = String(settings.waterInterval || 60);
    els.workMinutes.value = String(settings.workMinutes || 25);
    els.breakMinutes.value = String(settings.breakMinutes || 5);
    els.searchProvider.value = settings.searchProvider || 'auto';
    els.tavilyApiKey.value = settings.tavilyApiKey || '';
    els.searxngUrl.value = settings.searxngUrl || '';
    els.searchResults.value = String(settings.searchResults || 5);
    syncSearchFields();
    setScaleLabel();
    setTemperatureLabel();
  }

  function collect() {
    return {
      petName: els.petName.value.trim() || '小深',
      petStyle: els.petStyle.value === 'whale' ? 'whale' : 'girl',
      scale: Number(els.scale.value),
      alwaysOnTop: els.alwaysOnTop.checked,
      autoLaunch: els.autoLaunch.checked,
      idleTalk: els.idleTalk.checked,
      hourlyChime: els.hourlyChime.checked,
      apiKey: els.apiKey.value.trim(),
      baseUrl: els.baseUrl.value.trim() || 'https://api.deepseek.com',
      model: els.model.value.trim() || 'deepseek-chat',
      visionModel: els.visionModel.value.trim(),
      temperature: Number(els.temperature.value),
      systemPrompt: els.systemPrompt.value.trim(),
      waterReminder: els.waterReminder.checked,
      waterInterval: Number(els.waterInterval.value),
      workMinutes: Number(els.workMinutes.value),
      breakMinutes: Number(els.breakMinutes.value),
      searchProvider: els.searchProvider.value,
      tavilyApiKey: els.tavilyApiKey.value.trim(),
      searxngUrl: els.searxngUrl.value.trim(),
      searchResults: Number(els.searchResults.value)
    };
  }

  function showTestResult(ok, message, models) {
    els.testResult.className = `test-result show ${ok ? 'ok' : 'bad'}`;
    const suffix = Array.isArray(models) && models.length ? ` 可用模型：${models.join('、')}` : '';
    els.testResult.textContent = `${message}${suffix}`;
  }

  els.scale.addEventListener('input', setScaleLabel);
  els.temperature.addEventListener('input', setTemperatureLabel);
  els.searchProvider.addEventListener('change', syncSearchFields);

  els.toggleKey.addEventListener('click', () => {
    const showing = els.apiKey.type === 'text';
    els.apiKey.type = showing ? 'password' : 'text';
    els.toggleKey.textContent = showing ? '显示' : '隐藏';
  });

  els.getKey.addEventListener('click', (event) => {
    event.preventDefault();
    api.openExternal('https://platform.deepseek.com/api_keys');
  });

  function showSearchTest(ok, message) {
    els.searchTestResult.className = `test-result show ${ok ? 'ok' : 'bad'}`;
    els.searchTestResult.textContent = message;
  }

  els.btnTestSearch.addEventListener('click', async () => {
    els.btnTestSearch.disabled = true;
    els.btnTestSearch.textContent = '搜索中…';
    try {
      const result = await api.testSearch(collect(), 'DeepSeek');
      if (result && result.ok) {
        const count = Array.isArray(result.results) ? result.results.length : 0;
        showSearchTest(true, `搜索成功（${result.provider}），拿到 ${count} 条结果。`);
      } else {
        showSearchTest(false, (result && result.error) || '搜索失败。');
      }
    } catch {
      showSearchTest(false, '测试失败，请重试。');
    } finally {
      els.btnTestSearch.disabled = false;
      els.btnTestSearch.textContent = '测试搜索';
    }
  });

  els.btnTest.addEventListener('click', async () => {
    const patch = collect();
    if (!patch.apiKey) {
      showTestResult(false, '先填一个 API Key 吧。', []);
      return;
    }
    els.btnTest.disabled = true;
    els.btnTest.textContent = '测试中…';
    try {
      const result = await api.testApi({ apiKey: patch.apiKey, baseUrl: patch.baseUrl });
      showTestResult(Boolean(result && result.ok), (result && result.message) || '没有返回结果', result && result.models);
    } catch (error) {
      showTestResult(false, error && error.message ? error.message : '测试失败', []);
    } finally {
      els.btnTest.disabled = false;
      els.btnTest.textContent = '测试连接';
    }
  });

  els.btnSave.addEventListener('click', async () => {
    els.btnSave.disabled = true;
    try {
      const result = await api.saveSettings(collect());
      if (result && result.ok === false) {
        toast(result.message || '保存失败');
      } else {
        toast('已保存');
      }
    } catch (error) {
      toast('保存失败，请重试');
    } finally {
      els.btnSave.disabled = false;
    }
  });

  function close() {
    api.windowAction('close');
  }

  els.btnCancel.addEventListener('click', close);
  els.btnClose.addEventListener('click', close);

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  });

  // ------------------------------------------------------------ 亲密度展示

  function renderState(state) {
    if (!state || !state.level) return;
    els.affinityLevel.textContent = `Lv.${state.level} ${state.levelName || ''}`.trim();
    els.affinityScore.textContent = state.nextThreshold
      ? `${state.affinity} / ${state.nextThreshold}`
      : `${state.affinity} · 已满级`;
    els.affinityBar.style.width = `${Math.round((state.progress || 0) * 100)}%`;

    const stats = state.stats || {};
    const chips = [
      `摸头 ${stats.pats || 0}`,
      `聊天 ${stats.chats || 0}`,
      `番茄 ${stats.pomodoros || 0}`,
      `陪伴 ${stats.days || 0} 天`
    ];
    els.affinityStats.innerHTML = '';
    chips.forEach((text) => {
      const chip = document.createElement('span');
      chip.className = 'stat-chip';
      chip.textContent = text;
      els.affinityStats.appendChild(chip);
    });

    els.stickerGrid.innerHTML = '';
    (state.stickers || []).forEach((sticker) => {
      const item = document.createElement('div');
      item.className = `sticker-item${sticker.unlocked ? '' : ' locked'}`;
      item.title = sticker.unlocked ? sticker.caption : `Lv.${sticker.minLevel} 解锁`;

      const image = document.createElement('img');
      image.src = `assets/stickers/${sticker.file}`;
      image.alt = sticker.caption;
      image.loading = 'lazy';

      item.appendChild(image);

      if (!sticker.unlocked) {
        const caption = document.createElement('span');
        caption.className = 'sticker-caption';
        caption.textContent = `Lv.${sticker.minLevel} 解锁`;
        item.appendChild(caption);
      }

      els.stickerGrid.appendChild(item);
    });
  }

  api.onStateChanged((state) => renderState(state));

  async function boot() {
    try {
      const settings = await api.getSettings();
      if (settings) fill(settings);
    } catch {
      /* 保持空表单 */
    }

    try {
      renderState(await api.getState());
    } catch {
      /* 预览或旧版本没有亲密度接口 */
    }

    try {
      const info = await api.getVersion();
      if (info) {
        els.version.textContent = `v${info.version} · Electron ${info.electron}`;
      }
    } catch {
      /* 忽略 */
    }
  }

  boot();
})();

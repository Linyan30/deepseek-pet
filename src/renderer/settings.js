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
    apiKey: document.getElementById('apiKey'),
    toggleKey: document.getElementById('toggle-key'),
    baseUrl: document.getElementById('baseUrl'),
    model: document.getElementById('model'),
    temperature: document.getElementById('temperature'),
    temperatureValue: document.getElementById('temperature-value'),
    systemPrompt: document.getElementById('systemPrompt'),
    waterReminder: document.getElementById('waterReminder'),
    waterInterval: document.getElementById('waterInterval'),
    workMinutes: document.getElementById('workMinutes'),
    breakMinutes: document.getElementById('breakMinutes'),
    testResult: document.getElementById('test-result'),
    btnTest: document.getElementById('btn-test'),
    btnSave: document.getElementById('btn-save'),
    btnCancel: document.getElementById('btn-cancel'),
    btnClose: document.getElementById('btn-close'),
    getKey: document.getElementById('get-key'),
    version: document.getElementById('version'),
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

  function fill(settings) {
    els.petName.value = settings.petName || '小深';
    els.petStyle.value = settings.petStyle === 'whale' ? 'whale' : 'girl';
    els.scale.value = String(settings.scale || 1);
    els.alwaysOnTop.checked = Boolean(settings.alwaysOnTop);
    els.autoLaunch.checked = Boolean(settings.autoLaunch);
    els.idleTalk.checked = Boolean(settings.idleTalk);
    els.apiKey.value = settings.apiKey || '';
    els.baseUrl.value = settings.baseUrl || 'https://api.deepseek.com';
    els.model.value = settings.model || 'deepseek-chat';
    els.temperature.value = String(settings.temperature == null ? 1 : settings.temperature);
    els.systemPrompt.value = settings.systemPrompt || '';
    els.waterReminder.checked = Boolean(settings.waterReminder);
    els.waterInterval.value = String(settings.waterInterval || 60);
    els.workMinutes.value = String(settings.workMinutes || 25);
    els.breakMinutes.value = String(settings.breakMinutes || 5);
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
      apiKey: els.apiKey.value.trim(),
      baseUrl: els.baseUrl.value.trim() || 'https://api.deepseek.com',
      model: els.model.value.trim() || 'deepseek-chat',
      temperature: Number(els.temperature.value),
      systemPrompt: els.systemPrompt.value.trim(),
      waterReminder: els.waterReminder.checked,
      waterInterval: Number(els.waterInterval.value),
      workMinutes: Number(els.workMinutes.value),
      breakMinutes: Number(els.breakMinutes.value)
    };
  }

  function showTestResult(ok, message, models) {
    els.testResult.className = `test-result show ${ok ? 'ok' : 'bad'}`;
    const suffix = Array.isArray(models) && models.length ? ` 可用模型：${models.join('、')}` : '';
    els.testResult.textContent = `${message}${suffix}`;
  }

  els.scale.addEventListener('input', setScaleLabel);
  els.temperature.addEventListener('input', setTemperatureLabel);

  els.toggleKey.addEventListener('click', () => {
    const showing = els.apiKey.type === 'text';
    els.apiKey.type = showing ? 'password' : 'text';
    els.toggleKey.textContent = showing ? '显示' : '隐藏';
  });

  els.getKey.addEventListener('click', (event) => {
    event.preventDefault();
    api.openExternal('https://platform.deepseek.com/api_keys');
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

  async function boot() {
    try {
      const settings = await api.getSettings();
      if (settings) fill(settings);
    } catch {
      /* 保持空表单 */
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

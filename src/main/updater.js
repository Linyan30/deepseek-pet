'use strict';

const { requestJSON } = require('./http');

function parseVersion(value) {
  const text = String(value == null ? '' : value).trim().replace(/^v/i, '');
  const match = text.match(/^(\d+)\.(\d+)\.(\d+)(?:[-+]([0-9A-Za-z.-]+))?/);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    pre: match[4] || ''
  };
}

/** 判断 latest 是否比 current 新。支持 v1.2.3 与 1.2.3-beta.1。 */
function isNewerVersion(latest, current) {
  const a = parseVersion(latest);
  const b = parseVersion(current);
  if (!a || !b) return false;
  if (a.major !== b.major) return a.major > b.major;
  if (a.minor !== b.minor) return a.minor > b.minor;
  if (a.patch !== b.patch) return a.patch > b.patch;
  if (a.pre === b.pre) return false;
  if (!a.pre) return true;
  if (!b.pre) return false;

  // 简易的预发布版本比较：按 . 分段，数字段按数值比
  const left = a.pre.split('.');
  const right = b.pre.split('.');
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const x = left[index];
    const y = right[index];
    if (x === undefined) return false;
    if (y === undefined) return true;
    const nx = Number(x);
    const ny = Number(y);
    if (Number.isFinite(nx) && Number.isFinite(ny)) {
      if (nx !== ny) return nx > ny;
    } else if (x !== y) {
      return x > y;
    }
  }
  return false;
}

function parseRepo(packageJson) {
  const repository = packageJson && packageJson.repository;
  const url = typeof repository === 'string' ? repository : repository && repository.url;
  if (!url) return null;
  const match = String(url).match(/github\.com[/:]([^/]+)\/([^/.#]+)/i);
  if (!match) return null;
  return { owner: match[1], repo: match[2].replace(/\.git$/i, '') };
}

function releaseApiUrl(repo) {
  return `https://api.github.com/repos/${repo.owner}/${repo.repo}/releases/latest`;
}

function releasePageUrl(repo, tag) {
  return `https://github.com/${repo.owner}/${repo.repo}/releases/tag/${encodeURIComponent(tag)}`;
}

/**
 * 更新器：
 * - 安装版（NSIS / AppImage）走 electron-updater，自动下载、退出时安装；
 * - 便携版无法自我替换，改为查 GitHub Releases，提示去下载新版本；
 * - 开发模式不做任何检查。
 *
 * 依赖都可注入，方便单元测试。
 */
function createUpdater(options) {
  const opts = options || {};
  const app = opts.app;
  const shell = opts.shell;
  const env = opts.env || process.env;
  const logger = opts.logger || console;
  const request = opts.request || requestJSON;
  const notify = opts.notify || (() => {});
  const bubble = opts.bubble || (() => {});
  const onStateChange = opts.onStateChange || (() => {});
  const packageJson = opts.packageJson || {};

  const factory =
    opts.autoUpdaterFactory ||
    (() => {
      // eslint-disable-next-line global-require
      return require('electron-updater').autoUpdater;
    });

  const repo = parseRepo(packageJson);
  const portable = Boolean(env.PORTABLE_EXECUTABLE_FILE || env.PORTABLE_EXECUTABLE_DIR);
  const currentVersion = String(
    (app && typeof app.getVersion === 'function' && app.getVersion()) || packageJson.version || '0.0.0'
  );

  let autoUpdater = null;
  let initialized = false;
  let pendingManual = false;
  let state = {
    phase: 'idle',
    version: '',
    progress: 0,
    error: '',
    portable,
    currentVersion,
    manualUrl: ''
  };

  function setState(patch) {
    state = Object.assign({}, state, patch);
    onStateChange(state);
    return state;
  }

  function wireEvents() {
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on('checking-for-update', () => setState({ phase: 'checking', error: '' }));

    autoUpdater.on('update-available', (info) => {
      const version = info && info.version ? info.version : '';
      setState({ phase: 'downloading', version, progress: 0 });
      bubble(`发现新版本 v${version}，正在后台下载…`, 'happy', 4200);
    });

    autoUpdater.on('update-not-available', () => {
      setState({ phase: 'idle', version: '', progress: 0, manualUrl: '' });
      if (pendingManual) {
        pendingManual = false;
        bubble('已经是最新版本啦～', 'happy', 3000);
      }
    });

    autoUpdater.on('download-progress', (progress) => {
      const percent = Math.max(0, Math.min(100, Math.round(Number(progress && progress.percent) || 0)));
      setState({ phase: 'downloading', progress: percent });
    });

    autoUpdater.on('update-downloaded', (info) => {
      const version = (info && info.version) || state.version;
      setState({ phase: 'ready', version, progress: 100 });
      bubble(`新版本 v${version} 已下载，在托盘里点「重启并安装」`, 'love', 6000);
      notify('更新已就绪', `DeepSeekPet v${version} 会在退出后自动安装`);
    });

    autoUpdater.on('error', (error) => {
      logger.warn('[updater] 更新出错：', error && error.message);
      setState({ phase: 'error', error: (error && error.message) || '更新失败' });
      if (pendingManual) {
        pendingManual = false;
        bubble('检查更新失败，稍后再试。', 'sleepy', 3600);
      }
    });
  }

  function init() {
    if (initialized) return state;
    initialized = true;

    if (!app || !app.isPackaged) {
      setState({ phase: 'dev' });
      return state;
    }
    if (portable) {
      setState({ phase: 'portable' });
      return state;
    }

    try {
      autoUpdater = factory();
    } catch (error) {
      logger.warn('[updater] electron-updater 不可用：', error.message);
      setState({ phase: 'unavailable', error: '自动更新组件不可用' });
      return state;
    }

    wireEvents();
    setState({ phase: 'idle' });
    return state;
  }

  async function checkPortable(manual) {
    if (!repo) {
      if (manual) bubble('没有配置仓库地址，无法检查更新。', 'sleepy', 3600);
      return state;
    }

    setState({ phase: 'checking', error: '' });
    try {
      const response = await request(releaseApiUrl(repo), {
        headers: { Accept: 'application/vnd.github+json' }
      });
      if (response.status !== 200) throw new Error(`GitHub API HTTP ${response.status}`);

      const tag = String((response.body && response.body.tag_name) || '');
      const version = tag.replace(/^v/i, '');
      if (!version) throw new Error('没有读到版本号');

      if (isNewerVersion(version, currentVersion)) {
        setState({
          phase: 'manual',
          version,
          manualUrl: releasePageUrl(repo, tag)
        });
        bubble(`新版本 v${version} 发布啦，托盘里点「下载新版本」`, 'happy', 6000);
      } else {
        setState({ phase: 'idle', version: '', manualUrl: '' });
        if (manual) bubble('已经是最新版本啦～', 'happy', 3000);
      }
    } catch (error) {
      logger.warn('[updater] 检查更新失败：', error.message);
      setState({ phase: 'error', error: error.message });
      if (manual) bubble('检查更新失败，稍后再试。', 'sleepy', 3600);
    }
    return state;
  }

  async function check(checkOptions) {
    const manual = Boolean(checkOptions && checkOptions.manual);
    if (!initialized) init();

    if (!app || !app.isPackaged) {
      if (manual) bubble('开发模式下不检查更新～', 'idle', 3000);
      return state;
    }
    if (portable) return checkPortable(manual);

    if (!autoUpdater) {
      if (manual) bubble('自动更新组件不可用，可以去 Releases 手动下载。', 'sleepy', 4800);
      return state;
    }

    pendingManual = manual;
    if (manual) setState({ phase: 'checking', error: '' });

    try {
      await autoUpdater.checkForUpdates();
    } catch (error) {
      logger.warn('[updater] 检查更新失败：', error && error.message);
      setState({ phase: 'error', error: (error && error.message) || '检查更新失败' });
      if (manual) bubble('检查更新失败，稍后再试。', 'sleepy', 3600);
    }
    return state;
  }

  function installNow() {
    if (!autoUpdater || state.phase !== 'ready') return false;
    try {
      autoUpdater.quitAndInstall(false, true);
      return true;
    } catch (error) {
      logger.warn('[updater] 安装更新失败：', error.message);
      return false;
    }
  }

  function openManual() {
    if (!state.manualUrl || !shell) return false;
    try {
      shell.openExternal(state.manualUrl).catch(() => {});
      return true;
    } catch {
      return false;
    }
  }

  return {
    init,
    check,
    installNow,
    openManual,
    getState: () => Object.assign({}, state),
    isPortable: () => portable,
    currentVersion
  };
}

module.exports = {
  createUpdater,
  isNewerVersion,
  parseVersion,
  parseRepo,
  releaseApiUrl,
  releasePageUrl
};

'use strict';

/**
 * 一个最小可用的 Electron 替身，用来在纯 Node 环境里冒烟测试 main.js 的接线。
 * 只实现项目实际用到的 API，避免引入真实依赖。
 */
const Module = require('node:module');
const { EventEmitter } = require('node:events');

let nextId = 1;

class FakeWebContents extends EventEmitter {
  constructor(id, win) {
    super();
    this.id = id;
    this.win = win;
    this.sent = [];
    this.loading = false;
  }

  send(channel, payload) {
    this.sent.push({ channel, payload });
  }

  isLoading() {
    return this.loading;
  }

  openDevTools() {}

  setWindowOpenHandler() {}
}

class FakeBrowserWindow extends EventEmitter {
  constructor(options) {
    super();
    this.options = options || {};
    this.bounds = {
      x: this.options.x || 0,
      y: this.options.y || 0,
      width: this.options.width || 0,
      height: this.options.height || 0
    };
    this.webContents = new FakeWebContents(nextId++, this);
    this.visible = false;
    this.focused = false;
    this.destroyed = false;
    this.zoomFactor = (this.options.webPreferences && this.options.webPreferences.zoomFactor) || 1;
    this.alwaysOnTop = Boolean(this.options.alwaysOnTop);
  }

  static fromWebContents(contents) {
    return contents && contents.win ? contents.win : null;
  }

  loadFile(file) {
    this.loadedFile = file;
    this.webContents.loading = true;
    setImmediate(() => {
      this.webContents.loading = false;
      this.emit('ready-to-show');
    });
    return Promise.resolve();
  }

  showInactive() {
    this.visible = true;
  }

  show() {
    this.visible = true;
  }

  hide() {
    this.visible = false;
  }

  focus() {
    this.focused = true;
    this.emit('focus');
  }

  isFocused() {
    return this.focused;
  }

  isVisible() {
    return this.visible;
  }

  isDestroyed() {
    return this.destroyed;
  }

  isMinimized() {
    return false;
  }

  restore() {}

  minimize() {}

  getBounds() {
    return { ...this.bounds };
  }

  setPosition(x, y) {
    this.bounds.x = x;
    this.bounds.y = y;
    this.emit('moved');
  }

  setBounds(next) {
    this.bounds = { ...this.bounds, ...next };
    this.emit('moved');
  }

  setSize(width, height) {
    this.bounds.width = width;
    this.bounds.height = height;
  }

  setZoomFactor(zoom) {
    this.zoomFactor = zoom;
  }

  setAlwaysOnTop(value) {
    this.alwaysOnTop = value;
  }

  isAlwaysOnTop() {
    return this.alwaysOnTop;
  }

  setIgnoreMouseEvents(value) {
    this.ignoreMouse = value;
  }

  setVisibleOnAllWorkspaces() {}

  close() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.emit('closed');
  }
}

class FakeTray extends EventEmitter {
  constructor(image) {
    super();
    this.image = image;
    this.menu = null;
    this.toolTip = '';
  }

  setContextMenu(menu) {
    this.menu = menu;
  }

  setToolTip(text) {
    this.toolTip = text;
  }

  destroy() {}
}

function installElectronMock(options) {
  const userDataDir = (options && options.userDataDir) || process.cwd();
  const windows = [];
  const menus = [];
  const shortcuts = new Map();

  class BrowserWindow extends FakeBrowserWindow {
    constructor(opts) {
      super(opts);
      windows.push(this);
    }
  }

  const app = new EventEmitter();
  app.isQuitting = false;
  app.quitCalled = false;
  app.loginItemSettings = null;
  app.requestSingleInstanceLock = () => true;
  app.whenReady = () => Promise.resolve();
  app.pathOverrides = {};
  app.getPath = (name) => app.pathOverrides[name] || userDataDir;
  app.setPath = (name, value) => {
    app.pathOverrides[name] = value;
  };
  app.getVersion = () => '1.0.0';
  app.setAppUserModelId = () => {};
  app.setLoginItemSettings = (settings) => {
    app.loginItemSettings = settings;
  };
  app.quit = () => {
    app.quitCalled = true;
    app.emit('before-quit');
  };

  const ipcMain = {
    handlers: new Map(),
    listeners: new Map(),
    handle(channel, handler) {
      this.handlers.set(channel, handler);
    },
    on(channel, listener) {
      this.listeners.set(channel, listener);
    },
    invoke(channel, senderId, ...args) {
      const handler = this.handlers.get(channel);
      if (!handler) throw new Error(`没有注册 handler: ${channel}`);
      return handler({ sender: { id: senderId } }, ...args);
    },
    emitFrom(channel, senderId, ...args) {
      const listener = this.listeners.get(channel);
      if (!listener) throw new Error(`没有注册 listener: ${channel}`);
      listener({ sender: { id: senderId } }, ...args);
    }
  };

  const displays = [{ id: 1, workArea: { x: 0, y: 0, width: 1440, height: 900 } }];

  const electron = {
    app,
    BrowserWindow,
    ipcMain,
    screen: {
      getPrimaryDisplay: () => displays[0],
      getDisplayNearestPoint: () => displays[0],
      getCursorScreenPoint: () => ({ x: 0, y: 0 })
    },
    Tray: FakeTray,
    Menu: {
      buildFromTemplate(template) {
        const menu = { template, items: template, popup() {} };
        menus.push(menu);
        return menu;
      }
    },
    nativeImage: {
      createFromPath: () => ({ isEmpty: () => true, resize() { return this; } }),
      createEmpty: () => ({ isEmpty: () => true })
    },
    shell: { openExternal: async () => {} },
    clipboard: {
      readText: () => '（测试）剪贴板里的内容'
    },
    Notification: class Notification {
      static isSupported() {
        return false;
      }

      constructor(opts) {
        this.opts = opts;
      }

      show() {}
    },
    globalShortcut: {
      register(accelerator, callback) {
        shortcuts.set(accelerator, callback);
        return true;
      },
      unregisterAll() {
        shortcuts.clear();
      },
      isRegistered(accelerator) {
        return shortcuts.has(accelerator);
      }
    }
  };

  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'electron') return electron;
    return originalLoad.call(this, request, parent, isMain);
  };

  return {
    electron,
    app,
    ipcMain,
    windows,
    menus,
    shortcuts,
    dispose() {
      Module._load = originalLoad;
    }
  };
}

module.exports = { installElectronMock };

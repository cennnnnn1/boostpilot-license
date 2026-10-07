const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('launcher', {
  login: (key, keepSession) => ipcRenderer.invoke('login', key, keepSession),
  refresh: () => ipcRenderer.invoke('refresh'),
  openPanel: () => ipcRenderer.invoke('open-panel'),
  getStatus: () => ipcRenderer.invoke('get-status'),
  setAutostart: (enabled) => ipcRenderer.invoke('set-autostart', enabled),
  setKeepSession: (keep) => ipcRenderer.invoke('set-keep-session', keep),
  restartBot: () => ipcRenderer.invoke('restart-bot'),
  openStore: () => ipcRenderer.invoke('open-store'),
  loginEldorado: () => ipcRenderer.invoke('login-eldorado'),
  checkUpdate: () => ipcRenderer.invoke('check-update'),
  applyUpdate: () => ipcRenderer.invoke('apply-update'),
  onUpdateProgress: (cb) => ipcRenderer.on('update-progress', (_e, d) => cb(d)),
  copyText: (text) => ipcRenderer.invoke('clipboard-write', String(text == null ? '' : text)),
  quit: () => ipcRenderer.invoke('quit-app'),
});

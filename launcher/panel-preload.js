const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('panelBridge', {
  logoutToLauncher: () => ipcRenderer.send('panel-logout'),
  setHotkey: (accel) => ipcRenderer.invoke('set-hotkey', accel),
});

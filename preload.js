
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mlaunch', {
  getAppInfo: () => ipcRenderer.invoke('mlaunch:app-info'),
  getGameStatus: () => ipcRenderer.invoke('mlaunch:game-status'),
  launchGame: () => ipcRenderer.invoke('mlaunch:launch')
});

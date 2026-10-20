
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mlaunch', {
  getAppInfo: () => ipcRenderer.invoke('mlaunch:app-info')
});

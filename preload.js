
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mlaunch', {
  getAppInfo: () => ipcRenderer.invoke('mlaunch:app-info'),

  getGameStatus: () => ipcRenderer.invoke('mlaunch:game-status'),

  getGameFunctions: () =>
    ipcRenderer.invoke('mlaunch:game-functions'),

  loginMicrosoft: () => ipcRenderer.invoke('mlaunch:login'),

  launchGame: (version) =>
    ipcRenderer.invoke('mlaunch:launch', { version }),

  onProgress: (callback) => {
    if (typeof callback !== 'function') {
      return () => {};
    }

    const listener = (_event, message) => callback(message);

    ipcRenderer.on('mlaunch:progress', listener);

    return () => {
      ipcRenderer.removeListener('mlaunch:progress', listener);
    };
  }
});

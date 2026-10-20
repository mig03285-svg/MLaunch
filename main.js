
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const { Launcher } = require('eml-lib');

let mainWindow;
let isLaunching = false;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 780,
    minWidth: 850,
    minHeight: 600,
    title: 'MLaunch',
    backgroundColor: '#07101e',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.loadFile('index.html');
}

ipcMain.handle('mlaunch:app-info', () => ({
  name: 'MLaunch',
  version: app.getVersion(),
  platform: process.platform,
  ready: true
}));

ipcMain.handle('mlaunch:game-status', () => ({
  installed: false,
  launching: isLaunching,
  message: 'Игровой движок подготовлен. Требуется авторизация.'
}));

ipcMain.handle('mlaunch:launch', async () => {
  if (isLaunching) {
    return { ok: false, message: 'Игра уже запускается.' };
  }

  return {
    ok: false,
    message: 'Сначала подключим авторизацию Microsoft и настройки версии игры.'
  };
});

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});


const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

let mainWindow;
let account = null;
let isLaunching = false;
let lastProgress = 'Готов к работе';

const { Launcher, MicrosoftAuth } = require('@kintare/eml-lib');

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

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
}

function sendStatus(message) {
  lastProgress = message;

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('mlaunch:progress', message);
  }
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
  authenticated: Boolean(account),
  message: account
    ? `Вход выполнен: ${account.name || 'игрок'}`
    : 'Войди через аккаунт Microsoft'
}));

ipcMain.handle('mlaunch:login', async () => {
  if (!mainWindow) {
    return { ok: false, message: 'Окно лаунчера ещё не готово.' };
  }

  try {
    sendStatus('Открываем вход Microsoft…');

    const auth = new MicrosoftAuth(mainWindow);
    account = await auth.auth();

    sendStatus(`Вход выполнен: ${account.name || 'игрок'}`);

    return {
      ok: true,
      name: account.name || 'Игрок',
      message: 'Вход через Microsoft выполнен.'
    };
  } catch (error) {
    account = null;
    const message = error?.message || 'Не удалось выполнить вход.';
    sendStatus(message);

    return { ok: false, message };
  }
});

ipcMain.handle('mlaunch:launch', async (_event, options = {}) => {
  if (isLaunching) {
    return { ok: false, message: 'Игра уже запускается.' };
  }

  if (!account) {
    return {
      ok: false,
      message: 'Сначала войди через аккаунт Microsoft.'
    };
  }

  const version = String(options.version || '').trim();

  if (!/^[\w.-]+$/.test(version)) {
    return {
      ok: false,
      message: 'Выбери корректную версию Minecraft.'
    };
  }

  isLaunching = true;

  try {
    sendStatus('Подготавливаем Minecraft…');

    const launcher = new Launcher({
      root: 'mlaunch',
      account,
      minecraft: {
        version
      }
    });

    launcher.on('launch_compute_download', () => {
      sendStatus('Подготавливаем список файлов…');
    });

    launcher.on('launch_download', (data) => {
      const total = data?.total;
      if (total) {
        sendStatus(
          `Загрузка файлов: ${total.downloaded || 0} из ${total.amount || '?'}`
        );
      } else {
        sendStatus('Скачиваем файлы Minecraft…');
      }
    });

    launcher.on('launch_check_java', () => {
      sendStatus('Проверяем Java…');
    });

    launcher.on('launch_install_loader', (loader) => {
      sendStatus(`Устанавливаем загрузчик ${loader?.type || ''}…`);
    });

    launcher.on('launch_launch', (info) => {
      sendStatus(`Запускаем Minecraft ${info?.version || version}…`);
    });

    launcher.on('launch_close', (code) => {
      sendStatus(`Minecraft завершил работу. Код: ${code}`);
    });

    await launcher.launch();

    return {
      ok: true,
      message: 'Команда запуска Minecraft выполнена.'
    };
  } catch (error) {
    const message = error?.message || 'Не удалось запустить Minecraft.';
    sendStatus(`Ошибка запуска: ${message}`);

    return { ok: false, message };
  } finally {
    isLaunching = false;
  }
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

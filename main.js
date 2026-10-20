
'use strict';

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const { Launcher, MicrosoftAuth } = require('@kintare/eml-lib');

let mainWindow = null;
let account = null;
let isLaunching = false;
let authInProgress = false;

function getGameRoot() {
  // app.getPath('userData') автоматически учитывает Windows и Linux.
  // EML Lib добавляет точку к имени root самостоятельно.
  return path.join(app.getPath('userData'), 'game');
}

function sendStatus(message) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('mlaunch:progress', String(message));
  }
}

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

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
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
  message: isLaunching
    ? 'Minecraft запускается…'
    : account
      ? `Вход выполнен: ${account.name || 'игрок'}`
      : 'Войди через аккаунт Microsoft'
}));

ipcMain.handle('mlaunch:login', async () => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return {
      ok: false,
      message: 'Окно лаунчера ещё не готово.'
    };
  }

  if (authInProgress) {
    return {
      ok: false,
      message: 'Авторизация уже выполняется.'
    };
  }

  authInProgress = true;

  try {
    sendStatus('Открываем авторизацию Microsoft…');

    const auth = new MicrosoftAuth(mainWindow);
    const result = await auth.auth();

    if (!result) {
      throw new Error('Microsoft не вернул данные аккаунта.');
    }

    account = result;

    const name = account.name || account.username || 'Игрок';
    sendStatus(`Вход выполнен: ${name}`);

    return {
      ok: true,
      name,
      message: 'Вход через Microsoft выполнен.'
    };
  } catch (error) {
    account = null;

    const message =
      error && error.message
        ? error.message
        : 'Не удалось выполнить вход Microsoft.';

    sendStatus(`Ошибка авторизации: ${message}`);

    return {
      ok: false,
      message
    };
  } finally {
    authInProgress = false;
  }
});

ipcMain.handle('mlaunch:launch', async (_event, options = {}) => {
  if (isLaunching) {
    return {
      ok: false,
      message: 'Minecraft уже запускается.'
    };
  }

  if (!account) {
    return {
      ok: false,
      message: 'Сначала войди через аккаунт Microsoft.'
    };
  }

  const version = String(options?.version || '').trim();

  if (!/^[\w.-]+$/.test(version)) {
    return {
      ok: false,
      message: 'Выбери корректную версию Minecraft.'
    };
  }

  isLaunching = true;

  try {
    sendStatus(`Подготавливаем Minecraft ${version}…`);

    const launcher = new Launcher({
      root: getGameRoot(),
      account,
      minecraft: {
        version
      }
    });

    launcher.on('launch_compute_download', () => {
      sendStatus('Подготавливаем список файлов Minecraft…');
    });

    launcher.on('launch_download', (data) => {
      const total = data?.total;

      if (total) {
        const downloaded = total.downloaded ?? 0;
        const amount = total.amount ?? '?';

        sendStatus(`Загрузка файлов: ${downloaded} из ${amount}`);
      } else {
        sendStatus('Скачиваем файлы Minecraft…');
      }
    });

    launcher.on('launch_check_java', () => {
      sendStatus('Проверяем и подготавливаем Java…');
    });

    launcher.on('launch_install_loader', (loader) => {
      const type = loader?.type || 'мод';

      sendStatus(`Устанавливаем загрузчик ${type}…`);
    });

    launcher.on('launch_launch', (info) => {
      sendStatus(`Запускаем Minecraft ${info?.version || version}…`);
    });

    launcher.on('launch_close', (code) => {
      sendStatus(`Minecraft завершил работу. Код: ${code}`);
    });

    launcher.on('launch_data', (message) => {
      if (typeof message === 'string' && message.trim()) {
        sendStatus(message.trim().slice(-500));
      }
    });

    await launcher.launch();

    return {
      ok: true,
      message: 'Команда запуска Minecraft выполнена.'
    };
  } catch (error) {
    const message =
      error && error.message
        ? error.message
        : 'Не удалось запустить Minecraft.';

    sendStatus(`Ошибка запуска: ${message}`);

    return {
      ok: false,
      message
    };
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

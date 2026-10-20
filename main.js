
'use strict';

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const { Launcher, MicrosoftAuth } = require('@kintare/eml-lib');

let mainWindow = null;
let account = null;
let isLaunching = false;
let authInProgress = false;

const UPDATE_SITE = 'https://mlaunch-updates.mig03285.workers.dev';

function getGameRoot() {
  return 'mlaunch';
}

function sendStatus(message) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(
      'mlaunch:progress',
      String(message)
    );
  }
}

function getErrorMessage(error, fallback) {
  if (error && typeof error.message === 'string' && error.message.trim()) {
    return error.message;
  }

  return fallback;
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
      ? `Вход выполнен: ${account.name || account.username || 'игрок'}`
      : 'Войди через аккаунт Microsoft'
}));

ipcMain.handle('mlaunch:game-functions', async () => {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    let response;

    try {
      response = await fetch(`${UPDATE_SITE}/api/cheats`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      throw new Error(`Сайт вернул HTTP ${response.status}`);
    }

    const data = await response.json();

    const settings = {
      enabled: data.enabled === true,
      xray: data.xray === true,
      fullbright: data.fullbright === true,
      fly: data.fly === true,
      speed: data.speed === true,
      esp: data.esp === true
    };

    return {
      ok: true,
      settings,
      message: 'Настройки загружены с сайта MLaunch.'
    };
  } catch (error) {
    return {
      ok: false,
      settings: null,
      message: getErrorMessage(
        error,
        'Не удалось загрузить настройки игровых функций.'
      )
    };
  }
});

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

    const message = getErrorMessage(
      error,
      'Не удалось выполнить вход Microsoft.'
    );

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
      minecraft: { version }
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
      sendStatus(`Устанавливаем загрузчик ${loader?.type || 'мод'}…`);
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

    sendStatus(`Команда запуска Minecraft ${version} выполнена.`);

    return {
      ok: true,
      message: `Команда запуска Minecraft ${version} выполнена.`
    };
  } catch (error) {
    const message = getErrorMessage(
      error,
      'Не удалось запустить Minecraft.'
    );

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

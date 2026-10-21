
'use strict';

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { Launcher, MicrosoftAuth } = require('@kintare/eml-lib');

let mainWindow = null;
let account = null;
let localProfile = null;
let isLaunching = false;
let authInProgress = false;

const GAME_ROOT = 'mlaunch';
const UPDATE_SITE = 'https://mlaunch-updates.mig03285.workers.dev';
const PROFILE_FILE = 'local-profile.json';

function profilePath() {
  return path.join(app.getPath('userData'), PROFILE_FILE);
}

function loadLocalProfile() {
  try {
    const saved = JSON.parse(fs.readFileSync(profilePath(), 'utf8'));
    const name = String(saved?.name || '').trim();

    if (/^[A-Za-z0-9_]{3,16}$/.test(name)) {
      localProfile = { name };
    }
  } catch {
    localProfile = null;
  }
}

function saveLocalProfile(profile) {
  fs.mkdirSync(path.dirname(profilePath()), { recursive: true });
  fs.writeFileSync(
    profilePath(),
    JSON.stringify(profile, null, 2),
    'utf8'
  );
}

function sendStatus(message) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('mlaunch:progress', String(message));
  }
}

function errorMessage(error, fallback) {
  return error && typeof error.message === 'string' && error.message.trim()
    ? error.message
    : fallback;
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
  localProfile: localProfile ? { ...localProfile } : null,
  message: isLaunching
    ? 'Minecraft запускается…'
    : account
      ? `Вход Microsoft выполнен: ${account.name || account.username || 'игрок'}`
      : localProfile
        ? `Локальный профиль «${localProfile.name}» сохранён. Для запуска требуется поддерживаемая авторизация.`
        : 'Создай локальный профиль или войди через Microsoft.'
}));

ipcMain.handle('mlaunch:set-local-profile', (_event, rawName) => {
  const name = String(rawName || '').trim();

  if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) {
    return {
      ok: false,
      message: 'Имя должно содержать 3–16 латинских букв, цифр или подчёркиваний.'
    };
  }

  const profile = { name };

  try {
    saveLocalProfile(profile);
    localProfile = profile;
  } catch (error) {
    return {
      ok: false,
      message: `Не удалось сохранить профиль: ${errorMessage(error, 'ошибка записи файла')}`
    };
  }

  sendStatus(`Локальный профиль «${name}» сохранён.`);

  return {
    ok: true,
    name,
    message: `Локальный профиль «${name}» сохранён.`
  };
});

ipcMain.handle('mlaunch:game-functions', async () => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(`${UPDATE_SITE}/api/cheats`, {
      headers: { Accept: 'application/json' },
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`Сайт вернул HTTP ${response.status}`);
    }

    const data = await response.json();

    return {
      ok: true,
      settings: {
        enabled: data.enabled === true,
        xray: data.xray === true,
        fullbright: data.fullbright === true,
        fly: data.fly === true,
        speed: data.speed === true,
        esp: data.esp === true
      },
      message: 'Настройки загружены с сайта MLaunch.'
    };
  } catch (error) {
    return {
      ok: false,
      settings: null,
      message: errorMessage(error, 'Не удалось загрузить настройки игровых функций.')
    };
  } finally {
    clearTimeout(timeout);
  }
});

ipcMain.handle('mlaunch:login', async () => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return { ok: false, message: 'Окно лаунчера ещё не готово.' };
  }

  if (authInProgress) {
    return { ok: false, message: 'Авторизация уже выполняется.' };
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

    sendStatus(`Вход Microsoft выполнен: ${name}`);

    return {
      ok: true,
      name,
      message: 'Вход через Microsoft выполнен.'
    };
  } catch (error) {
    account = null;
    const message = errorMessage(error, 'Не удалось выполнить вход Microsoft.');

    sendStatus(`Ошибка авторизации: ${message}`);

    return { ok: false, message };
  } finally {
    authInProgress = false;
  }
});

ipcMain.handle('mlaunch:launch', async (_event, options = {}) => {
  if (isLaunching) {
    return { ok: false, message: 'Minecraft уже запускается.' };
  }

  const version = String(options?.version || '').trim();

  if (!/^[\w.-]+$/.test(version)) {
    return { ok: false, message: 'Выбери корректную версию Minecraft.' };
  }

  if (!account) {
    return {
      ok: false,
      message: localProfile
        ? `Профиль «${localProfile.name}» сохранён, но запуск с локальным профилем ещё не реализован.`
        : 'Сначала создай локальный профиль или войди через Microsoft.'
    };
  }

  isLaunching = true;

  try {
    sendStatus(`Подготавливаем Minecraft ${version}…`);

    const launcher = new Launcher({
      root: GAME_ROOT,
      account,
      minecraft: { version }
    });

    launcher.on('launch_compute_download', () => {
      sendStatus('Подготавливаем список файлов Minecraft…');
    });

    launcher.on('launch_download', (data) => {
      const total = data?.total;

      sendStatus(total
        ? `Загрузка файлов: ${total.downloaded ?? 0} из ${total.amount ?? '?'}`
        : 'Скачиваем файлы Minecraft…');
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
    const message = errorMessage(error, 'Не удалось запустить Minecraft.');

    sendStatus(`Ошибка запуска: ${message}`);

    return { ok: false, message };
  } finally {
    isLaunching = false;
  }
});

app.whenReady().then(() => {
  loadLocalProfile();
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

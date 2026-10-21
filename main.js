
'use strict';

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const {
  Launcher,
  MicrosoftAuth,
  CrackAuth
} = require('@kintare/eml-lib');

let mainWindow = null;
let account = null;
let localProfile = null;
let isLaunching = false;
let authInProgress = false;

const GAME_ROOT = path.join(app.getPath('userData'), 'game');
const UPDATE_SITE = 'https://mlaunch-updates.mig03285.workers.dev';
const PROFILE_FILE = 'local-profile.json';

function profilePath() {
  return path.join(app.getPath('userData'), PROFILE_FILE);
}

function errorMessage(error, fallback) {
  if (error && typeof error.message === 'string' && error.message.trim()) {
    return error.message.trim().slice(0, 500);
  }
  return fallback;
}

function sendStatus(message) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('mlaunch:progress', String(message));
}

function loadLocalProfile() {
  try {
    const saved = JSON.parse(fs.readFileSync(profilePath(), 'utf8'));
    const name = String(saved?.name || '').trim();

    localProfile = /^[A-Za-z0-9_]{3,16}$/.test(name)
      ? { name }
      : null;
  } catch {
    localProfile = null;
  }
}

function saveLocalProfile(name) {
  fs.writeFileSync(
    profilePath(),
    JSON.stringify({ name }, null, 2),
    'utf8'
  );
}

function getStatus() {
  let message;

  if (isLaunching) {
    message = 'Minecraft запускается…';
  } else if (authInProgress) {
    message = 'Подготавливаем аккаунт…';
  } else if (account) {
    message = `Аккаунт: ${account.name || account.username || 'Игрок'}`;
  } else if (localProfile) {
    message = `Локальный профиль «${localProfile.name}» готов`;
  } else {
    message = 'Создай локальный профиль или войди через Microsoft.';
  }

  return {
    installed: null,
    launching: isLaunching,
    authenticating: authInProgress,
    authenticated: Boolean(account),
    canLaunch: Boolean(account || localProfile) &&
      !isLaunching && !authInProgress,
    localProfile: localProfile ? { ...localProfile } : null,
    message
  };
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

ipcMain.handle('mlaunch:game-status', () => getStatus());

ipcMain.handle('mlaunch:set-local-profile', (_event, rawName) => {
  const name = String(rawName || '').trim();

  if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) {
    return {
      ok: false,
      message: 'Ник должен содержать 3–16 латинских букв, цифр или подчёркиваний.'
    };
  }

  try {
    saveLocalProfile(name);
    localProfile = { name };

    // Если ник изменился, старый аккаунт больше не используем.
    account = null;

    const message = `Локальный профиль «${name}» сохранён.`;
    sendStatus(message);

    return { ok: true, name, message };
  } catch (error) {
    return {
      ok: false,
      message: `Не удалось сохранить профиль: ${
        errorMessage(error, 'ошибка записи файла')
      }`
    };
  }
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
      message: errorMessage(error, 'Не удалось загрузить настройки.')
    };
  } finally {
    clearTimeout(timeout);
  }
});

ipcMain.handle('mlaunch:login', async () => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return { ok: false, message: 'Окно лаунчера ещё не готово.' };
  }

  if (authInProgress || isLaunching) {
    return { ok: false, message: 'Дождись завершения текущей операции.' };
  }

  authInProgress = true;
  sendStatus('Открываем авторизацию Microsoft…');

  try {
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
  if (isLaunching || authInProgress) {
    return { ok: false, message: 'Дождись завершения текущей операции.' };
  }

  const version = String(options?.version || '1.20.1').trim();

  if (!/^[\w.-]+$/.test(version)) {
    return { ok: false, message: 'Выбрана некорректная версия Minecraft.' };
  }

  if (!account && !localProfile) {
    return {
      ok: false,
      message: 'Сначала создай и сохрани локальный профиль.'
    };
  }

  isLaunching = true;

  try {
    if (!account) {
      authInProgress = true;
      sendStatus(`Создаём offline-аккаунт «${localProfile.name}»…`);

      try {
        const auth = new CrackAuth();
        account = await auth.auth(localProfile.name);

        if (!account) {
          throw new Error('EML не вернул объект аккаунта.');
        }
      } catch (error) {
        account = null;
        throw new Error(
          `Не удалось создать offline-аккаунт: ${
            errorMessage(error, 'проверь API CrackAuth')
          }`
        );
      } finally {
        authInProgress = false;
      }
    }

    sendStatus(`Подготавливаем Minecraft ${version}…`);

    const launcher = new Launcher({
      root: GAME_ROOT,
      account,
      minecraft: { version }
    });

    launcher.on('launch_compute_download', () => {
      sendStatus('Подготавливаем файлы Minecraft…');
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
      sendStatus(`Устанавливаем загрузчик ${loader?.type || 'модов'}…`);
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

    const message =
      `Команда запуска Minecraft ${version} передана EML. ` +
      'Реальный запуск нужно подтвердить тестом.';

    sendStatus(message);
    return { ok: true, message };
  } catch (error) {
    const message = errorMessage(error, 'Не удалось запустить Minecraft.');
    sendStatus(`Ошибка запуска: ${message}`);
    return { ok: false, message };
  } finally {
    authInProgress = false;
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
}).catch((error) => {
  console.error('Не удалось запустить MLaunch:', error);
  app.quit();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

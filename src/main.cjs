'use strict';
const { app, BrowserWindow, ipcMain, desktopCapturer, screen, globalShortcut, clipboard, safeStorage, session, systemPreferences, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { settings, boundedString, safeError } = require('./core.cjs');
const { OpenAIService } = require('./api.cjs');
const { TranslationStream } = require('./realtime.cjs');
const { SpeechTurn } = require('./speech-turn.cjs');
app.setName('LingoPlay');
if (!app.isPackaged && process.env.LINGOPLAY_DATA_DIR) app.setPath('userData', path.resolve(process.env.LINGOPLAY_DATA_DIR));
if (!app.requestSingleInstanceLock()) app.quit();
let win, overlay, storeFile, config = settings(), savedKey = '', storageWarning = '', captureBusy = false;
const streams = new Map();
const sourceIds = new Set();
const overlayState = { screen: '', voice: '', original: '', size: 22, locked: false };
const api = new OpenAIService(() => savedKey || process.env.OPENAI_API_KEY || '');
const uiURL = pathToFileURL(path.join(__dirname, 'index.html')).href;
const overlayURL = pathToFileURL(path.join(__dirname, 'overlay.html')).href;
function mainSender(e) { return e.sender === win?.webContents && e.senderFrame?.url === uiURL; }
function emit(channel, payload) { if (win && !win.isDestroyed()) win.webContents.send(channel, payload); }
function expose(name, fn) {
  ipcMain.handle(name, async (event, payload) => { if (!mainSender(event)) return { ok: false, error: '허용되지 않은 요청' }; try { return { ok: true, value: await fn(payload) }; } catch (e) { return { ok: false, error: safeError(e) }; } });
}
function loadStore() {
  storeFile = path.join(app.getPath('userData'), 'settings.json');
  try { const data = JSON.parse(fs.readFileSync(storeFile, 'utf8')); config = settings(data.config); if (data.encryptedKey && safeStorage.isEncryptionAvailable()) savedKey = safeStorage.decryptString(Buffer.from(data.encryptedKey, 'base64')); }
  catch (e) { if (e.code !== 'ENOENT') storageWarning = '저장된 설정 또는 API 키를 읽지 못했어요. 설정에서 다시 입력해 주세요.'; }
}
function saveStore() {
  if (savedKey && !safeStorage.isEncryptionAvailable()) throw new Error('운영체제의 키 암호화를 사용할 수 없어요. API 키를 저장하지 않았습니다.');
  const data = { config, encryptedKey: savedKey ? safeStorage.encryptString(savedKey).toString('base64') : null };
  fs.mkdirSync(path.dirname(storeFile), { recursive: true });
  const temporary = `${storeFile}.tmp`; fs.writeFileSync(temporary, JSON.stringify(data, null, 2), { mode: 0o600 }); fs.renameSync(temporary, storeFile);
}
function publishOverlay() { if (overlay && !overlay.isDestroyed()) overlay.webContents.send('overlay-state', overlayState); }
function setOverlay(show) {
  if (!overlay || overlay.isDestroyed()) return false;
  if (show) { overlay.showInactive(); publishOverlay(); } else overlay.hide();
  emit('overlay-visible', overlay.isVisible()); return overlay.isVisible();
}
function stopAll() { api.abort(); for (const s of streams.values()) s.cancel(); streams.clear(); emit('emergency-stop'); overlayState.voice = ''; overlayState.screen = ''; overlayState.original = ''; publishOverlay(); }
function makeWindows() {
  win = new BrowserWindow({ title: 'LingoPlay', width: 1200, height: 850, minWidth: 920, minHeight: 720, backgroundColor: '#10151b', titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default', autoHideMenuBar: true, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required' } });
  win.loadURL(uiURL);
  win.on('close', () => { stopAll(); if (overlay && !overlay.isDestroyed()) overlay.destroy(); });
  win.webContents.on('render-process-gone', stopAll);
  const bounds = screen.getPrimaryDisplay().workArea;
  overlay = new BrowserWindow({ title: 'LingoPlay 자막', width: 760, height: 300, x: Math.round(bounds.x + (bounds.width - 760) / 2), y: Math.round(bounds.y + bounds.height - 340), frame: false, transparent: true, alwaysOnTop: true, skipTaskbar: true, show: false, hasShadow: false, resizable: true, minWidth: 350, minHeight: 120, webPreferences: { preload: path.join(__dirname, 'overlay-preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false } });
  overlay.setAlwaysOnTop(true, 'floating'); overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlay.loadURL(overlayURL); overlay.webContents.on('did-finish-load', publishOverlay);
  for (const w of [win, overlay]) {
    w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    w.webContents.on('will-navigate', (e, url) => { if (url !== uiURL && url !== overlayURL) e.preventDefault(); });
  }
  const hotkeys = [ ['CommandOrControl+Shift+Space', () => emit('hotkey', 'talk')], ['CommandOrControl+Shift+O', () => setOverlay(!overlay.isVisible())], ['CommandOrControl+Shift+S', () => emit('hotkey', 'screen')], ['CommandOrControl+Shift+Escape', stopAll] ];
  const failed = hotkeys.filter(([key, fn]) => !globalShortcut.register(key, fn)).map(([key]) => key);
  win.webContents.once('did-finish-load', () => { if (failed.length) emit('app-warning', `다른 앱이 사용 중인 단축키: ${failed.join(', ')}. 화면 버튼을 사용해 주세요.`); });
}
app.whenReady().then(() => {
  loadStore(); overlayState.size = config.overlaySize;
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback) => callback(contents === win?.webContents && contents.getURL() === uiURL && ['media', 'speaker-selection'].includes(permission)));
  session.defaultSession.setPermissionCheckHandler((contents, permission) => contents === win?.webContents && contents.getURL() === uiURL && ['media', 'speaker-selection'].includes(permission));
  makeWindows();
  expose('bootstrap', () => ({ config, hasKey: Boolean(savedKey || process.env.OPENAI_API_KEY), keySource: savedKey ? 'saved' : process.env.OPENAI_API_KEY ? 'environment' : 'none', platform: process.platform, version: app.getVersion(), warning: storageWarning, screenPermission: process.platform === 'darwin' ? systemPreferences.getMediaAccessStatus('screen') : 'granted' }));
  expose('save-settings', input => { config = settings(input); saveStore(); overlayState.size = config.overlaySize; publishOverlay(); return config; });
  expose('save-key', key => {
    key = boundedString(key, 1000, 'API 키').trim(); if (key && !/^sk-[A-Za-z0-9_-]+$/.test(key)) throw new Error('OpenAI API 키 형식을 확인해 주세요.');
    if (key && !safeStorage.isEncryptionAvailable()) throw new Error('API 키 암호화를 사용할 수 없어요.');
    const previous = savedKey; savedKey = key; try { saveStore(); } catch (e) { savedKey = previous; throw e; } api.cache.clear();
    return { hasKey: Boolean(savedKey || process.env.OPENAI_API_KEY), keySource: savedKey ? 'saved' : process.env.OPENAI_API_KEY ? 'environment' : 'none' };
  });
  expose('check-api', () => api.check());
  expose('list-sources', async () => {
    const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 320, height: 180 }, fetchWindowIcons: false });
    sourceIds.clear(); return sources.filter(s => !/^LingoPlay/.test(s.name)).map(s => { sourceIds.add(s.id); return { id: s.id, name: s.name, thumbnail: s.thumbnail.toDataURL() }; });
  });
  expose('capture', async id => {
    if (!sourceIds.has(id)) throw new Error('화면 목록에서 대상을 다시 선택해 주세요.');
    if (captureBusy) throw new Error('이전 화면을 가져오는 중이에요.'); captureBusy = true;
    try {
      const sources = await desktopCapturer.getSources({ types: [id.startsWith('screen:') ? 'screen' : 'window'], thumbnailSize: { width: 2560, height: 1600 } });
      const source = sources.find(s => s.id === id); if (!source || source.thumbnail.isEmpty()) throw new Error('게임 창을 찾지 못했어요. 최소화를 해제하고 화면 기록 권한을 확인해 주세요.');
      const image = source.thumbnail; return { image: image.toDataURL(), ...image.getSize() };
    } finally { captureBusy = false; }
  });
  expose('translate-text', payload => api.translate(payload));
  expose('translate-screen', payload => api.screen(payload));
  expose('copy', text => { clipboard.writeText(boundedString(text, 20000)); return true; });
  expose('overlay', show => setOverlay(Boolean(show)));
  expose('overlay-content', data => { for (const k of ['screen', 'voice', 'original']) if (typeof data[k] === 'string') overlayState[k] = data[k].slice(0, 7000); publishOverlay(); });
  expose('voice-start', async ({ lane, target, token, synthesize }) => {
    if (!['incoming', 'outgoing'].includes(lane) || typeof token !== 'string' || token.length > 80) throw new Error('잘못된 음성 요청');
    if (streams.has(lane)) throw new Error('이전 음성 처리가 끝날 때까지 기다려 주세요.');
    const Type = lane === 'outgoing' ? SpeechTurn : TranslationStream;
    const stream = new Type(savedKey || process.env.OPENAI_API_KEY, target, event => { emit('voice-event', { lane, token, ...event }); if (event.type === 'closed' && streams.get(lane) === stream) streams.delete(lane); }, lane === 'outgoing' ? { game: config.game, glossary: config.glossary, synthesize: Boolean(synthesize) } : undefined);
    stream.clientToken = token; streams.set(lane, stream); try { await stream.start(); } catch (e) { stream.cancel(); throw e; } return true;
  });
  ipcMain.on('voice-audio', (e, { lane, token, bytes } = {}) => {
    if (!mainSender(e) || !bytes || !(bytes instanceof Uint8Array) || bytes.length > 48000) return;
    const stream = streams.get(lane); if (!stream || stream.clientToken !== token) return;
    try { stream.append(bytes); } catch (error) { emit('voice-event', { lane, token, type: 'error', message: safeError(error) }); stream.cancel(); }
  });
  expose('voice-bind', ({ lane, token }) => { const stream = streams.get(lane); if (stream) stream.clientToken = token; });
  expose('voice-stop', ({ lane, token, immediate }) => { const stream = streams.get(lane); if (stream?.clientToken === token) immediate ? stream.cancel() : stream.finish(); });
  expose('stop-all', stopAll);
  expose('open-guide', () => shell.openExternal('https://vb-audio.com/Cable/'));
  ipcMain.handle('overlay-control', (event, command) => {
    if (event.sender !== overlay?.webContents || event.senderFrame?.url !== overlayURL) return;
    if (command === 'hide') setOverlay(false);
    if (command === 'lock') { overlayState.locked = !overlayState.locked; overlay.setIgnoreMouseEvents(overlayState.locked, { forward: true }); publishOverlay(); emit('overlay-locked', overlayState.locked); }
  });
  expose('unlock-overlay', () => { overlayState.locked = false; overlay.setIgnoreMouseEvents(false); publishOverlay(); });
});
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } });
app.on('window-all-closed', () => app.quit());
app.on('before-quit', stopAll);
app.on('will-quit', () => globalShortcut.unregisterAll());

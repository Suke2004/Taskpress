const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { Planner, appendLog, syncCurrent } = require('./typewriter-core');

app.setName('Taskpress');
app.setAppUserModelId('local.hermes.taskpress');
if (process.env.TYPEWRITER_DATA_DIR) app.setPath('userData', process.env.TYPEWRITER_DATA_DIR);
else {
  const legacyData = path.join(app.getPath('appData'), 'Typewriter');
  const currentData = app.getPath('userData');
  if (legacyData !== currentData && fs.existsSync(legacyData) && !fs.existsSync(currentData)) {
    fs.mkdirSync(path.dirname(currentData), { recursive: true });
    fs.cpSync(legacyData, currentData, { recursive: true });
  }
}
const configFile = process.env.TYPEWRITER_CONFIG_PATH || path.join(__dirname, 'config.json');
let window, planner, syncing = false, syncError = '', logPath = '', typingSpeedMs = 35;
let syncPromise;
function snapshot() { return { ...planner.state, syncing, syncError, logPath, typingSpeedMs }; }
function publish() { if (window && !window.isDestroyed()) window.webContents.send('page:state', snapshot()); }
async function sync() {
  if (syncPromise) return syncPromise;
  syncing = true; syncError = ''; publish();
  syncPromise = (async () => {
    try {
      do {
        while (planner.state.outbox.length) {
          const event = planner.state.outbox[0];
          const config = await appendLog(configFile, event);
          typingSpeedMs = config.typingSpeedMs;
          planner.acknowledge(event.id);
        }
        logPath = await syncCurrent(configFile, structuredClone(planner.state));
      } while (planner.state.outbox.length);
    } catch (error) { syncError = `Saved locally. Obsidian sync needs attention: ${error.message}`; }
    finally { syncing = false; syncPromise = null; publish(); }
    return snapshot();
  })();
  return syncPromise;
}
function change(action) {
  const result = action();
  publish();
  sync();
  return { ...snapshot(), addedId: typeof result === 'string' ? result : undefined };
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (window) { window.show(); window.focus(); } });
  app.whenReady().then(() => {
    planner = new Planner(path.join(app.getPath('userData'), 'tasks.json'));
    try { const config = JSON.parse(fs.readFileSync(configFile, 'utf8')); if (Number.isInteger(config.typingSpeedMs) && config.typingSpeedMs >= 10 && config.typingSpeedMs <= 100) typingSpeedMs = config.typingSpeedMs; } catch {}
    window = new BrowserWindow({ title: 'Taskpress', width: 420, height: 600, minWidth: 360, minHeight: 480,
      frame: false, transparent: true, resizable: true, alwaysOnTop: planner.state.pinned,
      backgroundColor: '#00000000', show: false,
      webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
    window.setMenu(null);
    window.once('ready-to-show', () => { window.show(); window.setAlwaysOnTop(planner.state.pinned, 'screen-saver'); });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', event => event.preventDefault());
    const pageURL = pathToFileURL(path.join(__dirname, 'index.html')).href;
    const handle = (name, action) => ipcMain.handle(name, (event, ...args) => {
      if (event.sender !== window.webContents || event.senderFrame.url !== pageURL) throw new Error('Untrusted Taskpress request.');
      return action(...args);
    });
    handle('page:read', snapshot);
    handle('page:add', value => change(() => planner.add(value)));
    handle('page:edit', (id, value) => change(() => planner.edit(id, value)));
    handle('page:delete', id => change(() => planner.remove(id)));
    handle('page:toggle', id => change(() => planner.toggle(id)));
    handle('page:clear', () => change(() => planner.clear()));
    handle('page:title', value => change(() => planner.setTitle(value)));
    handle('page:sync', sync);
    handle('window:pin', value => {
      planner.setPinned(value); window.setAlwaysOnTop(value, 'screen-saver'); publish(); return snapshot();
    });
    handle('window:bounds', () => window.getBounds());
    handle('window:move', (x, y) => {
      if (![x, y].every(value => Number.isInteger(value) && Math.abs(value) < 100000)) throw new Error('Invalid window position.');
      window.setPosition(x, y);
    });
    handle('window:size', (width, height) => {
      if (![width, height].every(Number.isInteger) || width < 360 || width > 1200 || height < 480 || height > 1600) throw new Error('Invalid page size.');
      window.setSize(width, height);
    });
    handle('window:close', () => window.close());
    window.loadFile('index.html');
    sync();
  }).catch(error => { dialog.showErrorBox('Taskpress could not open', error.message); app.quit(); });
  app.on('window-all-closed', () => app.quit());
}

const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'typewriter-desktop-'));
const vault = path.join(temp, 'vault'), data = path.join(temp, 'profile'), config = path.join(temp, 'config.json');
fs.mkdirSync(vault); fs.mkdirSync(data); fs.mkdirSync(path.join(root, 'output'), { recursive: true });
const configure = vaultPath => fs.writeFileSync(config, JSON.stringify({ vaultPath, typingSpeedMs: 35, timeZone: 'Asia/Calcutta' }));
configure(vault);
const errors = [];
let app, page;
async function launch() {
  const env = { ...process.env, TYPEWRITER_CONFIG_PATH: config, TYPEWRITER_DATA_DIR: data };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ args: ['.'], cwd: root, env, timeout: 120000 });
  page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForSelector('body[data-ready="true"]');
  await app.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win.isVisible()) await new Promise(resolve => win.once('show', resolve));
    win.setPosition(10000, 10000);
  });
  await page.evaluate(() => {
    const Original = window.AudioContext;
    window.__audioChecks = { clicks: 0, dings: 0, contexts: [] };
    window.AudioContext = class extends Original {
      constructor(...args) {
        super(...args); window.__audioChecks.contexts.push(this);
        const source = this.createBufferSource.bind(this), oscillator = this.createOscillator.bind(this);
        this.createBufferSource = () => { window.__audioChecks.clicks++; return source(); };
        this.createOscillator = () => { window.__audioChecks.dings++; return oscillator(); };
      }
    };
  });
  return page;
}
async function synced() {
  const value = await page.evaluate(() => window.api.appendLog());
  assert.equal(value.syncError, '', value.syncError); assert.equal(value.outbox.length, 0);
}
async function add(value) {
  await page.locator('#task-input').fill(value); await page.locator('#task-input').press('Enter');
  await page.waitForFunction(value => [...document.querySelectorAll('.task-text,.section-label')].some(el => el.textContent === value.replace(/:$/, '')), value);
}
async function close() { if (app) await app.close(); app = null; }
async function run() {
  await launch();
  await page.locator('#title').fill('A LITTLE PROGRESS'); await page.locator('#title').press('Tab');
  await add('Morning rituals:'); await add('Read a chapter'); await add('Make a study plan');
  await add('Video production:'); await add('Film a quiet morning'); await add('Edit the first scene');
  assert.equal(await page.locator('.task-row').count(), 4); assert.equal(await page.locator('.section-row').count(), 2);
  await synced();
  await page.evaluate(() => { document.activeElement.blur(); document.querySelector('#page').scrollTop = 0; });
  await page.screenshot({ path: path.join(root, 'output', 'typewriter-normal.png'), scale: 'css', omitBackground: true });
  console.log('PASS: task input, headings, title and Obsidian additions');

  await page.locator('.check').nth(0).check();
  await page.locator('.task-row').nth(1).focus(); await page.keyboard.press('x');
  await page.waitForFunction(() => document.querySelector('#counter').textContent === '2 / 4 done');
  await synced();
  const logFile = path.join(vault, 'Typewriter', 'Log.md');
  let log = fs.readFileSync(logFile, 'utf8');
  assert.equal((log.match(/^- \[x\]/gm) || []).length, 2);
  assert.match(log, /Read a chapter — \d{4}-\d{2}-\d{2} \d{2}:\d{2}/);
  assert.equal(await page.locator('.done-stamp:visible').count(), 1);
  const sound = await page.evaluate(() => ({ clicks: __audioChecks.clicks, dings: __audioChecks.dings, states: __audioChecks.contexts.map(context => context.state) }));
  assert.ok(sound.clicks > 0 && sound.dings >= 4); assert.ok(sound.states.includes('running'));
  await page.evaluate(() => { document.activeElement.blur(); document.querySelector('#page').scrollTop = 0; });
  await page.screenshot({ path: path.join(root, 'output', 'typewriter-completed.png'), scale: 'css', omitBackground: true });
  console.log('PASS: checkbox and X completion, DONE stamp, generated audio and timestamped completion log');

  await page.locator('#pin').click();
  await page.waitForFunction(() => document.querySelector('#pin').getAttribute('aria-pressed') === 'false');
  await page.waitForTimeout(250);
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isAlwaysOnTop()), false);
  await page.locator('#sound').click();
  await close(); await launch();
  assert.equal(await page.locator('.task-row').count(), 4);
  assert.equal(await page.locator('.check:checked').count(), 2);
  assert.equal(await page.locator('#title').inputValue(), 'A LITTLE PROGRESS');
  assert.equal(await page.locator('#pin').getAttribute('aria-pressed'), 'false');
  assert.equal(await page.locator('#sound').getAttribute('aria-pressed'), 'false');
  console.log('PASS: tasks, checked state, title, pin and sound survive restart');

  const initial = await page.evaluate(() => window.api.getBounds());
  const roller = await page.locator('.roller').boundingBox();
  await page.mouse.move(roller.x + 50, roller.y + 7); await page.mouse.down(); await page.waitForTimeout(80);
  await page.mouse.move(roller.x + 85, roller.y + 27, { steps: 4 }); await page.mouse.up(); await page.waitForTimeout(150);
  const moved = await page.evaluate(() => window.api.getBounds());
  assert.ok(moved.x !== initial.x || moved.y !== initial.y, 'Dragging must move the native window');
  const grip = await page.locator('#resize').boundingBox();
  await page.mouse.move(grip.x + 8, grip.y + 8); await page.mouse.down(); await page.waitForTimeout(80);
  await page.mouse.move(grip.x + 48, grip.y + 38, { steps: 4 }); await page.mouse.up(); await page.waitForTimeout(150);
  const resized = await page.evaluate(() => window.api.getBounds());
  assert.ok(resized.width > moved.width && resized.height > moved.height, 'Resize must change native dimensions');
  await page.locator('#pin').click(); await page.waitForTimeout(250);
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isAlwaysOnTop()), true);
  await page.locator('#resize').focus(); await page.keyboard.press('ArrowLeft');
  assert.equal((await page.evaluate(() => window.api.getBounds())).width, resized.width - 20);
  console.log('PASS: native pin, actual pointer dragging and resizing, accessible resize keys');

  await page.locator('#task-input').focus(); await page.keyboard.press('Control+Shift+D');
  await page.waitForFunction(() => document.querySelectorAll('.task-row').length === 2);
  await synced(); assert.equal((fs.readFileSync(logFile, 'utf8').match(/^- \[x\]/gm) || []).length, 2);
  assert.match(fs.readFileSync(path.join(vault, 'Typewriter', 'current-tasks.md'), 'utf8'), /- \[ \] Film a quiet morning/);
  console.log('PASS: clear shortcut keeps pending tasks and historical completions');

  configure(path.join(temp, 'unavailable-vault'));
  await page.locator('.check').first().check();
  await page.waitForSelector('#sync.error');
  await page.locator('#clear').click();
  await page.waitForFunction(() => document.querySelectorAll('.task-row').length === 1);
  assert.ok((await page.evaluate(() => window.api.readTasks())).outbox.some(event => event.kind === 'completed'));
  await close(); await launch();
  await page.waitForSelector('#sync.error'); configure(vault);
  await page.locator('#sync').click(); await synced();
  log = fs.readFileSync(logFile, 'utf8'); assert.equal((log.match(/^- \[x\]/gm) || []).length, 3);
  await synced(); assert.equal(fs.readFileSync(logFile, 'utf8'), log);
  console.log('PASS: failed sync survives clear/restart; runtime config repair retries without duplicates');

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await add('Reduced motion works 🖋️'); assert.equal(await page.locator('.typing-caret').count(), 0);
  await page.locator('#task-input').fill(''); await page.locator('[data-key="Q"]').click();
  await page.locator('#space').click(); await page.locator('[data-key="W"]').click();
  assert.equal(await page.locator('#task-input').inputValue(), 'q w');
  await page.locator('#backspace').click(); assert.equal(await page.locator('#task-input').inputValue(), 'q ');
  await page.locator('#task-input').press('Escape'); assert.equal(await page.locator('#task-input').evaluate(el => el === document.activeElement), false);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.locator('#task-input').fill('An animated line that saves immediately');
  await page.locator('#task-input').press('Enter');
  await page.waitForSelector('.typing-caret', { timeout: 3000 });
  assert.ok((await page.evaluate(() => window.api.readTasks())).entries.some(entry => entry.text === 'An animated line that saves immediately'));
  await close(); await launch();
  assert.ok((await page.evaluate(() => window.api.readTasks())).entries.some(entry => entry.text === 'An animated line that saves immediately'));
  await synced();
  assert.deepEqual(errors, []);
  console.log('PASS: reduced motion, real on-screen keys, Esc, animated caret and close-mid-animation persistence');

  await add('CRUD checks:'); await add('Draft task');
  let snapshot = await page.evaluate(() => window.api.readTasks());
  const taskId = snapshot.entries.find(entry => entry.text === 'Draft task').id;
  const headingId = snapshot.entries.find(entry => entry.text === 'CRUD checks').id;
  const taskRow = page.locator(`[data-id="${taskId}"]`), headingRow = page.locator(`[data-id="${headingId}"]`);
  await taskRow.locator('.edit-action').click();
  await page.locator('.line-editor').fill(''); await page.locator('.line-editor').press('Enter');
  await page.waitForFunction(() => document.querySelector('#message').textContent.includes('Type something first'));
  assert.equal((await page.evaluate(id => window.api.readTasks().then(state => state.entries.find(entry => entry.id === id).text), taskId)), 'Draft task');
  await page.locator('.line-editor').fill('Revised task');
  await page.evaluate(() => window.api.appendLog());
  assert.equal(await page.locator('.line-editor').inputValue(), 'Revised task');
  await page.locator('.line-editor').press('Enter'); await page.waitForSelector('.line-editor', { state: 'detached' });
  assert.equal(await taskRow.locator('.task-text').textContent(), 'Revised task');
  await taskRow.locator('.edit-action').click(); await page.locator('.line-editor').fill('Cancelled edit');
  await page.locator('.line-editor').press('Escape'); assert.equal(await taskRow.locator('.task-text').textContent(), 'Revised task');
  await taskRow.locator('.check').check(); await synced();
  const completion = (await page.evaluate(() => window.api.readTasks())).entries.find(entry => entry.id === taskId).completedAt;
  await taskRow.locator('.task-text').dblclick(); await page.locator('.line-editor').fill('Final task');
  await taskRow.locator('.edit-action').click(); await page.waitForSelector('.line-editor', { state: 'detached' });
  assert.equal(await taskRow.locator('.check').isChecked(), true);
  assert.equal((await page.evaluate(() => window.api.readTasks())).entries.find(entry => entry.id === taskId).completedAt, completion);
  await headingRow.locator('.edit-action').click(); await page.locator('.line-editor').fill('Revised section:');
  await page.locator('.line-editor').press('Enter'); await page.waitForSelector('.line-editor', { state: 'detached' });
  assert.equal(await headingRow.locator('.section-label').textContent(), 'Revised section');
  await synced();
  let current = fs.readFileSync(path.join(vault, 'Typewriter', 'current-tasks.md'), 'utf8');
  assert.match(current, /## Revised section/); assert.match(current, /- \[x\] Final task/);
  await close(); await launch();
  const savedTaskRow = page.locator(`[data-id="${taskId}"]`), savedHeadingRow = page.locator(`[data-id="${headingId}"]`);
  assert.equal(await savedTaskRow.locator('.task-text').textContent(), 'Final task');
  assert.equal(await savedTaskRow.locator('.check').isChecked(), true);
  console.log('PASS: inline edit, validation, cancel, double-click, saved completion state, section rename and restart');

  await savedHeadingRow.locator('.delete-action').click();
  await page.locator('#keep-line').click(); assert.equal(await savedHeadingRow.count(), 1);
  await savedHeadingRow.locator('.delete-action').click(); await page.locator('#delete-line').click();
  await page.waitForFunction(id => !document.querySelector(`[data-id="${id}"]`), headingId);
  assert.equal(await savedTaskRow.count(), 1);
  configure(path.join(temp, 'offline-crud'));
  await savedTaskRow.locator('.edit-action').click(); await page.locator('.line-editor').fill('Offline revised task');
  await page.locator('.line-editor').press('Enter'); await page.waitForSelector('.line-editor', { state: 'detached' });
  await page.waitForSelector('#sync.error');
  await savedTaskRow.focus(); await page.keyboard.press('Delete');
  await page.locator('#delete-line').click();
  await page.waitForFunction(id => !document.querySelector(`[data-id="${id}"]`), taskId);
  await close(); await launch();
  snapshot = await page.evaluate(() => window.api.readTasks());
  assert.ok(!snapshot.entries.some(entry => entry.id === taskId || entry.id === headingId));
  assert.ok(snapshot.outbox.some(event => event.kind === 'edited' && event.text === 'Offline revised task'));
  assert.ok(snapshot.outbox.some(event => event.kind === 'deleted' && event.text === 'Offline revised task'));
  configure(vault); await synced();
  current = fs.readFileSync(path.join(vault, 'Typewriter', 'current-tasks.md'), 'utf8');
  assert.doesNotMatch(current, /Final task|Offline revised task|Revised section/);
  log = fs.readFileSync(logFile, 'utf8'); assert.match(log, /Revised task/); assert.doesNotMatch(log, /Offline revised task/);
  const journal = fs.readdirSync(path.join(vault, 'Typewriter')).find(name => /^\d{4}-\d{2}-\d{2}\.md$/.test(name));
  const activity = fs.readFileSync(path.join(vault, 'Typewriter', journal), 'utf8');
  assert.match(activity, /edited task: Draft task → Revised task/);
  assert.match(activity, /edited section: CRUD checks → Revised section/);
  assert.match(activity, /deleted section: Revised section/); assert.match(activity, /deleted task: Offline revised task/);
  await synced(); assert.equal(fs.readFileSync(path.join(vault, 'Typewriter', journal), 'utf8'), activity);
  await page.locator('#task-input').fill('Edit while the carriage is typing'); await page.locator('#task-input').press('Enter');
  await page.waitForSelector('.typing-caret');
  await page.locator('.task-row').last().locator('.edit-action').dispatchEvent('click');
  assert.equal(await page.locator('.typing-caret').count(), 0);
  await page.locator('.line-editor').fill('Keyboard'); await page.locator('.line-editor').press('End');
  await page.locator('[data-key="Q"]').click(); assert.equal(await page.locator('.line-editor').inputValue(), 'Keyboardq');
  await page.screenshot({ path: path.join(root, 'output', 'typewriter-editing.png'), scale: 'css', omitBackground: true });
  await page.locator('.line-editor').press('Enter'); await page.waitForSelector('.line-editor', { state: 'detached' });
  assert.equal(await page.locator('.task-text').last().textContent(), 'Keyboardq');
  assert.deepEqual(errors, []);
  console.log('PASS: confirmed/cancelled delete, heading deletion keeps tasks, offline edits/deletes persist, animation editing and on-screen keys');

  await page.evaluate(() => window.api.resize(360, 480));
  assert.ok(await page.locator('#resize').evaluate(el => el.getBoundingClientRect().bottom <= innerHeight));
  assert.ok(await page.locator('#composer').evaluate(el => el.getBoundingClientRect().height >= 30));
  assert.ok(await page.locator('#page').evaluate(el => el.scrollWidth <= el.clientWidth));
  await page.screenshot({ path: path.join(root, 'output', 'typewriter-compact.png'), scale: 'css', omitBackground: true });
  await page.evaluate(() => window.api.resize(420, 600));
  for (const [name, background] of [['dark', '#15151b'], ['light', '#faf4e9'], ['colorful', 'linear-gradient(125deg,#76a68d,#9674be,#d19b67)']]) {
    await page.evaluate(background => document.body.style.background = background, background);
    await page.screenshot({ path: path.join(root, 'output', `typewriter-${name}.png`), scale: 'css' });
  }
  console.log('PASS: compact layout and light/dark/colorful surrounding backgrounds');
}
run().then(async () => { await close(); fs.rmSync(temp, { recursive: true, force: true }); console.log('All desktop checks passed.'); })
  .catch(async error => {
    console.error(error);
    const diagnostic = app?.windows()[0];
    if (diagnostic && !diagnostic.isClosed()) await diagnostic.screenshot({ path: path.join(root, 'output', 'failure.png') }).catch(() => {});
    await close().catch(() => {}); console.error(`Test files kept at ${temp}`); process.exitCode = 1;
  });

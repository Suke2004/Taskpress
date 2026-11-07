const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const validId = value => typeof value === 'string' && /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(value);
function text(value, max = 500) {
  if (typeof value !== 'string' || value.length > max) throw new Error(`Use no more than ${max} characters.`);
  const clean = value.replace(/[\x00-\x1f\x7f]+/g, ' ').trim();
  if (!clean) throw new Error('Type something first.');
  return clean;
}
function atomicWrite(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  const fd = fs.openSync(temp, 'w');
  try { fs.writeFileSync(fd, content, 'utf8'); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
  fs.renameSync(temp, file);
}
class Planner {
  constructor(file, now = Date.now) {
    this.file = file;
    this.now = now;
    this.state = { version: 1, revision: 0, title: "TODAY'S PLAN", pinned: true, entries: [], outbox: [] };
    if (fs.existsSync(file)) {
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (saved.version !== 1 || !Number.isInteger(saved.revision) || saved.revision < 0
        || typeof saved.pinned !== 'boolean' || !Array.isArray(saved.entries) || !Array.isArray(saved.outbox)) {
        throw new Error('Saved page is invalid. It has been left untouched.');
      }
      text(saved.title, 80);
      const ids = new Set();
      for (const entry of saved.entries) {
        text(entry.text);
        if (!validId(entry.id) || ids.has(entry.id) || !['task', 'section'].includes(entry.type) || !Number.isFinite(entry.createdAt)
          || typeof entry.section !== 'string' || entry.section.length > 500 || typeof entry.done !== 'boolean'
          || (entry.done ? !Number.isFinite(entry.completedAt) : entry.completedAt !== null)
          || (entry.type === 'section' && entry.done)) {
          throw new Error('A saved line is invalid. The page has been left untouched.');
        }
        ids.add(entry.id);
      }
      for (const event of saved.outbox) {
        if (!validId(event.id) || !['added', 'section', 'completed', 'reopened', 'cleared', 'title', 'edited', 'deleted'].includes(event.kind)
          || !Number.isFinite(event.at) || typeof event.section !== 'string' || event.section.length > 500) throw new Error('A queued log is invalid. It has been left untouched.');
        text(event.text);
        text(event.title, 80);
        if (['edited', 'deleted'].includes(event.kind) && !['task', 'section'].includes(event.entryType)) throw new Error('A queued edit is invalid. It has been left untouched.');
        if (event.kind === 'edited') text(event.previousText);
      }
      this.state = saved;
    }
  }
  save() { atomicWrite(this.file, JSON.stringify(this.state)); }
  change(action) {
    const before = structuredClone(this.state);
    try { const result = action(); this.state.revision++; this.save(); return result; }
    catch (error) { this.state = before; throw error; }
  }
  event(kind, value, section = '', details = {}) {
    this.state.outbox.push({ id: randomUUID(), kind, text: value, section,
      title: this.state.title, at: this.now(), ...details });
  }
  add(value) {
    const clean = text(value);
    const isSection = clean.endsWith(':');
    const label = isSection ? text(clean.slice(0, -1)) : clean;
    if (this.state.entries.length >= 1000) throw new Error('This page is full. Feed out completed lines first.');
    return this.change(() => {
      const section = [...this.state.entries].reverse().find(entry => entry.type === 'section');
      const entry = { id: randomUUID(), type: isSection ? 'section' : 'task', text: label,
        createdAt: this.now(), done: false, completedAt: null, section: section?.text || '' };
      this.state.entries.push(entry);
      this.event(isSection ? 'section' : 'added', label, entry.section);
      return entry.id;
    });
  }
  find(id) {
    if (!validId(id)) throw new Error('That line is invalid.');
    const entry = this.state.entries.find(entry => entry.id === id);
    if (!entry) throw new Error('That line is no longer on this page.');
    return entry;
  }
  refreshSections() {
    let section = '';
    for (const entry of this.state.entries) {
      entry.section = section;
      if (entry.type === 'section') section = entry.text;
    }
  }
  edit(id, value) {
    const entry = this.find(id), clean = text(value);
    const label = entry.type === 'section' && clean.endsWith(':') ? text(clean.slice(0, -1)) : clean;
    if (label === entry.text) return;
    this.change(() => {
      const previousText = entry.text;
      entry.text = label;
      this.refreshSections();
      this.event('edited', label, entry.section, { entryType: entry.type, previousText });
    });
  }
  remove(id) {
    const entry = this.find(id);
    this.change(() => {
      this.event('deleted', entry.text, entry.section, { entryType: entry.type });
      this.state.entries = this.state.entries.filter(item => item.id !== id);
      this.refreshSections();
    });
  }
  toggle(id) {
    const entry = this.find(id);
    if (entry.type !== 'task') throw new Error('Only tasks can be checked off.');
    this.change(() => {
      entry.done = !entry.done;
      entry.completedAt = entry.done ? this.now() : null;
      this.event(entry.done ? 'completed' : 'reopened', entry.text, entry.section);
    });
  }
  clear() {
    const count = this.state.entries.filter(entry => entry.type === 'task' && entry.done).length;
    if (!count) return 0;
    return this.change(() => {
      this.state.entries = this.state.entries.filter(entry => entry.type !== 'task' || !entry.done);
      this.event('cleared', `${count} completed task${count === 1 ? '' : 's'} fed out`);
      return count;
    });
  }
  setTitle(value) {
    const clean = text(value, 80);
    if (clean === this.state.title) return;
    this.change(() => { this.state.title = clean; this.event('title', clean); });
  }
  setPinned(value) {
    if (typeof value !== 'boolean') throw new Error('Invalid pin setting.');
    this.change(() => { this.state.pinned = value; });
  }
  acknowledge(id) {
    const before = this.state.outbox;
    this.state.outbox = before.filter(event => event.id !== id);
    try { this.save(); } catch (error) { this.state.outbox = before; throw error; }
  }
}
function stamp(at, timeZone = 'Asia/Calcutta') {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(at));
  const value = type => parts.find(part => part.type === type).value;
  return `${value('year')}-${value('month')}-${value('day')} ${value('hour')}:${value('minute')}`;
}
const markdown = value => text(value).replace(/[\\`*_{}\[\]<>~]/g, '\\$&');
async function settings(configFile) {
  const config = JSON.parse(await fsp.readFile(configFile, 'utf8'));
  if (typeof config.vaultPath !== 'string' || !config.vaultPath.trim() || !path.isAbsolute(config.vaultPath)) {
    throw new Error('Set vaultPath in config.json to an existing Obsidian vault.');
  }
  if (!(await fsp.stat(config.vaultPath)).isDirectory()) throw new Error('The Obsidian vault is not a folder.');
  stamp(Date.now(), config.timeZone || 'Asia/Calcutta');
  return { ...config, timeZone: config.timeZone || 'Asia/Calcutta', typingSpeedMs:
    Number.isInteger(config.typingSpeedMs) && config.typingSpeedMs >= 10 && config.typingSpeedMs <= 100 ? config.typingSpeedMs : 35 };
}
async function appendOnce(file, event, line, heading) {
  let existing = '';
  try { existing = await fsp.readFile(file, 'utf8'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const marker = `<!-- typewriter-event: ${event.id} -->`;
  // shortcut: scan event markers in the file; index them if histories become very large.
  if (existing.includes(marker)) return;
  const fd = await fsp.open(file, 'a');
  try { await fd.writeFile(`${existing ? (existing.endsWith('\n') ? '' : '\n') : heading + '\n\n'}${line} ${marker}\n`); await fd.sync(); }
  finally { await fd.close(); }
}
async function appendLog(configFile, event) {
  const config = await settings(configFile);
  const folder = path.join(config.vaultPath, 'Typewriter');
  await fsp.mkdir(folder, { recursive: true });
  const time = stamp(event.at, config.timeZone);
  const label = markdown(event.text);
  if (event.kind === 'completed') {
    await appendOnce(path.join(folder, 'Log.md'), event, `- [x] ${label} — ${time}`, '# Typewriter Log');
  }
  const line = event.kind === 'added' ? `- [ ] ${label} — added ${time}`
    : event.kind === 'completed' ? `- [x] ${label} — ${time}`
    : event.kind === 'section' ? `## ${label}`
    : event.kind === 'edited' ? `- ${time} · edited ${event.entryType}: ${markdown(event.previousText)} → ${label}`
    : event.kind === 'deleted' ? `- ${time} · deleted ${event.entryType}: ${label}`
    : `- ${time} · ${event.kind}: ${label}`;
  const context = ['added', 'completed', 'edited', 'deleted'].includes(event.kind)
    ? ` · ${markdown(event.title)}${event.section ? ' / ' + markdown(event.section) : ''}` : '';
  await appendOnce(path.join(folder, `${time.slice(0, 10)}.md`), event, line + context, `# Typewriter · ${time.slice(0, 10)}`);
  return config;
}
function currentPage(state, timeZone) {
  const lines = [`# ${markdown(state.title)}`, ''];
  for (const entry of state.entries) {
    if (entry.type === 'section') lines.push('', `## ${markdown(entry.text)}`, '');
    else lines.push(`- [${entry.done ? 'x' : ' '}] ${markdown(entry.text)}${entry.done ? ` — done ${stamp(entry.completedAt, timeZone)}` : ''}`);
  }
  if (!state.entries.length) lines.push('_A fresh page. Add your first task in Typewriter._');
  return lines.join('\n');
}
async function syncCurrent(configFile, state) {
  const config = await settings(configFile);
  const folder = path.join(config.vaultPath, 'Typewriter');
  await fsp.mkdir(folder, { recursive: true });
  const file = path.join(folder, 'current-tasks.md');
  let existing = '';
  try { existing = await fsp.readFile(file, 'utf8'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const start = '<!-- typewriter:begin -->', end = '<!-- typewriter:end -->';
  const block = `${start}\n<!-- Managed by Typewriter. Put handwritten notes outside this block. -->\n${currentPage(state, config.timeZone)}\n${end}`;
  const a = existing.indexOf(start), b = existing.indexOf(end);
  if ((a < 0) !== (b < 0) || (a >= 0 && (b < a || existing.indexOf(start, a + 1) >= 0 || existing.indexOf(end, b + 1) >= 0))) {
    throw new Error('The managed markers in current-tasks.md need repair. Your note was left untouched.');
  }
  const result = a < 0 ? `${existing}${existing ? '\n\n' : ''}${block}\n`
    : existing.slice(0, a) + block + existing.slice(b + end.length);
  if (result !== existing) atomicWrite(file, result);
  return file;
}
module.exports = { Planner, text, stamp, settings, appendLog, syncCurrent, currentPage, atomicWrite };

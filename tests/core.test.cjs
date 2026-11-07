const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { Planner, text, stamp, settings, appendLog, syncCurrent } = require('../typewriter-core');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'typewriter-core-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const config = path.join(root, 'config.json');
  fs.writeFileSync(config, JSON.stringify({ vaultPath: root, timeZone: 'Asia/Calcutta' }));
  const planner = new Planner(path.join(root, 'tasks.json'), () => Date.parse('2026-11-07T10:15:00Z'));
  return { root, config, planner, read: file => fs.readFileSync(path.join(root, 'Typewriter', file), 'utf8') };
}
test('tasks, sections, reopening, clearing and title persist; pending log events survive clearing', t => {
  const { planner } = fixture(t);
  planner.setTitle('STUDY DAY'); planner.add('Study:');
  const a = planner.add('Read one chapter'), b = planner.add('Take notes');
  assert.equal(planner.state.entries[1].section, 'Study');
  planner.toggle(a); planner.toggle(a); planner.toggle(a);
  assert.equal(planner.state.entries[1].completedAt, Date.parse('2026-11-07T10:15:00Z'));
  assert.equal(planner.clear(), 1);
  const restored = new Planner(planner.file);
  assert.equal(restored.state.title, 'STUDY DAY');
  assert.deepEqual(restored.state.entries.map(entry => entry.id), [planner.state.entries[0].id, b]);
  assert.equal(restored.state.outbox.filter(event => event.kind === 'completed').length, 2);
  assert.equal(restored.state.outbox.filter(event => event.kind === 'reopened').length, 1);
  assert.equal(restored.state.outbox.at(-1).kind, 'cleared');
});
test('input boundaries and bad storage do not mutate saved data', t => {
  const { planner } = fixture(t); const id = planner.add('A task');
  const before = fs.readFileSync(planner.file, 'utf8');
  for (const value of ['', '  ', ':', null, 123, 'x'.repeat(501)]) assert.throws(() => planner.add(value));
  assert.throws(() => planner.toggle('not-an-id'));
  assert.throws(() => planner.setPinned('yes'));
  assert.equal(text(' a\n b\t c\0 '), 'a  b  c');
  assert.equal(fs.readFileSync(planner.file, 'utf8'), before);
  const bad = JSON.parse(before); bad.entries[0].done = true;
  fs.writeFileSync(planner.file, JSON.stringify(bad));
  const savedBad = fs.readFileSync(planner.file, 'utf8');
  assert.throws(() => new Planner(planner.file), /saved line is invalid/);
  assert.equal(fs.readFileSync(planner.file, 'utf8'), savedBad);
  bad.entries[0].done = false; bad.entries.push({ ...bad.entries[0], id });
  fs.writeFileSync(planner.file, JSON.stringify(bad));
  assert.throws(() => new Planner(planner.file), /saved line is invalid/);
});
test('failed local save rolls back the in-memory mutation', t => {
  const { root, planner } = fixture(t); planner.add('Kept');
  const before = structuredClone(planner.state);
  planner.file = root;
  assert.throws(() => planner.add('Cannot save'));
  assert.throws(() => planner.edit(before.entries[0].id, 'Cannot edit'));
  assert.throws(() => planner.remove(before.entries[0].id));
  assert.deepEqual(planner.state, before);
});
test('editing tasks preserves identity, completion and pending history across restart', t => {
  const { planner } = fixture(t); const id = planner.add('Original task'); planner.toggle(id);
  const original = structuredClone(planner.find(id));
  planner.edit(id, 'Revised task:');
  const restored = new Planner(planner.file), edited = restored.find(id);
  assert.equal(edited.text, 'Revised task:'); assert.equal(edited.type, 'task');
  assert.equal(edited.done, true); assert.equal(edited.createdAt, original.createdAt);
  assert.equal(edited.completedAt, original.completedAt);
  assert.equal(restored.state.outbox.find(event => event.kind === 'completed').text, 'Original task');
  assert.equal(restored.state.outbox.at(-1).previousText, 'Original task');
  const revision = restored.state.revision; restored.edit(id, 'Revised task:'); assert.equal(restored.state.revision, revision);
  restored.remove(id); assert.equal(new Planner(planner.file).state.entries.length, 0);
  assert.ok(restored.state.outbox.some(event => event.kind === 'completed'));
});
test('editing and deleting headings update only their group; deleting a heading keeps tasks', t => {
  const { planner } = fixture(t);
  const first = planner.add('Study:'), a = planner.add('Chapter one');
  const second = planner.add('Study:'), b = planner.add('Chapter two');
  const third = planner.add('Film:'), c = planner.add('Camera prep');
  planner.edit(first, 'Reading:');
  assert.equal(planner.find(a).section, 'Reading'); assert.equal(planner.find(b).section, 'Study');
  planner.remove(second);
  assert.equal(planner.find(b).section, 'Reading'); assert.equal(planner.find(c).section, 'Film');
  planner.remove(first); assert.equal(planner.find(a).section, ''); assert.equal(planner.find(b).section, '');
  assert.deepEqual(planner.state.entries.map(entry => entry.id), [a, b, third, c]);
  planner.toggle(b); assert.equal(planner.state.outbox.at(-1).section, '');
  assert.deepEqual(new Planner(planner.file).state.entries, planner.state.entries);
});
test('invalid edit/delete requests do not change saved state', t => {
  const { planner } = fixture(t); const section = planner.add('Plan:'), id = planner.add('Keep me');
  const before = fs.readFileSync(planner.file, 'utf8');
  for (const value of ['', ' ', null, 123, 'a'.repeat(501)]) assert.throws(() => planner.edit(id, value));
  assert.throws(() => planner.edit(section, ':'));
  assert.throws(() => planner.edit('invalid', 'Renamed')); assert.throws(() => planner.remove('invalid'));
  assert.throws(() => planner.remove('11111111-1111-1111-1111-111111111111'));
  assert.throws(() => planner.toggle(section));
  assert.equal(fs.readFileSync(planner.file, 'utf8'), before);
});
test('edit/delete journal events append once; completion history keeps the original text', async t => {
  const f = fixture(t); const section = f.planner.add('Original plan:'), id = f.planner.add('Original task');
  f.planner.toggle(id); f.planner.edit(id, 'Revised task'); f.planner.edit(section, 'Revised plan:');
  await syncCurrent(f.config, f.planner.state);
  assert.match(f.read('current-tasks.md'), /## Revised plan/); assert.match(f.read('current-tasks.md'), /- \[x\] Revised task/);
  f.planner.remove(id); f.planner.remove(section);
  const restored = new Planner(f.planner.file);
  for (const event of restored.state.outbox) { await appendLog(f.config, event); await appendLog(f.config, event); }
  const log = f.read('Log.md'), day = f.read('2026-11-07.md');
  assert.equal((log.match(/^- \[x\]/gm) || []).length, 1);
  assert.match(log, /Original task/); assert.doesNotMatch(log, /Revised task/);
  assert.equal((day.match(/edited task: Original task → Revised task/g) || []).length, 1);
  assert.match(day, /edited section: Original plan → Revised plan/);
  assert.match(day, /deleted task: Revised task/); assert.match(day, /deleted section: Revised plan/);
  await syncCurrent(f.config, restored.state); assert.doesNotMatch(f.read('current-tasks.md'), /Revised task/);
});
test('maximum-length edits remain restorable and loggable', async t => {
  const f = fixture(t); const id = f.planner.add('a'.repeat(500)); f.planner.edit(id, 'b'.repeat(500));
  const restored = new Planner(f.planner.file);
  await appendLog(f.config, restored.state.outbox.at(-1));
  assert.match(f.read('2026-11-07.md'), /a{500} → b{500}/);
});
test('completion log and daily activity append once per event, with local timestamps', async t => {
  const f = fixture(t); f.planner.setTitle('Video day'); f.planner.add('Film:');
  const id = f.planner.add('Film [intro]'); f.planner.toggle(id); f.planner.toggle(id); f.planner.clear();
  f.planner.toggle(id); f.planner.clear();
  for (const event of f.planner.state.outbox) { await appendLog(f.config, event); await appendLog(f.config, event); }
  assert.equal(stamp(Date.parse('2026-11-07T10:15:00Z')), '2026-11-07 15:45');
  const log = f.read('Log.md'), day = f.read('2026-11-07.md');
  assert.equal((log.match(/^- \[x\]/gm) || []).length, 2);
  assert.match(log, /Film \\\[intro\\\] — 2026-11-07 15:45/);
  assert.match(day, /- \[ \]/); assert.match(day, /## Film/);
  assert.match(day, /title: Video day/); assert.match(day, /reopened:/); assert.match(day, /cleared:/);
});
test('current page mirrors sections and checks while preserving handwritten notes', async t => {
  const f = fixture(t); f.planner.add('Study:'); const id = f.planner.add('Read'); f.planner.toggle(id);
  const file = await syncCurrent(f.config, f.planner.state);
  fs.writeFileSync(file, 'Keep above\n' + fs.readFileSync(file, 'utf8') + '\nKeep below\n');
  f.planner.add('Pending'); await syncCurrent(f.config, f.planner.state);
  let current = f.read('current-tasks.md');
  assert.match(current, /^Keep above/); assert.match(current, /Keep below\n$/);
  assert.match(current, /## Study/); assert.match(current, /- \[x\] Read — done 2026-11-07 15:45/);
  assert.match(current, /- \[ \] Pending/);
  f.planner.clear(); await syncCurrent(f.config, f.planner.state);
  current = f.read('current-tasks.md'); assert.doesNotMatch(current, /Read/); assert.match(current, /Pending/);
});
test('existing note without markers is retained; broken markers never overwrite it', async t => {
  const f = fixture(t); fs.mkdirSync(path.join(f.root, 'Typewriter'));
  const file = path.join(f.root, 'Typewriter', 'current-tasks.md');
  fs.writeFileSync(file, 'My original note'); await syncCurrent(f.config, f.planner.state);
  assert.match(f.read('current-tasks.md'), /^My original note/);
  const bad = 'Keep me\n<!-- typewriter:begin -->\n'; fs.writeFileSync(file, bad);
  await assert.rejects(syncCurrent(f.config, f.planner.state), /markers/);
  assert.equal(fs.readFileSync(file, 'utf8'), bad);
});
test('runtime config can be repaired after failure without losing queued completions', async t => {
  const f = fixture(t); const id = f.planner.add('Offline task'); f.planner.toggle(id); f.planner.clear();
  const queued = structuredClone(f.planner.state.outbox);
  fs.writeFileSync(f.config, JSON.stringify({ vaultPath: path.join(f.root, 'missing') }));
  await assert.rejects(appendLog(f.config, queued.find(event => event.kind === 'completed')));
  assert.deepEqual(new Planner(f.planner.file).state.outbox, queued);
  const newVault = path.join(f.root, 'new-vault'); fs.mkdirSync(newVault);
  fs.writeFileSync(f.config, JSON.stringify({ vaultPath: newVault, typingSpeedMs: 45 }));
  assert.equal((await settings(f.config)).typingSpeedMs, 45);
  for (const event of queued) { await appendLog(f.config, event); f.planner.acknowledge(event.id); }
  assert.equal(new Planner(f.planner.file).state.outbox.length, 0);
  assert.match(fs.readFileSync(path.join(newVault, 'Typewriter', 'Log.md'), 'utf8'), /Offline task/);
});

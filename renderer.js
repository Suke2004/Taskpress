const $ = selector => document.querySelector(selector);
const input = $('#task-input'), entries = $('#entries'), page = $('#page');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
let state = null, selected = null, clearing = false, audio = null, editSession = null, deleteId = null, deleteBusy = false;
let soundEnabled = localStorage.getItem('typewriter-sound') !== 'off';
const reveals = new Map();
const segments = value => typeof Intl.Segmenter === 'function'
  ? [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(value)].map(item => item.segment) : [...value];
$('#date').textContent = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase();
$('#sound').setAttribute('aria-pressed', String(soundEnabled));
function message(value = '') { $('#message').textContent = value; }
function announce(value) { $('#announcer').textContent = value; }
function sound(kind = 'type') {
  if (!soundEnabled) return;
  try {
    audio ||= new AudioContext();
    if (audio.state === 'suspended') audio.resume().catch(() => {});
    const now = audio.currentTime, gain = audio.createGain();
    gain.connect(audio.destination);
    gain.gain.setValueAtTime(kind === 'type' ? .54 : .07, now);
    gain.gain.exponentialRampToValueAtTime(.001, now + (kind === 'ding' ? .28 : .045));
    if (kind === 'ding') {
      for (const frequency of [1320, 2112]) {
        const tone = audio.createOscillator(); tone.frequency.value = frequency;
        tone.connect(gain); tone.start(now); tone.stop(now + .28);
      }
    } else {
      const buffer = audio.createBuffer(1, Math.ceil(audio.sampleRate * .04), audio.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
      const noise = audio.createBufferSource(), filter = audio.createBiquadFilter();
      noise.buffer = buffer; filter.type = 'bandpass'; filter.frequency.value = kind === 'clear' ? 800 : 1900;
      noise.connect(filter); filter.connect(gain); noise.start(now);
    }
  } catch { /* Audio may be unavailable; tasks and logging still work. */ }
}
function pressKey(value) {
  const key = [...document.querySelectorAll('[data-key]')].find(button => button.dataset.key === value.toUpperCase())
    || (value === ' ' ? $('#space') : value === 'Backspace' ? $('#backspace') : null);
  if (!key) return;
  key.classList.add('pressed'); setTimeout(() => key.classList.remove('pressed'), 100);
}
function select(id) {
  selected = id;
  for (const row of entries.children) row.classList.toggle('selected', row.dataset.id === id);
}
function rowFor(entry) {
  const row = document.createElement('div'); row.dataset.id = entry.id; row.setAttribute('role', 'listitem');
  if (entry.type === 'section') {
    row.className = 'section-row';
    const label = document.createElement('span'), stamp = document.createElement('span');
    label.className = 'section-label'; label.textContent = entry.text;
    stamp.className = 'done-stamp'; stamp.textContent = 'DONE'; stamp.hidden = true;
    row.append(label, stamp);
  } else {
    row.className = 'task-row'; row.tabIndex = 0;
    const check = document.createElement('input'), label = document.createElement('span'), ink = document.createElement('span');
    check.type = 'checkbox'; check.className = 'check'; check.setAttribute('aria-label', entry.text);
    label.className = 'task-label'; ink.className = 'task-text'; ink.textContent = entry.text;
    label.append(ink); row.append(check, label);
    check.addEventListener('change', () => toggle(entry.id));
    row.addEventListener('keydown', event => {
      if (event.key === 'Enter' && event.target === row) { event.preventDefault(); toggle(entry.id); }
    });
  }
  row.tabIndex = 0;
  const actions = document.createElement('span'); actions.className = 'line-actions';
  const edit = document.createElement('button'), remove = document.createElement('button');
  edit.className = 'edit-action'; remove.className = 'delete-action';
  edit.addEventListener('click', () => editSession?.id === entry.id ? saveEdit() : startEdit(entry.id));
  remove.addEventListener('click', () => editSession?.id === entry.id ? endEdit() : requestDelete(entry.id));
  actions.append(edit, remove); row.append(actions); rowActions(row, entry);
  row.addEventListener('focusin', () => select(entry.id));
  row.addEventListener('click', event => { select(entry.id); if (!event.target.closest('button,input')) row.focus(); });
  row.addEventListener('dblclick', event => { if (event.target.closest('.task-label,.section-label')) startEdit(entry.id); });
  return row;
}
function rowActions(row, entry) {
  const editing = editSession?.id === entry.id;
  const edit = row.querySelector('.edit-action'), remove = row.querySelector('.delete-action');
  edit.textContent = editing ? '✓' : '✎'; remove.textContent = '×';
  edit.title = editing ? 'Save edit · Enter' : `Edit ${entry.type} · F2`;
  remove.title = editing ? 'Cancel edit · Esc' : `Delete ${entry.type}${entry.type === 'section' ? ' (keep tasks)' : ''}`;
  edit.setAttribute('aria-label', editing ? 'Save edit' : `Edit ${entry.type}`);
  remove.setAttribute('aria-label', editing ? 'Cancel edit' : `Delete ${entry.type}`);
  edit.disabled = remove.disabled = !!(editing && editSession.saving);
}
function endEdit(focus = true) {
  if (!editSession || editSession.saving) return;
  const { id, element } = editSession, row = element.parentElement;
  element.remove(); row.querySelector('.task-label,.section-label').hidden = false; row.classList.remove('editing');
  const check = row.querySelector('.check'); if (check) check.disabled = false;
  editSession = null;
  const entry = state.entries.find(item => item.id === id); if (entry) rowActions(row, entry);
  $('#clear').disabled = $('#feed').disabled = !state.entries.some(item => item.done);
  message();
  if (focus && row.isConnected) row.focus();
}
function startEdit(id) {
  if (editSession?.saving) return;
  endEdit(false);
  const entry = state.entries.find(item => item.id === id), row = [...entries.children].find(item => item.dataset.id === id);
  if (!entry || !row) return;
  stopReveal(id);
  const label = row.querySelector('.task-label,.section-label'), editor = document.createElement('input');
  editor.className = 'line-editor'; editor.value = entry.text; editor.maxLength = 500;
  editor.setAttribute('aria-label', `Edit ${entry.type} text`);
  label.hidden = true; label.before(editor); row.classList.add('editing');
  editSession = { id, element: editor, saving: false }; rowActions(row, entry);
  const check = row.querySelector('.check'); if (check) check.disabled = true;
  $('#clear').disabled = $('#feed').disabled = true;
  editor.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation();
      if (event.key === 'Enter') saveEdit(); else { endEdit(); message(); }
    }
  });
  select(id); editor.focus(); editor.select(); message();
}
async function saveEdit() {
  if (!editSession || editSession.saving) return;
  const session = editSession; session.saving = true; session.element.disabled = true;
  rowActions(session.element.parentElement, state.entries.find(item => item.id === session.id));
  try {
    const next = await window.api.editEntry(session.id, session.element.value);
    session.saving = false; endEdit(); render(next); sound('type'); message(); announce('Edit saved.');
  } catch (error) {
    session.saving = false; session.element.disabled = false;
    rowActions(session.element.parentElement, state.entries.find(item => item.id === session.id));
    session.element.focus(); message(error.message);
  }
}
function requestDelete(id) {
  const entry = state.entries.find(item => item.id === id); if (!entry) return;
  deleteId = id;
  $('#delete-text').textContent = entry.text;
  $('#delete-note').textContent = entry.type === 'section' ? 'Only the heading is removed. Its tasks stay on the page.' : 'The completion history is kept.';
  $('#delete-error').textContent = '';
  $('#delete-dialog').showModal();
}
$('#keep-line').addEventListener('click', () => $('#delete-dialog').close());
$('#delete-dialog').addEventListener('cancel', event => { if (deleteBusy) event.preventDefault(); });
$('#delete-dialog').addEventListener('close', () => { deleteId = null; });
$('#delete-line').addEventListener('click', async () => {
  if (!deleteId || deleteBusy) return;
  deleteBusy = true; $('#keep-line').disabled = $('#delete-line').disabled = true;
  try {
    render(await window.api.deleteEntry(deleteId)); $('#delete-dialog').close();
    sound('clear'); message(); announce('Line removed.');
    if (!editSession) input.focus();
  } catch (error) { $('#delete-error').textContent = error.message; }
  finally { deleteBusy = false; $('#keep-line').disabled = $('#delete-line').disabled = false; }
});
function stopReveal(id) {
  const reveal = reveals.get(id);
  if (reveal) { cancelAnimationFrame(reveal.frame); reveal.finish(); }
}
function render(next) {
  if (state && next.revision < state.revision) return;
  const previous = new Map((state?.entries || []).map(entry => [entry.id, entry]));
  state = next;
  const ids = new Set(next.entries.map(entry => entry.id));
  if (editSession && !ids.has(editSession.id)) endEdit(false);
  for (const row of [...entries.children]) {
    if (ids.has(row.dataset.id) || row.classList.contains('ejecting')) continue;
    stopReveal(row.dataset.id);
    if (row.classList.contains('done') && !reducedMotion.matches) {
      row.classList.add('ejecting'); setTimeout(() => row.remove(), 280);
    } else row.remove();
  }
  for (const entry of next.entries) {
    let row = [...entries.children].find(item => item.dataset.id === entry.id);
    if (!row) { row = rowFor(entry); entries.append(row); }
    if (previous.get(entry.id)?.text !== entry.text) stopReveal(entry.id);
    if (!reveals.has(entry.id)) row.querySelector('.task-text,.section-label').textContent = entry.text;
    rowActions(row, entry);
    if (entry.type === 'task') {
      row.querySelector('.check').checked = entry.done;
      row.querySelector('.check').setAttribute('aria-label', entry.text);
      row.classList.toggle('done', entry.done);
      row.title = entry.done ? `Completed ${new Date(entry.completedAt).toLocaleString()}. Click to reopen.` : 'Click the box or press X to complete';
      if (entry.done && previous.get(entry.id)?.done === false) {
        row.classList.remove('stamped'); void row.offsetWidth; row.classList.add('stamped');
        setTimeout(() => row.classList.remove('stamped'), 300); sound('ding');
        announce(`Completed: ${entry.text}`);
      }
    }
  }
  let section = null, sectionTasks = [];
  function markSection() {
    if (!section) return;
    const row = [...entries.children].find(item => item.dataset.id === section.id);
    row.querySelector('.done-stamp').hidden = !sectionTasks.length || !sectionTasks.every(task => task.done);
  }
  for (const entry of next.entries) {
    if (entry.type === 'section') { markSection(); section = entry; sectionTasks = []; }
    else sectionTasks.push(entry);
  }
  markSection();
  if (document.activeElement !== $('#title')) $('#title').value = next.title;
  $('#pin').setAttribute('aria-pressed', String(next.pinned));
  const tasks = next.entries.filter(entry => entry.type === 'task'), count = tasks.filter(entry => entry.done).length;
  $('#counter').textContent = `${count} / ${tasks.length} done`;
  $('#clear').disabled = $('#feed').disabled = !count || !!editSession;
  $('#empty').hidden = !!next.entries.length;
  const sync = $('#sync'); sync.classList.toggle('error', !!next.syncError);
  sync.textContent = next.syncError ? `↻ Retry sync${next.outbox.length ? ' (' + next.outbox.length + ')' : ''}`
    : next.syncing ? '↻ Syncing…' : '✓ Obsidian';
  sync.title = next.syncError || 'Saved locally and synced to Obsidian · click to refresh';
  select(ids.has(selected) ? selected : null);
}
function feedPaper(row) {
  $('.paper').classList.remove('feed'); void $('.paper').offsetWidth; $('.paper').classList.add('feed');
  setTimeout(() => $('.paper').classList.remove('feed'), 250);
  row?.scrollIntoView({ block: 'nearest', behavior: reducedMotion.matches ? 'instant' : 'smooth' });
}
function reveal(id) {
  const entry = state.entries.find(item => item.id === id), row = [...entries.children].find(item => item.dataset.id === id);
  if (!row || !entry) return;
  feedPaper(row);
  if (reducedMotion.matches) { sound('type'); return; }
  const ink = row.querySelector(entry.type === 'task' ? '.task-text' : '.section-label');
  const letters = segments(entry.text), duration = Math.min(400, letters.length * state.typingSpeedMs);
  const caret = document.createElement('span'); caret.className = 'typing-caret'; caret.setAttribute('aria-hidden', 'true');
  const accessible = document.createElement('span'); accessible.className = 'sr-only'; accessible.textContent = entry.text;
  ink.textContent = ''; ink.setAttribute('aria-hidden', 'true'); ink.after(caret, accessible); row.classList.add('typing');
  const record = { frame: 0 }, start = performance.now(); let shown = 0, lastSound = 0;
  reveals.set(id, record);
  function finish() {
    ink.textContent = entry.text; ink.removeAttribute('aria-hidden'); caret.remove(); accessible.remove(); row.classList.remove('typing'); reveals.delete(id);
  }
  record.finish = finish;
  function tick(now) {
    if (reducedMotion.matches) { finish(); return; }
    const count = Math.min(letters.length, Math.max(1, Math.floor((now - start) / duration * letters.length)));
    if (count !== shown) { ink.textContent = letters.slice(0, count).join(''); shown = count; if (now - lastSound > 30) { sound('type'); lastSound = now; } }
    if (shown >= letters.length) finish(); else record.frame = requestAnimationFrame(tick);
  }
  record.frame = requestAnimationFrame(tick);
}
async function add(event) {
  event?.preventDefault(); const value = input.value;
  if (!value.trim()) { input.focus(); return; }
  input.value = '';
  try { const next = await window.api.addTask(value); render(next); reveal(next.addedId); message(); announce(`Added: ${value}`); }
  catch (error) { input.value = value + input.value; message(error.message); }
  input.focus();
}
async function toggle(id) {
  try { render(await window.api.completeTask(id)); message(); }
  catch (error) { render(await window.api.readTasks()); message(error.message); }
}
async function clearCompleted() {
  if (editSession) { message('Save or cancel your edit before feeding out completed lines.'); return; }
  if (clearing || !state?.entries.some(entry => entry.done)) return;
  clearing = true;
  try { render(await window.api.clearCompleted()); sound('clear'); feedPaper(); announce('Completed lines fed out. Pending tasks kept.'); message(); }
  catch (error) { message(error.message); }
  finally { clearing = false; }
}
function typeKey(value) {
  if (editSession?.saving) return;
  const target = editSession?.element || input;
  target.focus(); const a = target.selectionStart, b = target.selectionEnd;
  if (value === 'Backspace' && a === b && a > 0) {
    const length = segments(target.value.slice(0, a)).at(-1).length;
    target.setRangeText('', a - length, b, 'end');
  } else target.setRangeText(value === 'Backspace' ? '' : value, a, b, 'end');
  if (target.value.length > 500) target.value = target.value.slice(0, 500);
  pressKey(value); sound('type');
}
for (const values of ['1234567890', 'QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM']) {
  const row = document.createElement('div'); row.className = 'key-row';
  for (const value of values) {
    const key = document.createElement('button'); key.className = 'key'; key.textContent = value; key.dataset.key = value;
    key.setAttribute('aria-label', `Type ${value}`); key.addEventListener('pointerdown', event => event.preventDefault());
    key.addEventListener('click', () => typeKey(value.toLowerCase())); row.append(key);
  }
  $('#keyboard').append(row);
}
$('#space').addEventListener('pointerdown', event => event.preventDefault());
$('#backspace').addEventListener('pointerdown', event => event.preventDefault());
$('#space').addEventListener('click', () => typeKey(' '));
$('#backspace').addEventListener('click', () => typeKey('Backspace'));
$('#composer').addEventListener('submit', add);
$('#clear').addEventListener('click', clearCompleted);
$('#feed').addEventListener('click', clearCompleted);
$('#pin').addEventListener('click', async () => {
  try { render(await window.api.setPinned(!state.pinned)); sound('type'); } catch (error) { message(error.message); }
});
$('#sound').addEventListener('click', () => {
  soundEnabled = !soundEnabled; localStorage.setItem('typewriter-sound', soundEnabled ? 'on' : 'off');
  $('#sound').setAttribute('aria-pressed', String(soundEnabled)); sound('ding');
});
$('#sync').addEventListener('click', async () => { try { render(await window.api.appendLog()); } catch (error) { message(error.message); } });
$('#close').addEventListener('click', () => window.api.close());
async function saveTitle() {
  try { render(await window.api.setTitle($('#title').value)); message(); } catch (error) { $('#title').value = state.title; message(error.message); }
}
$('#title').addEventListener('change', saveTitle);
$('#title').addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); input.focus(); } });
document.addEventListener('keydown', event => {
  if ($('#delete-dialog').open) return;
  if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'd') { event.preventDefault(); clearCompleted(); return; }
  if (event.key === 'Escape') { document.activeElement.blur(); return; }
  const editing = event.target instanceof HTMLInputElement && event.target.type !== 'checkbox';
  if (!editing && selected && ['F2', 'Delete'].includes(event.key)) {
    event.preventDefault(); if (event.key === 'F2') startEdit(selected); else requestDelete(selected); return;
  }
  if (!editing && !event.ctrlKey && !event.altKey && event.key.toLowerCase() === 'x') {
    event.preventDefault(); const id = state?.entries.find(entry => entry.id === selected && entry.type === 'task')?.id
      || state?.entries.find(entry => entry.type === 'task' && !entry.done)?.id;
    if (id) toggle(id); return;
  }
  if (editing && !event.ctrlKey && !event.metaKey && !event.altKey && (event.key.length === 1 || event.key === 'Backspace')) { pressKey(event.key); sound('type'); }
});
function movable(element, resize = false) {
  let origin = null, latest = null, sending = false, token = 0;
  async function flush() {
    if (sending || !latest) return;
    sending = true;
    try {
      while (latest) { const target = latest; latest = null;
        if (resize) await window.api.resize(target.width, target.height); else await window.api.move(target.x, target.y);
      }
    } catch (error) { message(error.message); }
    finally { sending = false; }
  }
  element.addEventListener('pointerdown', async event => {
    if (event.button !== 0 || (!resize && event.target.closest('button,input'))) return;
    event.preventDefault(); const current = ++token, x = event.screenX, y = event.screenY;
    element.setPointerCapture(event.pointerId);
    try { const bounds = await window.api.getBounds(); if (token === current) origin = { ...bounds, x0: x, y0: y }; }
    catch (error) { message(error.message); }
  });
  element.addEventListener('pointermove', event => {
    if (!origin) return;
    const dx = Math.round(event.screenX - origin.x0), dy = Math.round(event.screenY - origin.y0);
    latest = resize ? { width: Math.max(360, Math.min(1200, origin.width + dx)), height: Math.max(480, Math.min(1600, origin.height + dy)) }
      : { x: origin.x + dx, y: origin.y + dy }; flush();
  });
  const stop = () => { token++; origin = null; };
  element.addEventListener('pointerup', stop); element.addEventListener('pointercancel', stop);
}
for (const handle of document.querySelectorAll('.drag-handle')) movable(handle);
movable($('#resize'), true);
$('#resize').addEventListener('keydown', async event => {
  const delta = { ArrowRight: [20, 0], ArrowLeft: [-20, 0], ArrowDown: [0, 20], ArrowUp: [0, -20] }[event.key];
  if (!delta) return; event.preventDefault(); const bounds = await window.api.getBounds();
  await window.api.resize(Math.max(360, Math.min(1200, bounds.width + delta[0])), Math.max(480, Math.min(1600, bounds.height + delta[1])));
});
window.api.onState(render);
window.api.readTasks().then(next => { render(next); document.body.dataset.ready = 'true'; }).catch(error => message(error.message));

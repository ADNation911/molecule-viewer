import '../styles.css';
import { mountIcons, icon } from './icons.js';
import { DisplayHistory, defaultDisplay } from './history.js';
import { validateFile, validateText, structureDescription, MAX_SURFACE_ATOMS, WATER_NAMES } from './structures.js';
import { MolecularViewer } from './viewer.js';
import { samples } from './samples.js';

const $ = id => document.getElementById(id);
const all = selector => [...document.querySelectorAll(selector)];
const history = new DisplayHistory(defaultDisplay());
const activities = [];
let renderer;
let current = null;
let busy = false;
let spinning = false;
let ready = false;

mountIcons();

function record(message) {
  activities.unshift({ time: new Date(), message });
  if (activities.length > 100) activities.pop();
  $('activity-count').textContent = activities.length;
  $('activity-list').replaceChildren(...activities.map(entry => {
    const li = document.createElement('li');
    const time = document.createElement('time');
    time.dateTime = entry.time.toISOString();
    time.textContent = entry.time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const description = document.createElement('span');
    description.textContent = entry.message;
    li.append(time, description);
    return li;
  }));
}

function notice(message, error = false) {
  $('notice-text').textContent = message;
  $('notice').classList.toggle('is-error', error);
  $('notice').hidden = false;
  record(message);
}

function setBusy(value, message = 'Reading structure…') {
  busy = value;
  $('busy-message').textContent = message;
  $('busy-overlay').hidden = !value;
  $('viewer').setAttribute('aria-busy', String(value));
  syncControls();
}

function syncControls() {
  const display = history.value;
  all('[data-needs-model]').forEach(el => { el.disabled = !ready || !current || busy; });
  all('[data-action="upload"], [data-sample]').forEach(el => { el.disabled = busy || !ready; });
  all('[data-action="undo"]').forEach(el => { el.disabled = !current || busy || !history.canUndo; });
  all('[data-action="redo"]').forEach(el => { el.disabled = !current || busy || !history.canRedo; });
  all('[data-style]').forEach(el => {
    el.setAttribute('aria-pressed', String(el.dataset.style === display.style));
    const backboneOnly = ['cartoon', 'ribbon'].includes(el.dataset.style);
    const tooLarge = el.dataset.style === 'surface' && current?.summary.atomCount > MAX_SURFACE_ATOMS;
    if (current && ((backboneOnly && !current.summary.hasBackbone) || tooLarge)) el.disabled = true;
    el.title = tooLarge ? 'Surfaces support up to 15,000 atoms in this release.' : backboneOnly && current && !current.summary.hasBackbone ? 'Requires a protein or nucleic-acid backbone.' : '';
  });
  $('color-mode').value = display.color;
  $('show-structure').checked = display.visible;
  $('show-water').checked = display.water;
  $('show-labels').checked = display.labels;
  if (current && !current.summary.waterCount) $('show-water').disabled = true;
  if (current && !current.summary.residueCount) $('show-labels').disabled = true;
  $('surface-opacity').value = display.opacity * 100;
  $('opacity-value').textContent = `${Math.round(display.opacity * 100)}%`;
  $('opacity-field').hidden = display.style !== 'surface' || !current;
  $('hidden-message').hidden = !current || display.visible;
  all('[data-action="spin"]').forEach(el => el.setAttribute('aria-pressed', String(spinning)));
  all('[data-residue]').forEach(el => { el.checked = !display.hiddenResidues.includes(el.dataset.residue); el.disabled = busy; });
  all('[data-sample]').forEach(el => el.classList.toggle('is-active', el.dataset.sample === current?.sampleId));
  const status = !ready ? 'Viewer unavailable' : busy ? 'Opening structure…' : current ? `${current.summary.atomCount.toLocaleString()} atoms · ${display.style === 'ballstick' ? 'Ball + stick' : display.style[0].toUpperCase() + display.style.slice(1)} · ${display.visible ? 'Ready' : 'Hidden'}` : 'Ready to explore';
  $('status-text').replaceChildren();
  const dot = document.createElement('span'); dot.className = 'status-dot';
  $('status-text').append(dot, document.createTextNode(status));
}

function syncStructure() {
  const summary = current?.summary;
  $('empty-state').hidden = !!current;
  $('library-name').textContent = current?.title || 'Untitled structure';
  $('viewport-name').textContent = current?.title || 'No structure loaded';
  $('format-badge').textContent = current?.format.toUpperCase() || '';
  $('format-badge').hidden = !current;
  $('structure-title').textContent = current?.title || 'Nothing open yet';
  $('structure-description').textContent = current?.description || (current ? 'Imported from your device. Coordinates stay in this browser.' : 'Open a file or choose a sample to inspect its details.');
  $('structure-kind').textContent = summary ? (summary.hasBackbone ? 'Macromolecule' : 'Molecule') : 'Empty';
  $('atom-count').textContent = summary?.atomCount.toLocaleString() ?? '—';
  $('residue-count').textContent = summary?.residueCount.toLocaleString() ?? '—';
  $('chain-count').textContent = summary?.chainCount.toLocaleString() ?? '—';
  $('source-link').hidden = !current?.source;
  if (current?.source) $('source-link').href = current.source;
  $('residue-type-count').textContent = summary?.residueTypes.length || 0;
  $('model-note').textContent = current ? 'First model / record shown. Opening another file replaces this structure and resets display history.' : 'One structure at a time. Opening another replaces the current view.';
  $('residue-list').replaceChildren();
  if (!summary?.residueTypes.length) {
    const empty = document.createElement('p'); empty.className = 'muted';
    empty.textContent = current ? 'This format has no residue annotations.' : 'Residue details will appear here.';
    $('residue-list').append(empty);
  } else {
    for (const residue of summary.residueTypes) {
      const label = document.createElement('label'); label.className = 'residue-item';
      const input = document.createElement('input'); input.type = 'checkbox'; input.checked = true; input.dataset.residue = residue.name;
      const name = document.createElement('span'); name.textContent = `${residue.name}${WATER_NAMES.has(residue.name) ? ' · Water' : ''}`;
      const count = document.createElement('span'); count.textContent = residue.count;
      input.addEventListener('change', () => {
        const hidden = new Set(history.value.hiddenResidues);
        if (input.checked) hidden.delete(residue.name); else hidden.add(residue.name);
        changeDisplay({ hiddenResidues: [...hidden].sort() }, `${input.checked ? 'Show' : 'Hide'} residue type ${residue.name}`);
      });
      label.append(input, name, count); $('residue-list').append(label);
    }
  }
  syncControls();
}

async function openStructure(read, info, format) {
  if (busy || !ready) return;
  setBusy(true, `Opening ${info.title || info.name}…`);
  $('notice').hidden = true;
  try {
    const text = await read();
    validateText(text, format);
    // Let the loading feedback paint before parsing and WebGL work.
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const prepared = renderer.prepare(text, format);
    renderer.replace(prepared);
    current = { ...info, format, summary: prepared.summary, title: info.title || info.name, description: info.description || structureDescription(text, format) };
    history.reset(defaultDisplay(prepared.summary.hasBackbone));
    spinning = false;
    renderer.apply(history.value);
    renderer.fit();
    syncStructure();
    record(`Opened ${info.name} · ${prepared.summary.atomCount.toLocaleString()} atoms`);
  } catch (error) {
    notice(error.message || 'The file could not be opened. Try another molecular structure.', true);
  } finally {
    setBusy(false);
  }
}

async function openFile(file) {
  if (!file || busy || !ready) return;
  try {
    const format = validateFile(file);
    await openStructure(() => file.text(), { name: file.name }, format);
  } catch (error) { notice(error.message, true); }
}

async function openSample(id) {
  const sample = samples[id];
  if (!sample) return;
  const format = sample.name.endsWith('.xyz') ? 'xyz' : 'pdb';
  await openStructure(async () => {
    try {
      const response = await fetch(sample.url, { signal: AbortSignal.timeout(12000) });
      if (!response.ok) throw new Error();
      return await response.text();
    } catch { throw new Error('The bundled sample could not be loaded. Reload the app or open a file from your device.'); }
  }, { ...sample, sampleId: id }, format);
}

function changeDisplay(patch, message) {
  if (!current || busy) return;
  if (history.commit({ ...history.value, ...patch })) {
    renderer.apply(history.value);
    syncControls();
    record(message);
  }
}

function setInspector(open) {
  document.body.classList.toggle('is-inspector-hidden', !open);
  $('inspector').inert = !open;
  all('[aria-controls="inspector"]').forEach(el => el.setAttribute('aria-expanded', String(open)));
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  all('[data-action="theme"][data-icon]').forEach(el => { el.innerHTML = icon(theme === 'dark' ? 'sun' : 'moon'); el.setAttribute('aria-label', `Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`); });
  try { localStorage.setItem('molecule3d-theme', theme); } catch { /* The workspace also works without storage permission. */ }
}

const actions = {
  upload: () => { if (ready && !busy) { $('file-input').value = ''; $('file-input').click(); } },
  samples: () => { $('sample-list').scrollIntoView({ block: 'nearest' }); $('sample-list').querySelector('button').focus(); },
  clear: () => { if (!current || busy) return; renderer.clear(); current = null; spinning = false; history.reset(defaultDisplay()); $('notice').hidden = true; syncStructure(); record('Closed structure'); },
  undo: () => { if (!busy && current && history.undo()) { renderer.apply(history.value); syncControls(); record('Undo display change'); } },
  redo: () => { if (!busy && current && history.redo()) { renderer.apply(history.value); syncControls(); record('Redo display change'); } },
  'reset-style': () => changeDisplay(defaultDisplay(current?.summary.hasBackbone), 'Reset display to defaults'),
  fit: () => { if (current && !busy) { renderer.fit(); record('Fit structure to view'); } },
  'zoom-in': () => { if (current && !busy) renderer.zoom(1.2); },
  'zoom-out': () => { if (current && !busy) renderer.zoom(1 / 1.2); },
  spin: () => { if (current && !busy) { spinning = !spinning; renderer.spin(spinning); syncControls(); record(spinning ? 'Started auto-rotation' : 'Stopped auto-rotation'); } },
  visibility: () => changeDisplay({ visible: !history.value.visible }, 'Toggled structure visibility'),
  theme: () => applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'),
  inspector: () => setInspector(document.body.classList.contains('is-inspector-hidden')),
  help: () => $('help-dialog').showModal(),
  assistant: () => $('assistant-dialog').showModal(),
  activity: () => $('activity-dialog').showModal(),
  'dismiss-notice': () => { $('notice').hidden = true; },
};

document.addEventListener('click', event => {
  const button = event.target.closest('button');
  if (button && !button.disabled) {
    if (button.dataset.action) {
      const menu = button.closest('details');
      if (menu) { menu.open = false; menu.querySelector('summary').focus(); }
      actions[button.dataset.action]?.();
    }
    if (button.dataset.sample) openSample(button.dataset.sample);
    if (button.dataset.style) changeDisplay({ style: button.dataset.style }, `Representation: ${button.textContent.trim()}`);
    if (button.hasAttribute('data-close-dialog')) button.closest('dialog').close();
  }
  all('.menu[open]').forEach(menu => { if (!menu.contains(event.target)) menu.open = false; });
});
all('.menu').forEach(menu => menu.addEventListener('toggle', () => { if (menu.open) all('.menu').forEach(other => { if (other !== menu) other.open = false; }); }));
$('file-input').addEventListener('change', event => openFile(event.target.files[0]));
$('color-mode').addEventListener('change', event => changeDisplay({ color: event.target.value }, `Color: ${event.target.selectedOptions[0].textContent}`));
[['show-structure', 'visible'], ['show-water', 'water'], ['show-labels', 'labels']].forEach(([id, key]) => $(id).addEventListener('change', e => changeDisplay({ [key]: e.target.checked }, `${key}: ${e.target.checked ? 'on' : 'off'}`)));
$('surface-opacity').addEventListener('input', event => { $('opacity-value').textContent = `${event.target.value}%`; });
$('surface-opacity').addEventListener('change', event => changeDisplay({ opacity: Number(event.target.value) / 100 }, `Surface opacity: ${event.target.value}%`));

let dragDepth = 0;
document.addEventListener('dragover', event => { if (event.dataTransfer?.types.includes('Files')) event.preventDefault(); });
document.addEventListener('drop', event => {
  if (!event.dataTransfer?.types.includes('Files')) return;
  event.preventDefault(); dragDepth = 0; $('drop-overlay').hidden = true;
  if (event.dataTransfer.files.length !== 1) { notice('Open one structure at a time. Your current structure has been kept.', true); return; }
  openFile(event.dataTransfer.files[0]);
});
$('drop-zone').addEventListener('dragenter', event => { if (event.dataTransfer?.types.includes('Files') && !busy) { dragDepth++; $('drop-overlay').hidden = false; } });
$('drop-zone').addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) $('drop-overlay').hidden = true; });
document.addEventListener('dragend', () => { dragDepth = 0; $('drop-overlay').hidden = true; });

document.addEventListener('keydown', event => {
  if (event.key === 'Escape') { all('.menu[open]').forEach(menu => { menu.open = false; menu.querySelector('summary').focus(); }); return; }
  if (document.querySelector('dialog[open]')) return;
  const key = event.key.toLowerCase();
  const editing = event.target.matches('input, textarea, select, [contenteditable="true"]');
  if (event.ctrlKey || event.metaKey) {
    if (key === 'o') { event.preventDefault(); actions.upload(); }
    if (!editing && (key === 'z' || key === 'y')) { event.preventDefault(); actions[key === 'y' || event.shiftKey ? 'redo' : 'undo'](); }
    return;
  }
  if (editing || event.altKey) return;
  if (key === 'f') { event.preventDefault(); actions.fit(); }
  if (key === 'r') { event.preventDefault(); actions.spin(); }
  if (event.target === $('viewer') && current && !busy) {
    const pans = { ArrowLeft: [-20, 0], ArrowRight: [20, 0], ArrowUp: [0, -20], ArrowDown: [0, 20] };
    if (pans[event.key]) { event.preventDefault(); renderer.pan(...pans[event.key]); }
  }
});
document.addEventListener('visibilitychange', () => { if (document.hidden && spinning) { renderer.stop(); spinning = false; syncControls(); } });

const resizer = $('panel-resizer');
function resizeInspector(width) {
  const limit = Math.min(380, Math.max(240, innerWidth - 620));
  const value = Math.round(Math.max(240, Math.min(limit, width)));
  document.documentElement.style.setProperty('--inspector-width', `${value}px`);
  resizer.setAttribute('aria-valuenow', String(value));
}
resizer.addEventListener('pointerdown', e => { resizer.setPointerCapture(e.pointerId); document.body.classList.add('resize-active'); });
resizer.addEventListener('pointermove', e => { if (resizer.hasPointerCapture(e.pointerId)) resizeInspector(innerWidth - e.clientX); });
resizer.addEventListener('pointerup', e => { resizer.releasePointerCapture(e.pointerId); document.body.classList.remove('resize-active'); });
resizer.addEventListener('lostpointercapture', () => document.body.classList.remove('resize-active'));
resizer.addEventListener('keydown', e => { if (['ArrowLeft', 'ArrowRight'].includes(e.key)) { e.preventDefault(); resizeInspector($('inspector').getBoundingClientRect().width + (e.key === 'ArrowLeft' ? 20 : -20)); } });
const compact = matchMedia('(max-width: 950px)');
setInspector(!compact.matches);
compact.addEventListener('change', e => setInspector(!e.matches));
try { applyTheme(localStorage.getItem('molecule3d-theme') === 'dark' ? 'dark' : 'light'); } catch { applyTheme('light'); }

try {
  renderer = new MolecularViewer($('viewer'), message => notice(message, true));
  ready = true;
  $('viewer').addEventListener('webglcontextlost', event => { event.preventDefault(); ready = false; spinning = false; notice('The graphics context was lost. Reload the page to restart the viewer.', true); syncControls(); }, true);
  record('Workspace ready. Open a structure or try a sample.');
} catch {
  notice('The 3D viewer could not start. Enable WebGL / hardware acceleration in your browser, then reload.', true);
}
syncStructure();

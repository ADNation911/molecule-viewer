import '../styles.css';
import { mountIcons, icon } from './icons.js';
import { DisplayHistory, defaultDisplay } from './history.js';
import {
  validateFile, validateText, structureDescription, residueKey, residueSelector,
  neighboringResidues, MAX_SURFACE_ATOMS, MAX_WORKSPACE_ATOMS, WATER_NAMES,
} from './structures.js';
import { fetchPdbStructure } from './pdb.js';
import { MolecularViewer } from './viewer.js';
import { samples } from './samples.js';

const $ = id => document.getElementById(id);
const all = selector => [...document.querySelectorAll(selector)];
const activities = [];
const objects = [];
const namedSelections = [];
let renderer;
let activeId = null;
let selection = null;
let busy = false;
let spinning = false;
let ready = false;
let nextObjectId = 1;
let nextSelectionId = 1;

mountIcons();

const activeObject = () => objects.find(object => object.id === activeId) || null;
const totalAtoms = () => objects.reduce((sum, object) => sum + object.summary.atomCount, 0);
const objectById = id => objects.find(object => object.id === id);

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

function renderViewer() {
  renderer.apply(objects, selection);
}

function styleLabel(style) {
  return style === 'ballstick' ? 'Ball + stick' : style[0].toUpperCase() + style.slice(1);
}

function syncControls() {
  const current = activeObject();
  const display = current?.history.value || defaultDisplay();
  all('[data-needs-model]').forEach(element => { element.disabled = !ready || !current || busy; });
  all('[data-action="upload"], [data-sample]').forEach(element => { element.disabled = busy || !ready; });
  all('[data-action="undo"]').forEach(element => { element.disabled = !current || busy || !current.history.canUndo; });
  all('[data-action="redo"]').forEach(element => { element.disabled = !current || busy || !current.history.canRedo; });
  all('[data-style]').forEach(element => {
    element.setAttribute('aria-pressed', String(!!current && element.dataset.style === display.style));
    const backboneOnly = ['cartoon', 'ribbon'].includes(element.dataset.style);
    const tooLarge = element.dataset.style === 'surface' && current?.summary.atomCount > MAX_SURFACE_ATOMS;
    element.disabled = !current || busy || (backboneOnly && !current.summary.hasBackbone) || tooLarge;
    element.title = tooLarge ? 'Surfaces support up to 15,000 atoms per object.' : backboneOnly && current && !current.summary.hasBackbone ? 'Requires a protein or nucleic-acid backbone.' : '';
  });
  $('color-mode').value = display.color;
  $('show-structure').checked = display.visible;
  $('show-water').checked = display.water;
  $('show-ligands').checked = display.ligands;
  $('show-labels').checked = display.labels;
  if (current && !current.summary.waterCount) $('show-water').disabled = true;
  if (current && !current.summary.ligandCount) $('show-ligands').disabled = true;
  if (current && !current.summary.residueCount) $('show-labels').disabled = true;
  $('surface-opacity').value = display.opacity * 100;
  $('opacity-value').textContent = `${Math.round(display.opacity * 100)}%`;
  $('hidden-message').hidden = !current || display.visible;
  all('[data-action="spin"]').forEach(element => element.setAttribute('aria-pressed', String(spinning)));
  all('[data-residue]').forEach(element => { element.checked = !display.hiddenResidues.includes(element.dataset.residue); element.disabled = busy; });
  all('[data-sample]').forEach(element => element.classList.toggle('is-active', objects.some(object => object.sampleId === element.dataset.sample)));
  const status = !ready
    ? 'Viewer unavailable'
    : busy
      ? 'Opening structure…'
      : current
        ? `${objects.length} object${objects.length === 1 ? '' : 's'} · ${current.summary.atomCount.toLocaleString()} atoms active · ${styleLabel(display.style)}`
        : 'Ready to explore';
  $('status-text').replaceChildren();
  const dot = document.createElement('span');
  dot.className = 'status-dot';
  $('status-text').append(dot, document.createTextNode(status));
}

function syncObjectList() {
  $('object-count').textContent = objects.length;
  $('object-list').replaceChildren();
  if (!objects.length) {
    const empty = document.createElement('p');
    empty.className = 'muted object-empty';
    empty.textContent = 'No objects loaded.';
    $('object-list').append(empty);
    return;
  }
  for (const object of objects) {
    const display = object.history.value;
    const row = document.createElement('div');
    row.className = `object-card${object.id === activeId ? ' is-active' : ''}`;
    const select = document.createElement('button');
    select.className = 'object-select';
    select.dataset.objectId = object.id;
    select.setAttribute('aria-pressed', String(object.id === activeId));
    select.innerHTML = `<span class="object-color"></span><span><strong></strong><small></small></span>`;
    select.querySelector('strong').textContent = object.title;
    select.querySelector('small').textContent = `${object.format.toUpperCase()} · ${object.summary.atomCount.toLocaleString()} atoms`;
    const visibility = document.createElement('button');
    visibility.className = 'object-icon';
    visibility.dataset.objectVisibility = object.id;
    visibility.setAttribute('aria-label', `${display.visible ? 'Hide' : 'Show'} ${object.title}`);
    visibility.title = display.visible ? 'Hide object' : 'Show object';
    visibility.textContent = display.visible ? '●' : '○';
    const remove = document.createElement('button');
    remove.className = 'object-icon';
    remove.dataset.objectRemove = object.id;
    remove.setAttribute('aria-label', `Remove ${object.title}`);
    remove.title = 'Remove object';
    remove.textContent = '×';
    row.append(select, visibility, remove);
    $('object-list').append(row);
  }
}

function makeResidueButton(residue) {
  const button = document.createElement('button');
  button.className = 'residue-token';
  button.dataset.residueKey = residue.key;
  button.textContent = residue.symbol;
  button.title = `${residue.resn} ${residue.resi}${residue.icode || ''} · Chain ${residue.chain || 'unassigned'}`;
  button.setAttribute('aria-label', button.title);
  if (selection?.objectId === activeId && selection.primaryKeys?.includes(residue.key)) button.classList.add('is-selected');
  if (selection?.objectId === activeId && selection.secondaryKeys?.includes(residue.key)) button.classList.add('is-neighbor');
  return button;
}

function syncExplore() {
  const current = activeObject();
  const summary = current?.summary;
  $('chain-select').replaceChildren(new Option('All chains', ''));
  if (summary) for (const chain of summary.chains) {
    const polymerCount = chain.residues.filter(residue => !residue.hetflag).length;
    $('chain-select').append(new Option(`Chain ${chain.label} · ${polymerCount} residues`, chain.id));
  }
  $('chain-select').value = selection?.objectId === activeId && selection.chain != null ? selection.chain : '';
  $('sequence-view').replaceChildren();
  if (!summary?.chains.length) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.textContent = current ? 'This object has no chain or residue annotations.' : 'Select a structure with residue annotations.';
    $('sequence-view').append(empty);
    $('sequence-count').textContent = '0 residues';
  } else {
    const selectedChain = $('chain-select').value;
    const chains = selectedChain ? summary.chains.filter(chain => chain.id === selectedChain) : summary.chains;
    const count = chains.reduce((sum, chain) => sum + chain.residues.filter(residue => !residue.hetflag).length, 0);
    $('sequence-count').textContent = `${count} residue${count === 1 ? '' : 's'}`;
    for (const chain of chains) {
      const group = document.createElement('div');
      group.className = 'sequence-chain';
      const heading = document.createElement('button');
      heading.className = 'sequence-chain-heading';
      heading.dataset.chainId = chain.id;
      heading.textContent = `Chain ${chain.label}`;
      const tokens = document.createElement('div');
      tokens.className = 'sequence-tokens';
      tokens.append(...chain.residues.filter(residue => !residue.hetflag).map(makeResidueButton));
      group.append(heading, tokens);
      $('sequence-view').append(group);
    }
  }
  $('ligand-list').replaceChildren();
  $('ligand-count').textContent = summary?.ligandCount || 0;
  if (!summary?.ligands.length) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.textContent = current ? 'No non-water ligands were found.' : 'No ligands found.';
    $('ligand-list').append(empty);
  } else {
    for (const ligand of summary.ligands) {
      const row = document.createElement('div');
      row.className = 'ligand-row';
      const pick = document.createElement('button');
      pick.dataset.ligandKey = ligand.key;
      pick.textContent = `${ligand.resn} ${ligand.resi}${ligand.icode || ''} · ${ligand.chain || '—'}`;
      const neighbors = document.createElement('button');
      neighbors.className = 'text-button';
      neighbors.dataset.neighborsKey = ligand.key;
      neighbors.textContent = '4 Å neighbors';
      const isolate = document.createElement('button');
      isolate.className = 'text-button';
      isolate.dataset.isolateKey = ligand.key;
      isolate.textContent = 'Isolate';
      row.append(pick, isolate, neighbors);
      $('ligand-list').append(row);
    }
  }
  syncSelectionDetail();
}

function syncSelectionDetail() {
  const current = activeObject();
  $('selection-detail').replaceChildren();
  if (!current || selection?.objectId !== activeId) {
    const text = document.createElement('p');
    text.className = 'muted';
    text.textContent = 'Click a chain, residue, ligand, or atom in the 3D view.';
    $('selection-detail').append(text);
    return;
  }
  const title = document.createElement('strong');
  title.textContent = selection.label;
  const meta = document.createElement('span');
  meta.textContent = selection.secondaryKeys?.length ? `${selection.secondaryKeys.length} neighboring residues within 4 Å` : selection.kind;
  $('selection-detail').append(title, meta);
  if (selection.primaryKeys?.length === 1) {
    const residue = current.summary.residues.find(item => item.key === selection.primaryKeys[0]);
    if (residue) {
      const atoms = document.createElement('div');
      atoms.className = 'atom-list';
      for (const atom of residue.atoms.slice(0, 60)) {
        const button = document.createElement('button');
        button.dataset.atomIndex = atom.__workspaceIndex;
        button.textContent = `${atom.atom || atom.elem || 'Atom'} ${atom.serial || atom.__workspaceIndex + 1}`;
        button.title = `${atom.elem || ''} · ${Number(atom.x).toFixed(2)}, ${Number(atom.y).toFixed(2)}, ${Number(atom.z).toFixed(2)} Å`;
        atoms.append(button);
      }
      $('selection-detail').append(atoms);
    }
  }
}

function syncNamedSelections() {
  $('selection-count').textContent = namedSelections.length;
  $('named-selection-list').replaceChildren();
  if (!namedSelections.length) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.textContent = selection ? 'Name the current selection to save it.' : 'Choose a chain, residue, ligand, or atom to save it.';
    $('named-selection-list').append(empty);
    return;
  }
  for (const saved of namedSelections) {
    const row = document.createElement('div');
    row.className = 'named-selection-row';
    const apply = document.createElement('button');
    apply.dataset.namedSelection = saved.id;
    apply.innerHTML = '<strong></strong><small></small>';
    apply.querySelector('strong').textContent = saved.name;
    apply.querySelector('small').textContent = `${objectById(saved.objectId)?.title || 'Removed object'} · ${saved.selection.label}`;
    const remove = document.createElement('button');
    remove.dataset.removeSelection = saved.id;
    remove.className = 'object-icon';
    remove.setAttribute('aria-label', `Delete selection ${saved.name}`);
    remove.textContent = '×';
    row.append(apply, remove);
    $('named-selection-list').append(row);
  }
}

function syncStructure() {
  const current = activeObject();
  const summary = current?.summary;
  $('empty-state').hidden = objects.length > 0;
  $('viewport-name').textContent = current ? `${current.title}${objects.length > 1 ? ` + ${objects.length - 1} more` : ''}` : 'No structure loaded';
  $('format-badge').textContent = current?.format.toUpperCase() || '';
  $('format-badge').hidden = !current;
  $('structure-title').textContent = current?.title || 'Nothing open yet';
  $('structure-description').textContent = current?.description || (current ? 'Imported from your device. Coordinates stay in this browser.' : 'Add a file, sample, or PDB structure to inspect it.');
  $('structure-kind').textContent = summary ? (summary.hasBackbone ? 'Macromolecule' : 'Molecule') : 'Empty';
  $('atom-count').textContent = summary?.atomCount.toLocaleString() ?? '—';
  $('residue-count').textContent = summary?.residueCount.toLocaleString() ?? '—';
  $('chain-count').textContent = summary?.chainCount.toLocaleString() ?? '—';
  $('source-link').hidden = !current?.source;
  if (current?.source) $('source-link').href = current.source;
  $('residue-type-count').textContent = summary?.residueTypes.length || 0;
  $('model-note').textContent = current
    ? `First model / record shown. ${summary.alternateLocationCount} alternate-location atoms and ${summary.insertionCodeCount} insertion-coded residues are tracked explicitly.`
    : 'Each object keeps its own style, color, opacity, visibility, and labels.';
  $('residue-list').replaceChildren();
  if (!summary?.residueTypes.length) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.textContent = current ? 'This format has no residue annotations.' : 'Residue details will appear here.';
    $('residue-list').append(empty);
  } else {
    for (const residue of summary.residueTypes) {
      const label = document.createElement('label');
      label.className = 'residue-item';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = !current.history.value.hiddenResidues.includes(residue.name);
      input.dataset.residue = residue.name;
      const name = document.createElement('span');
      name.textContent = `${residue.name}${WATER_NAMES.has(residue.name) ? ' · Water' : ''}`;
      const count = document.createElement('span');
      count.textContent = residue.count;
      input.addEventListener('change', () => {
        const hidden = new Set(current.history.value.hiddenResidues);
        if (input.checked) hidden.delete(residue.name); else hidden.add(residue.name);
        changeDisplay({ hiddenResidues: [...hidden].sort() }, `${input.checked ? 'Show' : 'Hide'} ${residue.name} in ${current.title}`);
      });
      label.append(input, name, count);
      $('residue-list').append(label);
    }
  }
  syncObjectList();
  syncExplore();
  syncNamedSelections();
  syncControls();
}

async function openStructure(read, info, format) {
  if (busy || !ready) return false;
  setBusy(true, `Opening ${info.title || info.name}…`);
  $('notice').hidden = true;
  let prepared;
  try {
    const text = await read();
    validateText(text, format);
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    prepared = renderer.prepare(text, format);
    if (totalAtoms() + prepared.summary.atomCount > MAX_WORKSPACE_ATOMS) throw new Error('The workspace would exceed 120,000 atoms. Remove an object before adding this structure.');
    const id = `object-${nextObjectId++}`;
    const object = {
      id, ...info, format, summary: prepared.summary, atoms: prepared.atoms,
      title: info.title || info.name,
      description: info.description || structureDescription(text, format),
      history: new DisplayHistory(defaultDisplay(prepared.summary.hasBackbone)),
    };
    renderer.add(id, prepared);
    objects.push(object);
    activeId = id;
    selection = null;
    spinning = false;
    renderViewer();
    renderer.fit(id);
    syncStructure();
    record(`Added ${info.name} · ${prepared.summary.atomCount.toLocaleString()} atoms`);
    return true;
  } catch (error) {
    if (prepared && !objects.some(object => renderer.models.get(object.id) === prepared)) renderer.discard(prepared);
    notice(error.message || 'The structure could not be opened. Try another molecular file.', true);
    return false;
  } finally {
    setBusy(false);
  }
}

async function openFiles(files) {
  for (const file of [...files].slice(0, 8)) {
    try {
      const format = validateFile(file);
      await openStructure(() => file.text(), { name: file.name }, format);
    } catch (error) {
      notice(error.message, true);
    }
  }
  if (files.length > 8) notice('The first eight files were added. Add the remaining files in another batch.');
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
    } catch {
      throw new Error('The bundled sample could not be loaded. Reload the app or open a file from your device.');
    }
  }, { ...sample, sampleId: id }, format);
}

function selectObject(id, fit = false) {
  if (!objectById(id) || busy) return;
  activeId = id;
  if (selection?.objectId !== id) selection = null;
  syncStructure();
  if (fit) renderer.fit(id);
}

function setSelection(next, message) {
  selection = next;
  if (next?.objectId) activeId = next.objectId;
  renderViewer();
  syncStructure();
  if (message) record(message);
}

function selectResidue(key, kind = 'Residue') {
  const current = activeObject();
  const residue = current?.summary.residues.find(item => item.key === key);
  if (!residue) return;
  setSelection({
    objectId: current.id, kind: kind.toLowerCase(), primaryKeys: [key], secondaryKeys: [],
    label: `${kind}: ${residue.resn} ${residue.resi}${residue.icode || ''} · Chain ${residue.chain || '—'}`,
  }, `Selected ${residue.resn} ${residue.resi}${residue.icode || ''} in ${current.title}`);
}

function selectNeighbors(key) {
  const current = activeObject();
  const residue = current?.summary.residues.find(item => item.key === key);
  if (!residue) return;
  const neighbors = neighboringResidues(current.atoms, key, 4);
  setSelection({
    objectId: current.id, kind: 'ligand neighborhood', primaryKeys: [key], secondaryKeys: neighbors,
    label: `${residue.resn} ${residue.resi}${residue.icode || ''} and 4 Å neighbors`,
  }, `Selected ${neighbors.length} residues within 4 Å of ${residue.resn} in ${current.title}`);
}

function isolateLigand(key) {
  const current = activeObject();
  const residue = current?.summary.residues.find(item => item.key === key);
  if (!residue) return;
  selection = {
    objectId: current.id, kind: 'isolated ligand', primaryKeys: [key], secondaryKeys: [],
    label: `Isolated ligand: ${residue.resn} ${residue.resi}${residue.icode || ''}`,
  };
  changeDisplay({ isolateKeys: [key] }, `Isolated ${residue.resn} in ${current.title}`);
}

function selectAtom(id, atom) {
  const object = objectById(id);
  if (!object) return;
  const key = residueKey(atom);
  const atomName = atom.atom || atom.elem || 'Atom';
  setSelection({
    objectId: id, kind: 'atom', primaryKeys: key ? [key] : [], secondaryKeys: [],
    atomSelector: Number.isFinite(atom.serial) ? { serial: atom.serial } : { index: atom.__workspaceIndex ?? atom.index },
    label: `Atom: ${atomName} ${atom.serial || (atom.__workspaceIndex ?? 0) + 1}${atom.resn ? ` · ${atom.resn} ${atom.resi}${atom.icode || ''}` : ''}`,
  }, `Selected atom ${atomName} in ${object.title}`);
}

function changeDisplay(patch, message, object = activeObject()) {
  if (!object || busy) return;
  if (object.history.commit({ ...object.history.value, ...patch })) {
    renderViewer();
    syncStructure();
    record(message);
  }
}

function removeObject(id) {
  const index = objects.findIndex(object => object.id === id);
  if (index < 0 || busy) return;
  const [removed] = objects.splice(index, 1);
  renderer.remove(id);
  for (let i = namedSelections.length - 1; i >= 0; i--) if (namedSelections[i].objectId === id) namedSelections.splice(i, 1);
  if (selection?.objectId === id) selection = null;
  if (activeId === id) activeId = objects[Math.min(index, objects.length - 1)]?.id || null;
  renderViewer();
  renderer.fit();
  syncStructure();
  record(`Removed ${removed.title}`);
}

function setInspector(open) {
  document.body.classList.toggle('is-inspector-hidden', !open);
  $('inspector').inert = !open;
  all('[aria-controls="inspector"]').forEach(element => element.setAttribute('aria-expanded', String(open)));
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  all('[data-action="theme"][data-icon]').forEach(element => {
    element.innerHTML = icon(theme === 'dark' ? 'sun' : 'moon');
    element.setAttribute('aria-label', `Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`);
  });
  try { localStorage.setItem('molecule3d-theme', theme); } catch { /* Optional preference storage. */ }
}

const actions = {
  upload: () => { if (ready && !busy) { $('file-input').value = ''; $('file-input').click(); } },
  'focus-pdb': () => { $('pdb-id').focus(); },
  samples: () => { $('sample-list').scrollIntoView({ block: 'nearest' }); $('sample-list').querySelector('button').focus(); },
  'remove-active': () => { if (activeId) removeObject(activeId); },
  clear: () => {
    if (!objects.length || busy) return;
    renderer.clear(); objects.splice(0); namedSelections.splice(0); activeId = null; selection = null; spinning = false;
    $('notice').hidden = true; syncStructure(); record('Closed workspace');
  },
  undo: () => { const current = activeObject(); if (!busy && current?.history.undo()) { renderViewer(); syncStructure(); record(`Undo display change for ${current.title}`); } },
  redo: () => { const current = activeObject(); if (!busy && current?.history.redo()) { renderViewer(); syncStructure(); record(`Redo display change for ${current.title}`); } },
  'reset-style': () => { const current = activeObject(); changeDisplay(defaultDisplay(current?.summary.hasBackbone), `Reset ${current?.title} display`); },
  fit: () => { if (activeId && !busy) { renderer.fit(activeId); record(`Fit ${activeObject().title} to view`); } },
  'zoom-in': () => { if (objects.length && !busy) renderer.zoom(1.2); },
  'zoom-out': () => { if (objects.length && !busy) renderer.zoom(1 / 1.2); },
  spin: () => { if (objects.length && !busy) { spinning = !spinning; renderer.spin(spinning); syncControls(); record(spinning ? 'Started auto-rotation' : 'Stopped auto-rotation'); } },
  visibility: () => { const current = activeObject(); changeDisplay({ visible: !current.history.value.visible }, `Toggled ${current.title} visibility`); },
  theme: () => applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'),
  inspector: () => setInspector(document.body.classList.contains('is-inspector-hidden')),
  help: () => $('help-dialog').showModal(),
  assistant: () => $('assistant-dialog').showModal(),
  activity: () => $('activity-dialog').showModal(),
  'dismiss-notice': () => { $('notice').hidden = true; },
};

document.addEventListener('click', event => {
  const button = event.target.closest('button');
  if (!button || button.disabled) return;
  if (button.dataset.action) {
    const menu = button.closest('details');
    if (menu) { menu.open = false; menu.querySelector('summary').focus(); }
    actions[button.dataset.action]?.();
  }
  if (button.dataset.sample) openSample(button.dataset.sample);
  if (button.dataset.style) changeDisplay({ style: button.dataset.style }, `${activeObject()?.title}: ${button.textContent.trim()}`);
  if (button.dataset.objectId) selectObject(button.dataset.objectId, true);
  if (button.dataset.objectVisibility) {
    const object = objectById(button.dataset.objectVisibility);
    changeDisplay({ visible: !object.history.value.visible }, `${object.history.value.visible ? 'Hide' : 'Show'} ${object.title}`, object);
  }
  if (button.dataset.objectRemove) removeObject(button.dataset.objectRemove);
  if (button.dataset.chainId !== undefined) setSelection({ objectId: activeId, kind: 'chain', chain: button.dataset.chainId, primaryKeys: [], secondaryKeys: [], label: `Chain ${button.dataset.chainId || 'unassigned'}` }, `Selected chain ${button.dataset.chainId || 'unassigned'} in ${activeObject().title}`);
  if (button.dataset.residueKey) selectResidue(button.dataset.residueKey);
  if (button.dataset.ligandKey) selectResidue(button.dataset.ligandKey, 'Ligand');
  if (button.dataset.isolateKey) isolateLigand(button.dataset.isolateKey);
  if (button.dataset.neighborsKey) selectNeighbors(button.dataset.neighborsKey);
  if (button.dataset.atomIndex !== undefined) {
    const atom = activeObject()?.atoms[Number(button.dataset.atomIndex)];
    if (atom) selectAtom(activeId, atom);
  }
  if (button.dataset.namedSelection) {
    const saved = namedSelections.find(item => item.id === button.dataset.namedSelection);
    if (saved && objectById(saved.objectId)) setSelection(structuredClone(saved.selection), `Applied selection ${saved.name}`);
  }
  if (button.dataset.removeSelection) {
    const index = namedSelections.findIndex(item => item.id === button.dataset.removeSelection);
    if (index >= 0) { const [removed] = namedSelections.splice(index, 1); syncNamedSelections(); record(`Deleted selection ${removed.name}`); }
  }
  if (button.hasAttribute('data-close-dialog')) button.closest('dialog').close();
  all('.menu[open]').forEach(menu => { if (!menu.contains(event.target)) menu.open = false; });
});

all('.menu').forEach(menu => menu.addEventListener('toggle', () => {
  if (menu.open) all('.menu').forEach(other => { if (other !== menu) other.open = false; });
}));

$('file-input').addEventListener('change', event => openFiles(event.target.files));
$('color-mode').addEventListener('change', event => changeDisplay({ color: event.target.value }, `${activeObject().title} color: ${event.target.selectedOptions[0].textContent}`));
[['show-structure', 'visible'], ['show-water', 'water'], ['show-ligands', 'ligands'], ['show-labels', 'labels']].forEach(([id, key]) => {
  $(id).addEventListener('change', event => changeDisplay({ [key]: event.target.checked }, `${activeObject().title} ${key}: ${event.target.checked ? 'on' : 'off'}`));
});
$('surface-opacity').addEventListener('input', event => { $('opacity-value').textContent = `${event.target.value}%`; });
$('surface-opacity').addEventListener('change', event => changeDisplay({ opacity: Number(event.target.value) / 100 }, `${activeObject().title} opacity: ${event.target.value}%`));
$('chain-select').addEventListener('change', event => {
  if (!event.target.value) setSelection(null, 'Cleared chain selection');
  else setSelection({ objectId: activeId, kind: 'chain', chain: event.target.value, primaryKeys: [], secondaryKeys: [], label: `Chain ${event.target.value}` }, `Selected chain ${event.target.value} in ${activeObject().title}`);
});
$('clear-selection').addEventListener('click', () => {
  const current = activeObject();
  selection = null;
  if (current?.history.value.isolateKeys?.length) changeDisplay({ isolateKeys: [] }, `Show all of ${current.title}`);
  else setSelection(null, 'Cleared selection');
});
$('selection-form').addEventListener('submit', event => {
  event.preventDefault();
  const name = $('selection-name').value.trim();
  if (!selection || !name) { notice('Choose something in the active object and enter a selection name.', true); return; }
  namedSelections.push({ id: `selection-${nextSelectionId++}`, name, objectId: selection.objectId, selection: structuredClone(selection) });
  $('selection-name').value = '';
  syncNamedSelections();
  record(`Saved selection ${name}`);
});
$('pdb-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (busy || !ready) return;
  const entered = $('pdb-id').value;
  try {
    setBusy(true, 'Fetching structure from RCSB PDB…');
    const result = await fetchPdbStructure(entered);
    setBusy(false);
    await openStructure(() => Promise.resolve(result.text), { name: `${result.id}.cif`, title: result.id, description: `Fetched from RCSB Protein Data Bank.`, source: result.source }, 'cif');
    $('pdb-id').value = '';
  } catch (error) {
    setBusy(false);
    notice(error.message, true);
  }
});

let dragDepth = 0;
document.addEventListener('dragover', event => { if (event.dataTransfer?.types.includes('Files')) event.preventDefault(); });
document.addEventListener('drop', event => {
  if (!event.dataTransfer?.types.includes('Files')) return;
  event.preventDefault(); dragDepth = 0; $('drop-overlay').hidden = true;
  openFiles(event.dataTransfer.files);
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
  if (event.target === $('viewer') && objects.length && !busy) {
    const pans = { ArrowLeft: [-20, 0], ArrowRight: [20, 0], ArrowUp: [0, -20], ArrowDown: [0, 20] };
    if (pans[event.key]) { event.preventDefault(); renderer.pan(...pans[event.key]); }
  }
});
document.addEventListener('visibilitychange', () => { if (document.hidden && spinning) { renderer.stop(); spinning = false; syncControls(); } });

const resizer = $('panel-resizer');
function resizeInspector(width) {
  const limit = Math.min(420, Math.max(270, innerWidth - 620));
  const value = Math.round(Math.max(270, Math.min(limit, width)));
  document.documentElement.style.setProperty('--inspector-width', `${value}px`);
  resizer.setAttribute('aria-valuenow', String(value));
}
resizer.addEventListener('pointerdown', event => { resizer.setPointerCapture(event.pointerId); document.body.classList.add('resize-active'); });
resizer.addEventListener('pointermove', event => { if (resizer.hasPointerCapture(event.pointerId)) resizeInspector(innerWidth - event.clientX); });
resizer.addEventListener('pointerup', event => { resizer.releasePointerCapture(event.pointerId); document.body.classList.remove('resize-active'); });
resizer.addEventListener('lostpointercapture', () => document.body.classList.remove('resize-active'));
resizer.addEventListener('keydown', event => { if (['ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); resizeInspector($('inspector').getBoundingClientRect().width + (event.key === 'ArrowLeft' ? 20 : -20)); } });
const compact = matchMedia('(max-width: 950px)');
setInspector(!compact.matches);
compact.addEventListener('change', event => setInspector(!event.matches));
try { applyTheme(localStorage.getItem('molecule3d-theme') === 'dark' ? 'dark' : 'light'); } catch { applyTheme('light'); }

try {
  renderer = new MolecularViewer($('viewer'), message => notice(message, true), selectAtom);
  ready = true;
  $('viewer').addEventListener('webglcontextlost', event => {
    event.preventDefault(); ready = false; spinning = false;
    notice('The graphics context was lost. Reload the page to restart the viewer.', true); syncControls();
  }, true);
  record('Workspace ready. Add structures, samples, or a PDB ID.');
} catch {
  notice('The 3D viewer could not start. Enable WebGL / hardware acceleration in your browser, then reload.', true);
}
syncStructure();

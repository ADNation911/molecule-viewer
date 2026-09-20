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
import {
  measurementValue, formatMeasurement, matchBackboneAtoms, refinedSuperposition,
} from './analysis.js';

const $ = id => document.getElementById(id);
const all = selector => [...document.querySelectorAll(selector)];
const activities = [];
const objects = [];
const namedSelections = [];
const measurements = [];
let renderer;
let activeId = null;
let selection = null;
let measurementMode = null;
let measurementDraft = [];
let busy = false;
let spinning = false;
let ready = false;
let nextObjectId = 1;
let nextSelectionId = 1;
let nextMeasurementId = 1;

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
  syncAnalysis();
}

function renderViewer() {
  renderer.apply(objects, selection, measurements, measurementDraft);
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
      : measurementMode
        ? `${measurementMode[0].toUpperCase() + measurementMode.slice(1)} measurement · ${measurementDraft.length}/${requiredMeasurementAtoms[measurementMode]} atoms picked`
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

const requiredMeasurementAtoms = { distance: 2, angle: 3, dihedral: 4 };

function measurementAtom(descriptor) {
  return objectById(descriptor.objectId)?.atoms.find(atom => atom.__workspaceIndex === descriptor.atomIndex) || null;
}

function atomDisplayName(object, atom) {
  const atomName = String(atom.atom || atom.elem || 'Atom').trim();
  const residue = atom.resn ? ` · ${atom.resn} ${atom.resi}${atom.icode || ''}${atom.chain ? `:${atom.chain}` : ''}` : '';
  return `${object.title} · ${atomName} ${atom.serial || atom.__workspaceIndex + 1}${residue}`;
}

function appendChainOptions(select, object) {
  const previous = select.value;
  select.replaceChildren(new Option('Auto · best matching chain', ''));
  if (object) for (const chain of object.summary.chains) {
    const count = chain.residues.filter(residue => !residue.hetflag).length;
    if (count >= 3) select.append(new Option(`Chain ${chain.label} · ${count} residues`, chain.id));
  }
  if ([...select.options].some(option => option.value === previous)) select.value = previous;
}

function syncAnalysis() {
  const current = activeObject();
  all('[data-measure]').forEach(button => {
    button.setAttribute('aria-pressed', String(measurementMode === button.dataset.measure));
    button.disabled = !current || busy;
  });
  $('measurement-cancel').hidden = !measurementMode;
  const needed = measurementMode ? requiredMeasurementAtoms[measurementMode] : 0;
  $('measurement-instruction').textContent = measurementMode
    ? `Pick ${needed - measurementDraft.length} more atom${needed - measurementDraft.length === 1 ? '' : 's'} in the 3D view.`
    : 'Choose a measurement, then pick atoms in order.';
  $('measurement-count').textContent = measurements.length;
  $('measurement-list').replaceChildren();
  if (!measurements.length) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.textContent = 'Distances, angles, and dihedrals will appear here.';
    $('measurement-list').append(empty);
  } else for (const measurement of measurements) {
    const row = document.createElement('div');
    row.className = 'measurement-row';
    const detail = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = measurement.type[0].toUpperCase() + measurement.type.slice(1);
    const atoms = measurement.points.map(measurementAtom);
    const value = document.createElement('span');
    try { value.textContent = formatMeasurement(measurement.type, measurementValue(measurement.type, atoms)); }
    catch { value.textContent = 'Unavailable'; }
    const description = document.createElement('small');
    description.textContent = measurement.points.map((point, index) => atomDisplayName(objectById(point.objectId), atoms[index])).join(' → ');
    detail.append(title, value, description);
    const remove = document.createElement('button');
    remove.className = 'object-icon';
    remove.dataset.removeMeasurement = measurement.id;
    remove.setAttribute('aria-label', `Delete ${measurement.type} measurement`);
    remove.textContent = '×';
    row.append(detail, remove);
    $('measurement-list').append(row);
  }
  $('clear-measurements').disabled = !measurements.length || busy;

  const referenceSelect = $('alignment-reference');
  const previousReference = referenceSelect.value;
  referenceSelect.replaceChildren(new Option(objects.length > 1 ? 'Choose reference object' : 'Add another object first', ''));
  for (const object of objects) if (object.id !== activeId) referenceSelect.append(new Option(object.title, object.id));
  if (previousReference && [...referenceSelect.options].some(option => option.value === previousReference)) referenceSelect.value = previousReference;
  else if (referenceSelect.options.length === 2) referenceSelect.selectedIndex = 1;
  const reference = objectById(referenceSelect.value);
  $('alignment-moving').textContent = current?.title || 'No active object';
  appendChainOptions($('alignment-moving-chain'), current);
  appendChainOptions($('alignment-reference-chain'), reference);
  $('alignment-reference').disabled = !current || objects.length < 2 || busy;
  $('alignment-moving-chain').disabled = !current || busy;
  $('alignment-reference-chain').disabled = !reference || busy;
  $('align-objects').disabled = !current || !reference || busy;
  $('reset-alignment').disabled = !current?.alignment || busy;
  $('alignment-result').replaceChildren();
  if (current?.alignment) {
    const heading = document.createElement('strong');
    heading.textContent = `${current.alignment.rmsd.toFixed(3)} Å RMSD`;
    const meta = document.createElement('span');
    meta.textContent = `${current.alignment.matchedCount} backbone atoms · ${Math.round(current.alignment.identity * 100)}% sequence identity`;
    const chains = document.createElement('small');
    chains.textContent = `Chain ${current.alignment.movingChain || '—'} → ${current.alignment.referenceTitle}, chain ${current.alignment.referenceChain || '—'}${current.alignment.rejectedCount ? ` · ${current.alignment.rejectedCount} outlier${current.alignment.rejectedCount === 1 ? '' : 's'} removed` : ''}`;
    $('alignment-result').append(heading, meta, chains);
  } else {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.textContent = current ? 'Align the active object onto a reference using matching Cα/P backbone atoms.' : 'Load two structures to compare them.';
    $('alignment-result').append(empty);
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
  syncAnalysis();
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
      originalCoordinates: prepared.atoms.map(atom => ({ x: atom.x, y: atom.y, z: atom.z })),
      alignment: null,
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
  if (measurementMode) {
    const descriptor = { objectId: id, atomIndex: atom.__workspaceIndex };
    if (measurementDraft.some(point => point.objectId === id && point.atomIndex === descriptor.atomIndex)) {
      notice('Choose a different atom for this measurement.', true);
      return;
    }
    measurementDraft.push(descriptor);
    const required = requiredMeasurementAtoms[measurementMode];
    if (measurementDraft.length === required) {
      const pickedAtoms = measurementDraft.map(measurementAtom);
      try {
        const value = measurementValue(measurementMode, pickedAtoms);
        const completedType = measurementMode;
        measurements.push({ id: `measurement-${nextMeasurementId++}`, type: completedType, points: structuredClone(measurementDraft) });
        measurementMode = null;
        measurementDraft = [];
        renderViewer();
        syncControls();
        syncAnalysis();
        record(`Measured ${completedType}: ${formatMeasurement(completedType, value)}`);
      } catch (error) {
        measurementDraft = [];
        renderViewer();
        syncControls();
        syncAnalysis();
        notice(error.message, true);
      }
    } else {
      renderViewer();
      syncControls();
      syncAnalysis();
    }
    return;
  }
  const key = residueKey(atom);
  const atomName = atom.atom || atom.elem || 'Atom';
  setSelection({
    objectId: id, kind: 'atom', primaryKeys: key ? [key] : [], secondaryKeys: [],
    atomSelector: Number.isFinite(atom.serial) ? { serial: atom.serial } : { index: atom.__workspaceIndex ?? atom.index },
    label: `Atom: ${atomName} ${atom.serial || (atom.__workspaceIndex ?? 0) + 1}${atom.resn ? ` · ${atom.resn} ${atom.resi}${atom.icode || ''}` : ''}`,
  }, `Selected atom ${atomName} in ${object.title}`);
}

function startMeasurement(type) {
  if (!activeObject() || busy) return;
  measurementMode = measurementMode === type ? null : type;
  measurementDraft = [];
  renderViewer();
  syncControls();
  syncAnalysis();
  record(measurementMode ? `Started ${type} measurement` : `Cancelled ${type} measurement`);
}

function cancelMeasurement() {
  if (!measurementMode && !measurementDraft.length) return;
  measurementMode = null;
  measurementDraft = [];
  renderViewer();
  syncControls();
  syncAnalysis();
  record('Cancelled measurement');
}

function alignActiveObject() {
  const moving = activeObject();
  const reference = objectById($('alignment-reference').value);
  if (!moving || !reference || moving.id === reference.id || busy) return;
  try {
    const match = matchBackboneAtoms(moving.summary, reference.summary, $('alignment-moving-chain').value, $('alignment-reference-chain').value);
    const result = refinedSuperposition(match.pairs, 2, 5);
    const updated = renderer.transform(moving.id, result);
    moving.atoms = updated.atoms;
    moving.summary = updated.summary;
    moving.alignment = {
      referenceId: reference.id,
      referenceTitle: reference.title,
      movingChain: match.movingChain,
      referenceChain: match.referenceChain,
      identity: match.identity,
      rmsd: result.rmsd,
      matchedCount: result.matchedCount,
      rejectedCount: result.rejectedCount,
    };
    selection = null;
    renderViewer();
    renderer.fit();
    syncStructure();
    record(`Aligned ${moving.title} onto ${reference.title} · ${result.rmsd.toFixed(3)} Å RMSD over ${result.matchedCount} atoms`);
  } catch (error) {
    notice(error.message || 'The structures could not be aligned.', true);
  }
}

function resetAlignment() {
  const current = activeObject();
  if (!current?.alignment || busy) return;
  try {
    const updated = renderer.setCoordinates(current.id, current.originalCoordinates);
    current.atoms = updated.atoms;
    current.summary = updated.summary;
    current.alignment = null;
    selection = null;
    renderViewer();
    renderer.fit(current.id);
    syncStructure();
    record(`Restored original coordinates for ${current.title}`);
  } catch (error) {
    notice(error.message || 'The original coordinates could not be restored.', true);
  }
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
  for (let i = measurements.length - 1; i >= 0; i--) if (measurements[i].points.some(point => point.objectId === id)) measurements.splice(i, 1);
  if (measurementDraft.some(point => point.objectId === id)) { measurementMode = null; measurementDraft = []; }
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
    renderer.clear(); objects.splice(0); namedSelections.splice(0); measurements.splice(0); activeId = null; selection = null; measurementMode = null; measurementDraft = []; spinning = false;
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
  analysis: () => { setInspector(true); $('analysis-section').scrollIntoView({ block: 'start', behavior: 'smooth' }); },
  help: () => $('help-dialog').showModal(),
  assistant: () => $('assistant-dialog').showModal(),
  activity: () => $('activity-dialog').showModal(),
  'cancel-measurement': cancelMeasurement,
  'align-objects': alignActiveObject,
  'reset-alignment': resetAlignment,
  'clear-measurements': () => {
    if (!measurements.length || busy) return;
    measurements.splice(0);
    renderViewer();
    syncAnalysis();
    record('Cleared all measurements');
  },
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
  if (button.dataset.measure) {
    const menu = button.closest('details');
    if (menu) { menu.open = false; menu.querySelector('summary').focus(); }
    startMeasurement(button.dataset.measure);
  }
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
  if (button.dataset.removeMeasurement) {
    const index = measurements.findIndex(item => item.id === button.dataset.removeMeasurement);
    if (index >= 0) {
      const [removed] = measurements.splice(index, 1);
      renderViewer(); syncAnalysis(); record(`Deleted ${removed.type} measurement`);
    }
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
$('alignment-reference').addEventListener('change', syncAnalysis);
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
  if (key === 'm') { event.preventDefault(); startMeasurement('distance'); }
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

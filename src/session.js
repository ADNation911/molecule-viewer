const SESSION_KIND = 'molecule3d-workspace';
const SESSION_VERSION = 1;
export const MAX_SESSION_BYTES = 80 * 1024 * 1024;

const formats = new Set(['pdb', 'cif', 'sdf', 'xyz', 'pqr']);
const styles = new Set(['cartoon', 'ribbon', 'sticks', 'ballstick', 'spheres', 'surface']);
const colors = new Set(['chain', 'element', 'spectrum', 'teal', 'amber', 'violet', 'rose']);
const measurementLengths = { distance: 2, angle: 3, dihedral: 4 };

function requireArray(value, name, limit) {
  if (!Array.isArray(value) || value.length > limit) throw new Error(`The session has an invalid ${name} list.`);
  return value;
}

function finiteCoordinates(value) {
  return Array.isArray(value) && value.every(point => point && [point.x, point.y, point.z].every(Number.isFinite));
}

function validDisplay(value) {
  return value && styles.has(value.style) && colors.has(value.color)
    && ['visible', 'water', 'ligands', 'labels'].every(key => typeof value[key] === 'boolean')
    && Number.isFinite(value.opacity) && value.opacity >= 0.2 && value.opacity <= 1
    && Array.isArray(value.hiddenResidues) && value.hiddenResidues.length <= 500 && value.hiddenResidues.every(item => typeof item === 'string' && item.length <= 12)
    && Array.isArray(value.isolateKeys) && value.isolateKeys.length <= 500 && value.isolateKeys.every(item => typeof item === 'string' && item.length <= 100);
}

function safeWebSource(value) {
  if (value == null || value === '') return true;
  if (typeof value !== 'string' || value.length > 2048) return false;
  try { return ['http:', 'https:'].includes(new URL(value).protocol); }
  catch { return false; }
}

function shortString(value, limit = 200) {
  return typeof value === 'string' && value.length <= limit;
}

function validSelection(value, objectIds) {
  if (value == null) return true;
  return value && objectIds.has(value.objectId) && shortString(value.kind, 80) && shortString(value.label, 300)
    && Array.isArray(value.primaryKeys) && value.primaryKeys.length <= 500 && value.primaryKeys.every(item => shortString(item, 100))
    && Array.isArray(value.secondaryKeys) && value.secondaryKeys.length <= 500 && value.secondaryKeys.every(item => shortString(item, 100))
    && (value.chain == null || shortString(value.chain, 20))
    && (value.atomSelector == null || (typeof value.atomSelector === 'object' && Object.values(value.atomSelector).every(Number.isFinite)));
}

export function createSession(state) {
  return {
    kind: SESSION_KIND,
    version: SESSION_VERSION,
    savedAt: new Date().toISOString(),
    camera: state.camera,
    activeId: state.activeId,
    selection: state.selection,
    objects: state.objects,
    namedSelections: state.namedSelections,
    measurements: state.measurements,
    densityMaps: state.densityMaps,
    scenes: state.scenes,
  };
}

export function parseSession(text) {
  if (typeof text !== 'string' || !text.trim()) throw new Error('This session file is empty.');
  if (new TextEncoder().encode(text).length > MAX_SESSION_BYTES) throw new Error('This session file is larger than 80 MB.');
  let value;
  try { value = JSON.parse(text); }
  catch { throw new Error('This session file is not valid JSON.'); }
  if (value?.kind !== SESSION_KIND || value?.version !== SESSION_VERSION) throw new Error('This is not a supported Molecule3D session.');
  const objects = requireArray(value.objects, 'object', 32);
  const ids = new Set();
  let atomCount = 0;
  for (const object of objects) {
    if (!object || !shortString(object.id, 80) || !object.id || ids.has(object.id)) throw new Error('The session contains duplicate or invalid object identifiers.');
    ids.add(object.id);
    if (!formats.has(object.format) || typeof object.sourceText !== 'string' || !object.sourceText.trim()) throw new Error(`The session object ${object.id} has invalid source data.`);
    if (!shortString(object.name || '', 260) || !shortString(object.title || '', 260) || !shortString(object.description || '', 2000)) throw new Error(`The session object ${object.id} has invalid metadata.`);
    if (!finiteCoordinates(object.coordinates)) throw new Error(`The session object ${object.id} has invalid coordinates.`);
    if (!validDisplay(object.display)) throw new Error(`The session object ${object.id} has invalid display settings.`);
    if (!safeWebSource(object.source)) throw new Error(`The session object ${object.id} has an invalid source link.`);
    atomCount += object.coordinates.length;
  }
  if (atomCount > 120_000) throw new Error('The session exceeds the 120,000 atom workspace limit.');
  const namedSelections = requireArray(value.namedSelections || [], 'named selection', 500);
  const measurements = requireArray(value.measurements || [], 'measurement', 500);
  const densityMaps = requireArray(value.densityMaps || [], 'density map', 8);
  const scenes = requireArray(value.scenes || [], 'scene', 100);
  if (!objects.length && !densityMaps.length) throw new Error('The session contains no molecular objects or density maps.');
  if (value.activeId != null && !ids.has(value.activeId)) throw new Error('The session active object is invalid.');
  if (!validSelection(value.selection, ids)) throw new Error('The session selection is invalid.');
  if (namedSelections.some(item => !item || !shortString(item.id, 80) || !shortString(item.name, 80) || !ids.has(item.objectId) || !validSelection(item.selection, ids))) throw new Error('The session contains invalid named selections.');
  if (measurements.some(item => !item || !shortString(item.id, 80) || !measurementLengths[item.type] || !Array.isArray(item.points) || item.points.length !== measurementLengths[item.type] || item.points.some(point => !point || !ids.has(point.objectId) || !Number.isSafeInteger(point.atomIndex) || point.atomIndex < 0))) throw new Error('The session contains invalid measurements.');
  const densityIds = new Set();
  if (densityMaps.some(map => {
    if (!map || !shortString(map.id, 80) || densityIds.has(map.id)) return true;
    densityIds.add(map.id);
    return !shortString(map.name, 260) || typeof map.text !== 'string' || !['cube', 'dx'].includes(map.format)
      || !Number.isFinite(map.isovalue) || map.isovalue <= 0 || !Number.isFinite(map.opacity) || map.opacity < 0.1 || map.opacity > 1
      || !/^#[0-9a-f]{6}$/i.test(map.color) || !/^#[0-9a-f]{6}$/i.test(map.negativeColor)
      || ['negative', 'wireframe', 'visible'].some(key => typeof map[key] !== 'boolean');
  })) throw new Error('The session contains invalid density map data.');
  if (scenes.some(scene => !scene || !shortString(scene.id, 80) || !shortString(scene.name, 80) || !Array.isArray(scene.view) || scene.view.length < 8 || !scene.view.slice(0, 8).every(Number.isFinite) || (scene.activeId != null && !ids.has(scene.activeId)) || !validSelection(scene.selection, ids) || !scene.frames || typeof scene.frames !== 'object' || Object.values(scene.frames).some(frame => !Number.isSafeInteger(frame) || frame < 0))) throw new Error('The session contains an invalid saved scene.');
  if (value.camera != null && (!Array.isArray(value.camera) || value.camera.length < 8 || !value.camera.slice(0, 8).every(Number.isFinite))) throw new Error('The session camera is invalid.');
  return { ...value, objects, namedSelections, measurements, densityMaps, scenes };
}

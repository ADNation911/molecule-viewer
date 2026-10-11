import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession, parseSession } from '../src/session.js';

function validState() {
  return {
    camera: [0, 0, 0, 1, 0, 0, 0, 1], activeId: 'object-1', selection: null,
    objects: [{
      id: 'object-1', name: 'hydrogen.xyz', title: 'Hydrogen', description: '', format: 'xyz', sourceText: '1\nH\nH 0 0 0', coordinates: [{ x: 0, y: 0, z: 0 }],
      display: { style: 'ballstick', color: 'element', visible: true, water: true, ligands: true, labels: false, opacity: 0.9, hiddenResidues: [], isolateKeys: [] },
    }],
    namedSelections: [], measurements: [], densityMaps: [], scenes: [],
  };
}

test('session files round-trip the allowlisted workspace state', () => {
  const session = createSession(validState());
  assert.equal(session.kind, 'molecule3d-workspace');
  const parsed = parseSession(JSON.stringify(session));
  assert.equal(parsed.objects[0].id, 'object-1');
});

test('session validation rejects malformed coordinates and duplicate ids', () => {
  const state = validState();
  state.objects[0].coordinates[0].x = Infinity;
  assert.throws(() => parseSession(JSON.stringify(createSession(state))), /coordinates/);
  const duplicate = validState();
  duplicate.objects.push({ ...duplicate.objects[0] });
  assert.throws(() => parseSession(JSON.stringify(createSession(duplicate))), /duplicate/);
});

test('session validation rejects unsafe source links and malformed display settings', () => {
  const unsafe = validState();
  unsafe.objects[0].source = 'javascript:alert(1)';
  assert.throws(() => parseSession(JSON.stringify(createSession(unsafe))), /source link/);
  const malformed = validState();
  malformed.objects[0].display = { style: 'script' };
  assert.throws(() => parseSession(JSON.stringify(createSession(malformed))), /display settings/);
});

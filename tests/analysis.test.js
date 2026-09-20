import test from 'node:test';
import assert from 'node:assert/strict';
import {
  distanceBetween, angleBetween, dihedralBetween, alignSequences,
  rigidSuperposition, applyTransform, refinedSuperposition, matchBackboneAtoms,
} from '../src/analysis.js';

const close = (actual, expected, tolerance = 1e-6) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} ≈ ${expected}`);

test('distance, angle and dihedral calculations use molecular geometry units', () => {
  close(distanceBetween({ x: 0, y: 0, z: 0 }, { x: 3, y: 4, z: 0 }), 5);
  close(angleBetween({ x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }), 90);
  close(Math.abs(dihedralBetween(
    { x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 0 },
    { x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: 1 },
  )), 90);
});

test('global sequence alignment keeps ordered residue correspondences', () => {
  const result = alignSequences(['A', 'C', 'D', 'E'], ['A', 'D', 'E']);
  assert.deepEqual(result.pairs, [[0, 0], [2, 1], [3, 2]]);
});

test('rigid superposition recovers rotation and translation with near-zero RMSD', () => {
  const moving = [
    { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 },
    { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 },
  ];
  const reference = moving.map(({ x, y, z }) => ({ x: 5 - y, y: -2 + x, z: 3 + z }));
  const transform = rigidSuperposition(moving, reference);
  close(transform.rmsd, 0);
  moving.forEach((point, index) => close(distanceBetween(applyTransform(point, transform), reference[index]), 0));
});

test('refined superposition rejects a distant outlier', () => {
  const pairs = [0, 1, 2, 3].map(index => ({
    moving: { x: index % 2, y: Math.floor(index / 2), z: index === 3 ? 1 : 0 },
    reference: { x: index % 2 + 4, y: Math.floor(index / 2) - 3, z: index === 3 ? 1 : 0 },
  }));
  pairs.push({ moving: { x: 2, y: 2, z: 2 }, reference: { x: 50, y: 50, z: 50 } });
  const result = refinedSuperposition(pairs, 2, 5);
  assert.equal(result.matchedCount, 4);
  assert.equal(result.rejectedCount, 1);
  close(result.rmsd, 0);
});

test('backbone matching selects identical residues and their C-alpha anchors', () => {
  const residue = (symbol, x) => ({ symbol, hetflag: false, atoms: [{ atom: 'CA', x, y: 0, z: 0 }] });
  const moving = { chains: [{ id: 'A', residues: [residue('A', 0), residue('C', 1), residue('D', 2), residue('E', 3)] }] };
  const reference = { chains: [{ id: 'B', residues: [residue('A', 4), residue('D', 6), residue('E', 7)] }] };
  const result = matchBackboneAtoms(moving, reference);
  assert.equal(result.movingChain, 'A');
  assert.equal(result.referenceChain, 'B');
  assert.equal(result.pairs.length, 3);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateFile, validateText, summarizeAtoms, visibleSelection, MAX_BYTES, MAX_ATOMS } from '../src/structures.js';

test('file validation recognizes aliases and rejects empty, oversized or unsupported inputs', () => {
  assert.equal(validateFile({ name: 'Protein.MMCIF', size: 120 }), 'cif');
  assert.equal(validateFile({ name: 'compound.mol', size: 120 }), 'sdf');
  for (const file of [{ name: 'notes.txt', size: 10 }, { name: 'empty.pdb', size: 0 }, { name: 'huge.pdb', size: MAX_BYTES + 1 }]) assert.throws(() => validateFile(file));
});

test('renamed non-structure text and invalid coordinates are rejected', () => {
  assert.throws(() => validateText('<html>not a molecule</html>', 'pdb'));
  assert.throws(() => validateText('data_missing\n_atom_site.label_atom_id', 'cif'));
  assert.throws(() => validateText('9\ncomment\nC 1 2 3', 'xyz'));
  assert.throws(() => validateText('1\ncomment\nC NaN 2 3', 'xyz'));
  assert.throws(() => validateText('1\ncomment\nC Infinity 2 3', 'xyz'));
  assert.throws(() => validateText('binary\0file', 'pdb'));
});

test('bundled protein and ligand fixtures pass the import preflight', () => {
  for (const [name, format] of [['1D66.pdb', 'pdb'], ['3RGK.pdb', 'pdb'], ['ethanol.xyz', 'xyz']]) {
    const data = readFileSync(new URL(`../public/samples/${name}`, import.meta.url), 'utf8');
    assert.doesNotThrow(() => validateText(data, format));
  }
});

test('residues are distinguished by chain and insertion code, while alternate atoms do not inflate counts', () => {
  const atom = { x: 0, y: 1, z: 2, chain: 'A', resi: 42, resn: 'ALA', atom: 'CA', hetflag: false };
  const data = summarizeAtoms([atom, { ...atom, altLoc: 'B' }, { ...atom, icode: 'A' }, { ...atom, chain: 'B' }, { ...atom, resn: 'HOH', resi: 50, hetflag: true }]);
  assert.equal(data.atomCount, 5); assert.equal(data.residueCount, 4); assert.equal(data.chainCount, 2);
  assert.equal(data.hasBackbone, true); assert.equal(data.waterCount, 1);
  assert.deepEqual(data.residueTypes, [{ name: 'ALA', count: 3 }, { name: 'HOH', count: 1 }]);
});

test('zero atoms, non-finite parsed coordinates and structures beyond the limit fail safely', () => {
  assert.throws(() => summarizeAtoms([]));
  assert.throws(() => summarizeAtoms([{ x: NaN, y: 0, z: 0 }]));
  assert.throws(() => summarizeAtoms([{ x: 1e8, y: 0, z: 0 }]));
  assert.throws(() => summarizeAtoms(Array(MAX_ATOMS + 1).fill({ x: 0, y: 0, z: 0 })));
});

test('small molecules without residue annotations remain valid and do not get a cartoon default', () => {
  const summary = summarizeAtoms([{ elem: 'C', x: 0, y: 0, z: 0 }, { elem: 'O', x: 1.4, y: 0, z: 0 }]);
  assert.equal(summary.hasBackbone, false); assert.equal(summary.residueCount, 0); assert.equal(summary.chainCount, 0);
});

test('water and residue filters use the same combined selection for atoms and surfaces', () => {
  const display = { water: false, hiddenResidues: ['HOH', 'ALA'] };
  const selection = visibleSelection(display);
  assert.deepEqual(new Set(selection.not.resn), new Set(['HOH', 'ALA', 'WAT', 'H2O', 'DOD']));
  assert.deepEqual(display.hiddenResidues, ['HOH', 'ALA']);
  assert.deepEqual(visibleSelection({ water: true, hiddenResidues: [] }), {});
});

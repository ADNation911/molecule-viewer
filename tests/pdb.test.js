import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePdbId, fetchPdbStructure } from '../src/pdb.js';

test('PDB identifiers are normalized and invalid input is rejected before a request', () => {
  assert.equal(normalizePdbId(' 1d66 '), '1D66');
  for (const value of ['', 'abc', 'ABCDE', 'test']) assert.throws(() => normalizePdbId(value));
});

test('PDB fetch returns mmCIF text and source metadata', async () => {
  const request = async url => ({ ok: true, status: 200, text: async () => 'data_1D66\n_atom_site.Cartn_x\n_atom_site.Cartn_y\n_atom_site.Cartn_z' , url });
  const result = await fetchPdbStructure('1d66', request);
  assert.equal(result.id, '1D66');
  assert.match(result.text, /data_1D66/);
  assert.equal(result.source, 'https://www.rcsb.org/structure/1D66');
});

test('PDB fetch distinguishes missing structures and network failures', async () => {
  await assert.rejects(() => fetchPdbStructure('1D66', async () => ({ ok: false, status: 404 })), /no structure/i);
  await assert.rejects(() => fetchPdbStructure('1D66', async () => { throw new Error('offline'); }), /Could not reach/i);
});

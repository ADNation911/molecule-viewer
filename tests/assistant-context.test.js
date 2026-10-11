import test from 'node:test';
import assert from 'node:assert/strict';
import { buildStructureContext, createCitedReport, residueTargetId } from '../src/assistant-context.js';

const residue = { key: 'r1', chain: 'A', resi: 42, icode: 'B', resn: 'GLY' };

test('assistant context contains bounded metadata without coordinates', () => {
  const object = {
    id: 'object-1', title: 'Protein', description: 'Example', format: 'pdb', currentFrame: 1, frameCount: 3,
    summary: { atomCount: 100, residueCount: 1, chains: [{ id: 'A' }], ligands: [], residues: [residue] },
  };
  const context = buildStructureContext(object, { objectId: 'object-1', kind: 'residue', label: 'GLY 42B', primaryKeys: ['r1'] }, 'What is residue 42?');
  assert.equal(context.frame, 2);
  assert.equal(context.residues[0].id, 'A:42B:GLY');
  assert.deepEqual(context.selection.residue_ids, ['A:42B:GLY']);
  assert.equal(JSON.stringify(context).includes('coordinates'), false);
});

test('report export includes the question, answer, structure, and cited links', () => {
  const report = createCitedReport({
    question: 'What does it bind?', answer: 'It binds oxygen [S1].',
    context: { title: 'Myoglobin', format: 'pdb', atom_count: 100, residue_count: 10, frame: 1, frame_count: 1 },
    sources: [{ label: 'S1', title: 'Paper', url: 'https://example.test/paper', publication: 'Journal', year: '2024' }],
    generatedAt: new Date('2026-01-01T00:00:00Z'),
  });
  assert.match(report, /Myoglobin/);
  assert.match(report, /It binds oxygen \[S1\]/);
  assert.match(report, /https:\/\/example\.test\/paper/);
});

test('residue action identifiers preserve chain, insertion code, and residue name', () => {
  assert.equal(residueTargetId(residue), 'A:42B:GLY');
});

test('large structure context stays bounded while retaining the active residue', () => {
  const residues = Array.from({ length: 900 }, (_, index) => ({
    key: `r${index + 1}`, chain: 'A', resi: index + 1, icode: '', resn: 'GLY',
  }));
  const object = {
    id: 'object-large', title: 'Large protein', format: 'pdb', currentFrame: 0, frameCount: 1,
    summary: { atomCount: 900, residueCount: 900, chains: [{ id: 'A' }], ligands: [], residues },
  };

  const context = buildStructureContext(object, {
    objectId: 'object-large', kind: 'residue', label: 'GLY 900', primaryKeys: ['r900'],
  });

  assert.equal(context.residues.length, 600);
  assert.ok(context.residues.some(item => item.id === 'A:900:GLY'));
  assert.deepEqual(context.selection.residue_ids, ['A:900:GLY']);
});

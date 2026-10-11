import test from 'node:test';
import assert from 'node:assert/strict';
import { createIdFactory, fileStem } from '../src/workspace-utils.js';

test('identifier factory allocates, restores, and resets workspace ids', () => {
  const ids = createIdFactory(['object', 'scene']);
  assert.equal(ids.take('object'), 'object-1');
  assert.equal(ids.take('object'), 'object-2');
  ids.restore('object', [{ id: 'object-8' }, { id: 'other-99' }, { id: 'object-invalid' }]);
  assert.equal(ids.take('object'), 'object-9');
  ids.reset();
  assert.equal(ids.take('object'), 'object-1');
  assert.throws(() => ids.take('unknown'), /Unknown identifier prefix/);
});

test('file stems are portable, bounded, and have a stable fallback', () => {
  assert.equal(fileStem('My protein.pdb'), 'My-protein');
  assert.equal(fileStem('***', 'report'), 'report');
  assert.equal(fileStem('a'.repeat(100)).length, 60);
});

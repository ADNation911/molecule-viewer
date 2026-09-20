import test from 'node:test';
import assert from 'node:assert/strict';
import { DisplayHistory, defaultDisplay } from '../src/history.js';

test('multiple undos and redos restore the full display without creating extra history', () => {
  const h = new DisplayHistory(defaultDisplay());
  const initial = h.value;
  const second = { ...initial, style: 'surface', water: false, hiddenResidues: ['HOH'] };
  const third = { ...second, color: 'element', labels: true, opacity: .4 };
  h.commit(second); h.commit(third);
  assert.equal(h.undo(), true); assert.deepEqual(h.value, second);
  assert.equal(h.undo(), true); assert.deepEqual(h.value, initial);
  assert.equal(h.undo(), false);
  assert.equal(h.redo(), true); assert.deepEqual(h.value, second);
  assert.equal(h.redo(), true); assert.deepEqual(h.value, third);
  assert.equal(h.redo(), false);
});

test('a new edit after undo removes the abandoned redo branch', () => {
  const h = new DisplayHistory(defaultDisplay());
  h.commit({ ...h.value, style: 'sticks' });
  h.commit({ ...h.value, style: 'surface' });
  h.undo(); h.commit({ ...h.value, water: false });
  assert.equal(h.canRedo, false);
  h.undo(); assert.equal(h.value.style, 'sticks'); assert.equal(h.value.water, true);
});

test('no-op changes do not pollute history or invalidate redo', () => {
  const h = new DisplayHistory(defaultDisplay());
  assert.equal(h.commit(h.value), false);
  assert.equal(h.canUndo, false);
  h.commit({ ...h.value, style: 'ribbon' }); h.undo();
  h.commit(h.value); assert.equal(h.canRedo, true);
});

test('new structures reset history and snapshots cannot be mutated from outside', () => {
  const h = new DisplayHistory(defaultDisplay());
  const next = { ...h.value, hiddenResidues: ['HOH'] };
  h.commit(next); next.hiddenResidues.push('ALA');
  const read = h.value; read.hiddenResidues.push('ARG');
  assert.deepEqual(h.value.hiddenResidues, ['HOH']);
  h.reset(defaultDisplay(false));
  assert.equal(h.value.style, 'ballstick');
  assert.equal(h.canUndo, false); assert.equal(h.canRedo, false);
});

test('history retains only the configured number of reversible changes', () => {
  const h = new DisplayHistory({ n: 0 }, 2);
  h.commit({ n: 1 }); h.commit({ n: 2 }); h.commit({ n: 3 });
  h.undo(); h.undo(); assert.deepEqual(h.value, { n: 1 });
  assert.equal(h.undo(), false);
});

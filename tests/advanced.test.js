import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCommand, sampledFrameIndexes, validateDensityText } from '../src/advanced.js';

test('safe command parser accepts documented molecular workspace commands', () => {
  assert.deepEqual(parseCommand('style Cartoon'), { type: 'style', value: 'cartoon' });
  assert.deepEqual(parseCommand('hide water'), { type: 'visibility', target: 'water', value: false });
  assert.deepEqual(parseCommand('select residue A:42'), { type: 'select-residue', value: 'A:42' });
  assert.deepEqual(parseCommand('frame 3'), { type: 'frame', value: 2 });
  assert.deepEqual(parseCommand('scene save Active site'), { type: 'scene-save', name: 'Active site' });
});

test('safe command parser rejects unknown commands and unbounded turns', () => {
  assert.throws(() => parseCommand('javascript alert(1)'), /Unsupported command/);
  assert.throws(() => parseCommand('turn y 9000'), /limited/);
  assert.throws(() => parseCommand('select residue DROP TABLE'), /Unsupported command/);
});

test('density validation reads cube dimensions and enforces the voxel limit', () => {
  const cube = ['title', 'comment', '1 0 0 0', '2 1 0 0', '2 0 1 0', '2 0 0 1', '1 0 0 0 0', '0 0 0 0 0 0 0 0'].join('\n');
  assert.deepEqual(validateDensityText(cube, 'cube'), { dimensions: [2, 2, 2], voxelCount: 8 });
  const huge = ['title', 'comment', '1 0 0 0', '200 1 0 0', '200 0 1 0', '200 0 0 1', '1 0 0 0 0', '0'].join('\n');
  assert.throws(() => validateDensityText(huge, 'cube'), /voxel/);
});

test('trajectory export samples long frame sets including both endpoints', () => {
  assert.deepEqual(sampledFrameIndexes(3), [0, 1, 2]);
  const indexes = sampledFrameIndexes(100, 5);
  assert.deepEqual(indexes, [0, 25, 50, 74, 99]);
});

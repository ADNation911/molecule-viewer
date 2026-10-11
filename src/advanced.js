export const MAX_DENSITY_BYTES = 20 * 1024 * 1024;
export const MAX_DENSITY_VOXELS = 2_000_000;
export const MAX_TRAJECTORY_FRAMES = 500;

const representations = new Set(['cartoon', 'ribbon', 'sticks', 'ballstick', 'spheres', 'surface']);
const colors = new Set(['chain', 'element', 'spectrum', 'teal', 'amber', 'violet', 'rose']);
const toggles = new Set(['object', 'water', 'ligands', 'labels']);

export const commandExamples = [
  'style cartoon',
  'color spectrum',
  'show ligands',
  'hide water',
  'select chain A',
  'select residue A:42',
  'select ligand HEM',
  'frame 3',
  'play',
  'pause',
  'turn y 90',
  'fit',
  'scene save Binding site',
  'scene play',
  'export image',
  'export animation',
  'export session',
];

export function densityFormat(file) {
  if (!file || typeof file.name !== 'string') throw new Error('Choose a Gaussian Cube or OpenDX density file.');
  const extension = file.name.split('.').pop().toLowerCase();
  if (!['cube', 'cub', 'dx'].includes(extension)) throw new Error('Unsupported density map. Choose a .cube, .cub, or .dx text file.');
  if (!file.size) throw new Error('This density file is empty.');
  if (file.size > MAX_DENSITY_BYTES) throw new Error('This density file is larger than 20 MB.');
  return extension === 'dx' ? 'dx' : 'cube';
}

function positiveInteger(value) {
  const number = Math.abs(Number(value));
  return Number.isInteger(number) && number > 0 ? number : 0;
}

export function validateDensityText(text, format) {
  if (typeof text !== 'string' || !text.trim()) throw new Error('No density data was found.');
  if (text.includes('\0')) throw new Error('Binary density maps are not supported in the browser importer.');
  if (new TextEncoder().encode(text).length > MAX_DENSITY_BYTES) throw new Error('This density file exceeds the 20 MB limit.');
  let dimensions;
  if (format === 'cube') {
    const lines = text.trim().split(/\r?\n/);
    if (lines.length < 7) throw new Error('The Gaussian Cube header is incomplete.');
    const atomCount = positiveInteger(lines[2]?.trim().split(/\s+/)[0]);
    dimensions = [3, 4, 5].map(index => positiveInteger(lines[index]?.trim().split(/\s+/)[0]));
    if (!atomCount || dimensions.some(value => !value) || lines.length <= 6 + atomCount) throw new Error('This is not a valid Gaussian Cube text file.');
  } else if (format === 'dx') {
    const match = text.match(/object\s+1\s+class\s+gridpositions\s+counts\s+(\d+)\s+(\d+)\s+(\d+)/i);
    if (!match || !/data\s+follows/i.test(text)) throw new Error('This is not a valid OpenDX density file.');
    dimensions = match.slice(1).map(positiveInteger);
  } else {
    throw new Error('Unsupported density format.');
  }
  const voxelCount = dimensions.reduce((product, value) => product * value, 1);
  if (!Number.isSafeInteger(voxelCount) || voxelCount > MAX_DENSITY_VOXELS) throw new Error('This density grid exceeds the 2,000,000 voxel browser limit.');
  return { dimensions, voxelCount };
}

function words(input) {
  return input.trim().split(/\s+/).filter(Boolean);
}

export function parseCommand(input) {
  const tokens = words(input);
  if (!tokens.length) throw new Error('Enter a command. Type help to list supported commands.');
  const verb = tokens[0].toLowerCase();
  const args = tokens.slice(1);
  if (verb === 'help' && !args.length) return { type: 'help' };
  if (verb === 'fit' && !args.length) return { type: 'fit' };
  if (verb === 'play' && !args.length) return { type: 'play' };
  if (verb === 'pause' && !args.length) return { type: 'pause' };
  if (verb === 'style' && args.length === 1 && representations.has(args[0].toLowerCase())) return { type: 'style', value: args[0].toLowerCase() };
  if (verb === 'color' && args.length === 1 && colors.has(args[0].toLowerCase())) return { type: 'color', value: args[0].toLowerCase() };
  if (['show', 'hide'].includes(verb) && args.length === 1 && toggles.has(args[0].toLowerCase())) return { type: 'visibility', target: args[0].toLowerCase(), value: verb === 'show' };
  if (verb === 'frame' && args.length === 1 && /^\d+$/.test(args[0]) && Number(args[0]) > 0) return { type: 'frame', value: Number(args[0]) - 1 };
  if (verb === 'turn' && args.length === 2 && /^[xyz]$/i.test(args[0]) && Number.isFinite(Number(args[1]))) {
    const degrees = Number(args[1]);
    if (Math.abs(degrees) > 3600) throw new Error('Turn angles are limited to 3,600 degrees.');
    return { type: 'turn', axis: args[0].toLowerCase(), degrees };
  }
  if (verb === 'theme' && args.length === 1 && ['light', 'dark'].includes(args[0].toLowerCase())) return { type: 'theme', value: args[0].toLowerCase() };
  if (verb === 'select' && args.length === 2) {
    const kind = args[0].toLowerCase();
    if (kind === 'chain') return { type: 'select-chain', value: args[1] };
    if (kind === 'residue' && /^(?:[^:]+:)?-?\d+[A-Za-z]?$/.test(args[1])) return { type: 'select-residue', value: args[1] };
    if (kind === 'ligand' && /^[A-Za-z0-9]{1,8}$/.test(args[1])) return { type: 'select-ligand', value: args[1].toUpperCase() };
  }
  if (verb === 'scene' && args[0]?.toLowerCase() === 'play' && args.length === 1) return { type: 'scene-play' };
  if (verb === 'scene' && args[0]?.toLowerCase() === 'save' && args.length >= 2) return { type: 'scene-save', name: args.slice(1).join(' ').slice(0, 60) };
  if (verb === 'export' && args.length === 1 && ['image', 'animation', 'session'].includes(args[0].toLowerCase())) return { type: `export-${args[0].toLowerCase()}` };
  throw new Error('Unsupported command or arguments. Type help to list the safe command subset.');
}

export function sampledFrameIndexes(frameCount, limit = 40) {
  const count = Math.max(0, Math.floor(frameCount));
  if (!count) return [];
  if (count <= limit) return Array.from({ length: count }, (_, index) => index);
  return Array.from({ length: limit }, (_, index) => Math.round(index * (count - 1) / (limit - 1)));
}

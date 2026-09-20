export const MAX_BYTES = 10 * 1024 * 1024;
export const MAX_ATOMS = 75000;
export const MAX_SURFACE_ATOMS = 15000;
export const WATER_NAMES = new Set(['HOH', 'WAT', 'H2O', 'DOD']);
const formats = { pdb: 'pdb', cif: 'cif', mmcif: 'cif', sdf: 'sdf', mol: 'sdf', xyz: 'xyz', pqr: 'pqr' };

export function validateFile(file) {
  if (!file || typeof file.name !== 'string') throw new Error('Choose a molecular structure file.');
  const extension = file.name.split('.').pop().toLowerCase();
  if (!formats[extension]) throw new Error('Unsupported file. Choose PDB, mmCIF, SDF, MOL, XYZ, or PQR.');
  if (!file.size) throw new Error('This file is empty. Your current structure has been kept.');
  if (file.size > MAX_BYTES) throw new Error('This file is larger than 10 MB. Open a smaller structure.');
  return formats[extension];
}

export function validateText(text, format) {
  if (typeof text !== 'string' || !text.trim()) throw new Error('No structure data was found.');
  if (text.includes('\0')) throw new Error('This appears to be a binary file. Open a supported text structure format.');
  if (new TextEncoder().encode(text).length > MAX_BYTES) throw new Error('This structure exceeds the 10 MB limit.');
  let valid = false;
  if (format === 'pdb' || format === 'pqr') valid = /^(ATOM  |HETATM)/m.test(text);
  if (format === 'cif') valid = /_atom_site\.Cartn_x/i.test(text) && /_atom_site\.Cartn_y/i.test(text) && /_atom_site\.Cartn_z/i.test(text);
  if (format === 'sdf') valid = /V(?:2000|3000)/.test(text) && /M\s+END/.test(text);
  if (format === 'xyz') {
    const lines = text.trim().split(/\r?\n/);
    const count = Number(lines[0].trim());
    valid = /^\d+$/.test(lines[0].trim()) && count > 0 && count <= MAX_ATOMS && lines.length >= count + 2;
    if (valid) valid = lines.slice(2, count + 2).every(line => {
      const columns = line.trim().split(/\s+/);
      return /^[A-Za-z]{1,3}$/.test(columns[0]) && columns.length >= 4 && columns.slice(1, 4).every(n => Number.isFinite(Number(n)));
    });
  }
  if (!valid) throw new Error(`This file does not contain valid ${format.toUpperCase()} structure data. Your current structure has been kept.`);
}

export function summarizeAtoms(atoms) {
  if (!atoms.length) throw new Error('No atoms could be read. Check the file format; your current structure has been kept.');
  if (atoms.length > MAX_ATOMS) throw new Error('This structure exceeds the 75,000 atom limit for this release.');
  if (atoms.some(a => ![a.x, a.y, a.z].every(n => Number.isFinite(n) && Math.abs(n) < 1e7))) throw new Error('The structure contains invalid coordinates. Your current structure has been kept.');
  const chains = new Set();
  const residues = new Set();
  const residueTypes = new Map();
  let hasBackbone = false;
  let waterCount = 0;
  atoms.forEach(a => {
    if (a.chain?.trim()) chains.add(a.chain);
    if (a.resn) {
      const id = JSON.stringify([a.chain || '', a.resi, a.icode || '', a.resn]);
      residues.add(id);
      if (!residueTypes.has(a.resn)) residueTypes.set(a.resn, new Set());
      residueTypes.get(a.resn).add(id);
    }
    if (WATER_NAMES.has(a.resn)) waterCount++;
    if (!a.hetflag && (a.atom === 'CA' || a.atom === 'P')) hasBackbone = true;
  });
  return { atomCount: atoms.length, chainCount: chains.size, residueCount: residues.size, hasBackbone, waterCount, residueTypes: [...residueTypes].sort(([a], [b]) => a.localeCompare(b)).map(([name, ids]) => ({ name, count: ids.size })) };
}

export function visibleSelection(display) {
  const excluded = [...display.hiddenResidues];
  if (!display.water) excluded.push(...WATER_NAMES);
  return excluded.length ? { not: { resn: [...new Set(excluded)] } } : {};
}

export function structureDescription(text, format) {
  if (format === 'pdb') return text.split(/\r?\n/).filter(l => l.startsWith('TITLE ')).map(l => l.slice(10).trim()).join(' ').slice(0, 400);
  return '';
}

export const MAX_BYTES = 10 * 1024 * 1024;
export const MAX_ATOMS = 75000;
export const MAX_WORKSPACE_ATOMS = 120000;
export const MAX_SURFACE_ATOMS = 15000;
export const WATER_NAMES = new Set(['HOH', 'WAT', 'H2O', 'DOD']);
const formats = { pdb: 'pdb', cif: 'cif', mmcif: 'cif', sdf: 'sdf', mol: 'sdf', xyz: 'xyz', pqr: 'pqr' };
const amino = { ALA:'A', ARG:'R', ASN:'N', ASP:'D', CYS:'C', GLN:'Q', GLU:'E', GLY:'G', HIS:'H', ILE:'I', LEU:'L', LYS:'K', MET:'M', PHE:'F', PRO:'P', SER:'S', THR:'T', TRP:'W', TYR:'Y', VAL:'V', SEC:'U', PYL:'O' };
const nucleic = { A:'A', C:'C', G:'G', U:'U', T:'T', DA:'A', DC:'C', DG:'G', DT:'T', DU:'U' };

export function validateFile(file) {
  if (!file || typeof file.name !== 'string') throw new Error('Choose a molecular structure file.');
  const extension = file.name.split('.').pop().toLowerCase();
  if (!formats[extension]) throw new Error('Unsupported file. Choose PDB, mmCIF, SDF, MOL, XYZ, or PQR.');
  if (!file.size) throw new Error('This file is empty. Your current workspace has been kept.');
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
  if (!valid) throw new Error(`This file does not contain valid ${format.toUpperCase()} structure data. Your current workspace has been kept.`);
}

export function residueKey(atom) {
  if (!atom?.resn) return '';
  return JSON.stringify([String(atom.chain || '').trim(), String(atom.resi ?? '').trim(), String(atom.icode || '').trim(), String(atom.resn).trim()]);
}

export function residueSelector(residue) {
  const selector = { chain: String(residue.chain || '').trim(), resi: residue.resi };
  if (residue.icode) selector.icode = residue.icode;
  return selector;
}

export function summarizeAtoms(atoms) {
  if (!atoms.length) throw new Error('No atoms could be read. Check the file format; your current workspace has been kept.');
  if (atoms.length > MAX_ATOMS) throw new Error('This structure exceeds the 75,000 atom limit.');
  if (atoms.some(a => ![a.x, a.y, a.z].every(n => Number.isFinite(n) && Math.abs(n) < 1e7))) throw new Error('The structure contains invalid coordinates. Your current workspace has been kept.');
  const chainMap = new Map();
  const residueMap = new Map();
  const residueTypes = new Map();
  let hasBackbone = false;
  let waterCount = 0;
  let alternateLocationCount = 0;
  let insertionCodeCount = 0;
  atoms.forEach((atom, index) => {
    atom.__workspaceIndex = index;
    const altLoc = String(atom.altLoc || atom.altloc || '').trim();
    if (altLoc) alternateLocationCount++;
    const key = residueKey(atom);
    if (key && !residueMap.has(key)) {
      const water = WATER_NAMES.has(atom.resn);
      const residue = {
        key, chain: String(atom.chain || '').trim(), resi: atom.resi, icode: String(atom.icode || '').trim(), resn: String(atom.resn).trim(),
        hetflag: !!atom.hetflag, water, ligand: !!atom.hetflag && !water, atoms: [],
        symbol: amino[atom.resn] || nucleic[atom.resn] || (atom.hetflag ? '•' : 'X'),
      };
      residueMap.set(key, residue);
      if (residue.icode) insertionCodeCount++;
      if (!residueTypes.has(atom.resn)) residueTypes.set(atom.resn, 0);
      residueTypes.set(atom.resn, residueTypes.get(atom.resn) + 1);
      if (!chainMap.has(residue.chain)) chainMap.set(residue.chain, []);
      chainMap.get(residue.chain).push(residue);
    }
    if (key) residueMap.get(key).atoms.push(atom);
    if (WATER_NAMES.has(atom.resn)) waterCount++;
    if (!atom.hetflag && (atom.atom === 'CA' || atom.atom === 'P')) hasBackbone = true;
  });
  const sortResidues = list => list.sort((a, b) => Number(a.resi) - Number(b.resi) || String(a.icode).localeCompare(String(b.icode)));
  const chains = [...chainMap].map(([id, residues]) => ({ id, label: id || 'Unassigned', residues: sortResidues(residues) })).sort((a, b) => a.label.localeCompare(b.label));
  const residues = [...residueMap.values()];
  return {
    atomCount: atoms.length,
    chainCount: [...new Set(atoms.map(a => String(a.chain || '').trim()).filter(Boolean))].length,
    residueCount: residues.length,
    hasBackbone,
    waterCount,
    ligandCount: residues.filter(r => r.ligand).length,
    alternateLocationCount,
    insertionCodeCount,
    chains,
    residues,
    ligands: residues.filter(r => r.ligand),
    residueTypes: [...residueTypes].sort(([a], [b]) => a.localeCompare(b)).map(([name, count]) => ({ name, count })),
  };
}

export function visibleSelection(display) {
  const excluded = [...display.hiddenResidues];
  if (!display.water) excluded.push(...WATER_NAMES);
  const conditions = [];
  if (excluded.length) conditions.push({ not: { resn: [...new Set(excluded)] } });
  if (display.ligands === false) conditions.push({ or: [{ hetflag: false }, { resn: [...WATER_NAMES] }] });
  if (!conditions.length) return {};
  return conditions.length === 1 ? conditions[0] : { and: conditions };
}

export function neighboringResidues(atoms, selectedKey, cutoff = 4) {
  const selected = atoms.filter(atom => residueKey(atom) === selectedKey);
  if (!selected.length || !(cutoff > 0)) return [];
  const limit = cutoff * cutoff;
  const neighbors = new Set();
  for (const atom of atoms) {
    const key = residueKey(atom);
    if (!key || key === selectedKey || WATER_NAMES.has(atom.resn)) continue;
    if (selected.some(origin => {
      const dx = atom.x - origin.x; const dy = atom.y - origin.y; const dz = atom.z - origin.z;
      return dx * dx + dy * dy + dz * dz <= limit;
    })) neighbors.add(key);
  }
  return [...neighbors];
}

export function structureDescription(text, format) {
  if (format === 'pdb') return text.split(/\r?\n/).filter(line => line.startsWith('TITLE ')).map(line => line.slice(10).trim()).join(' ').slice(0, 400);
  if (format === 'cif') return text.match(/_struct\.title\s+(?:'([^']+)'|"([^"]+)"|([^\r\n]+))/i)?.slice(1).find(Boolean)?.trim().slice(0, 400) || '';
  return '';
}

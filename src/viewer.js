import * as Mol from '3dmol';
import { summarizeAtoms, visibleSelection, residueSelector } from './structures.js';

const chainColors = [0x70c9bd, 0xf0bd79, 0xa499d9, 0x81b6da, 0xea9c9f, 0xb5cc86];
const solidColors = { teal: 0x36b5a3, amber: 0xe5a64b, violet: 0x9b8be2, rose: 0xe08a9b };

function combine(base, extra) {
  if (!extra || !Object.keys(extra).length) return base;
  if (!base || !Object.keys(base).length) return extra;
  return { and: [base, extra] };
}

function selectorsForResidues(summary, keys) {
  const wanted = new Set(keys || []);
  return summary.residues.filter(residue => wanted.has(residue.key)).map(residueSelector);
}

export class MolecularViewer {
  constructor(element, onSurfaceError, onAtomClick) {
    this.view = Mol.createViewer(element, { backgroundColor: '#111e25', antialias: true });
    this.models = new Map();
    this.revision = 0;
    this.onSurfaceError = onSurfaceError;
    this.onAtomClick = onAtomClick;
    this.view.render();
    let scheduled = false;
    this.observer = new ResizeObserver(() => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => { scheduled = false; if (element.clientWidth && element.clientHeight) this.view.resize(); });
    });
    this.observer.observe(element);
  }

  prepare(text, format) {
    let candidate;
    try {
      candidate = this.view.addModel(text, format, { keepH: true, multimodel: false });
      const atoms = candidate.selectedAtoms({});
      const summary = summarizeAtoms(atoms);
      return { model: candidate, atoms, summary };
    } catch (error) {
      if (candidate) this.view.removeModel(candidate);
      throw error;
    }
  }

  add(id, prepared) {
    this.models.set(id, prepared);
    prepared.model.setClickable({}, true, atom => this.onAtomClick?.(id, atom));
  }

  discard(prepared) {
    if (prepared?.model) this.view.removeModel(prepared.model);
  }

  remove(id) {
    const entry = this.models.get(id);
    if (!entry) return;
    this.view.removeModel(entry.model);
    this.models.delete(id);
    this.apply([]);
  }

  clear() {
    this.stop();
    this.revision++;
    this.view.clear();
    this.models.clear();
    this.view.render();
  }

  apply(objects, selection = null) {
    const version = ++this.revision;
    this.view.removeAllSurfaces();
    this.view.removeAllLabels();
    for (const object of objects) {
      const entry = this.models.get(object.id);
      if (!entry) continue;
      const { model, summary } = entry;
      const display = object.history.value;
      model.setStyle({}, {});
      if (!display.visible) continue;
      let visible = visibleSelection(display);
      if (display.isolateKeys?.length) visible = combine(visible, { or: selectorsForResidues(summary, display.isolateKeys) });
      const chains = [...new Set(entry.atoms.map(atom => atom.chain || ''))];
      const chainColor = atom => chainColors[Math.max(0, chains.indexOf(atom.chain || '')) % chainColors.length];
      const maxResidue = entry.atoms.reduce((max, atom) => Math.max(max, Number(atom.resi) || 1), 2);
      const color = display.color === 'chain'
        ? { colorfunc: chainColor }
        : display.color === 'spectrum'
          ? { colorscheme: { prop: 'resi', gradient: 'sinebow', min: 1, max: maxResidue } }
          : solidColors[display.color]
            ? { color: solidColors[display.color] }
            : { colorscheme: 'Jmol' };
      const alpha = display.opacity;
      const cartoon = { ...color, thickness: .35, opacity: alpha };
      const styles = {
        cartoon: { cartoon },
        ribbon: { cartoon: { ...cartoon, ribbon: true, thickness: .15 } },
        sticks: { stick: { ...color, radius: .18, opacity: alpha } },
        ballstick: { stick: { ...color, radius: .14, opacity: alpha }, sphere: { ...color, scale: .28, opacity: alpha } },
        spheres: { sphere: { ...color, opacity: alpha } },
        surface: { stick: { ...color, radius: .12, opacity: alpha } },
      };
      model.setStyle(visible, styles[display.style]);
      if (display.style === 'cartoon' || display.style === 'ribbon') {
        model.setStyle(combine(visible, { hetflag: true }), { stick: { ...color, radius: .15, opacity: alpha }, sphere: { ...color, scale: .25, opacity: alpha } });
      }
      if (display.style === 'surface' && model.selectedAtoms(visible).length) {
        const scoped = combine(visible, { model });
        const surface = this.view.addSurface(Mol.SurfaceType.VDW, { ...color, opacity: alpha }, scoped, scoped);
        Promise.resolve(surface).then(() => {
          if (version === this.revision) this.view.render();
        }).catch(() => {
          if (version === this.revision) this.onSurfaceError('A surface could not be generated. Its bond representation is still available.');
        });
      }
      if (display.labels) {
        const labelled = new Set();
        for (const atom of model.selectedAtoms(visible)) {
          if (!atom.resn || labelled.size >= 30) continue;
          const key = JSON.stringify([atom.chain, atom.resi, atom.icode, atom.resn]);
          if (labelled.has(key)) continue;
          labelled.add(key);
          this.view.addLabel(`${atom.resn} ${atom.resi}${atom.icode || ''}${atom.chain ? ` · ${atom.chain}` : ''}`, {
            position: atom, fontSize: 11, fontColor: '#e5f3ef', backgroundColor: '#16342f',
            backgroundOpacity: .85, borderRadius: 3, inFront: true,
          });
        }
      }
      if (selection?.objectId === object.id) {
        const primary = selectorsForResidues(summary, selection.primaryKeys);
        const secondary = selectorsForResidues(summary, selection.secondaryKeys);
        if (selection.chain !== undefined && selection.chain !== null) primary.push({ chain: selection.chain });
        if (selection.atomSelector) primary.push(selection.atomSelector);
        if (secondary.length) model.setStyle({ or: secondary.map(item => combine(visible, item)) }, { stick: { color: 0x4dd7c0, radius: .2 }, sphere: { color: 0x4dd7c0, scale: .25 } }, true);
        if (primary.length) model.setStyle({ or: primary.map(item => combine(visible, item)) }, { stick: { color: 0xffc857, radius: .25 }, sphere: { color: 0xffc857, scale: .34 } }, true);
      }
    }
    this.view.render();
  }

  fit(id) {
    const entry = id ? this.models.get(id) : null;
    if (entry) this.view.zoomTo({ model: entry.model });
    else if (this.models.size) this.view.zoomTo();
    this.view.render();
  }

  zoom(factor) { this.view.zoom(factor); this.view.render(); }
  pan(x, y) { this.view.translate(x, y); this.view.render(); }
  spin(enabled) { this.view.spin(enabled ? 'y' : false, .6); }
  stop() { this.view.spin(false); }
}

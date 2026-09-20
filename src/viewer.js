import * as Mol from '3dmol';
import { summarizeAtoms, visibleSelection } from './structures.js';

const chainColors = [0x70c9bd, 0xf0bd79, 0xa499d9, 0x81b6da, 0xea9c9f, 0xb5cc86];

export class MolecularViewer {
  constructor(element, onSurfaceError) {
    this.view = Mol.createViewer(element, { backgroundColor: '#111e25', antialias: true });
    this.model = null;
    this.revision = 0;
    this.onSurfaceError = onSurfaceError;
    this.view.render();
    let scheduled = false;
    this.observer = new ResizeObserver(() => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => { scheduled = false; if (element.clientWidth && element.clientHeight) this.view.resize(); });
    });
    this.observer.observe(element);
  }

  // Parse into a staged model. A failed upload never clears the current model.
  prepare(text, format) {
    let candidate;
    try {
      candidate = this.view.addModel(text, format, { keepH: true, multimodel: false });
      const summary = summarizeAtoms(candidate.selectedAtoms({}));
      return { model: candidate, summary };
    } catch (error) {
      if (candidate) this.view.removeModel(candidate);
      throw error;
    }
  }

  replace(prepared) {
    this.stop();
    this.revision++;
    this.view.removeAllSurfaces();
    this.view.removeAllLabels();
    if (this.model) this.view.removeModel(this.model);
    this.model = prepared.model;
    this.summary = prepared.summary;
  }

  clear() {
    this.stop(); this.revision++;
    this.view.clear(); this.model = null; this.summary = null;
    this.view.render();
  }

  apply(display) {
    if (!this.model) return;
    const version = ++this.revision;
    this.view.removeAllSurfaces();
    this.view.removeAllLabels();
    this.model.setStyle({}, {});
    if (!display.visible) { this.view.render(); return; }
    const selection = visibleSelection(display);
    const chains = [...new Set(this.model.selectedAtoms({}).map(a => a.chain || ''))];
    const chainColor = a => chainColors[Math.max(0, chains.indexOf(a.chain || '')) % chainColors.length];
    const maxResidue = this.model.selectedAtoms({}).reduce((max, a) => Math.max(max, Number(a.resi) || 1), 2);
    const color = display.color === 'chain' ? { colorfunc: chainColor } : display.color === 'spectrum' ? { colorscheme: { prop: 'resi', gradient: 'sinebow', min: 1, max: maxResidue } } : { colorscheme: 'Jmol' };
    const cartoon = { ...color, thickness: .35, opacity: 1 };
    const styles = {
      cartoon: { cartoon }, ribbon: { cartoon: { ...cartoon, ribbon: true, thickness: .15 } },
      sticks: { stick: { ...color, radius: .18 } },
      ballstick: { stick: { ...color, radius: .14 }, sphere: { ...color, scale: .28 } },
      spheres: { sphere: { ...color } }, surface: { stick: { ...color, radius: .12 } },
    };
    this.model.setStyle(selection, styles[display.style]);
    if (display.style === 'cartoon' || display.style === 'ribbon') {
      this.model.setStyle({ and: [selection, { hetflag: true }] }, { stick: { ...color, radius: .15 }, sphere: { ...color, scale: .25 } });
    }
    if (display.style === 'surface' && this.model.selectedAtoms(selection).length) {
      const surface = this.view.addSurface(Mol.SurfaceType.VDW, { ...color, opacity: display.opacity }, selection, selection);
      Promise.resolve(surface).then(() => {
        if (version === this.revision) this.view.render();
      }).catch(() => {
        if (version === this.revision) {
          this.view.removeAllSurfaces();
          this.onSurfaceError('The surface could not be generated. The bond representation is still available.');
        }
      });
    }
    if (display.labels) {
      const labelled = new Set();
      for (const atom of this.model.selectedAtoms(selection)) {
        if (!atom.resn || labelled.size >= 20) continue;
        const key = JSON.stringify([atom.chain, atom.resi, atom.icode, atom.resn]);
        if (labelled.has(key)) continue;
        labelled.add(key);
        this.view.addLabel(`${atom.resn} ${atom.resi}${atom.icode || ''}${atom.chain ? ` · ${atom.chain}` : ''}`, { position: atom, fontSize: 11, fontColor: '#e5f3ef', backgroundColor: '#16342f', backgroundOpacity: .85, borderRadius: 3, inFront: true });
      }
    }
    this.view.render();
  }

  fit() { if (this.model) { this.view.zoomTo({ model: this.model }); this.view.render(); } }
  zoom(factor) { this.view.zoom(factor); this.view.render(); }
  pan(x, y) { this.view.translate(x, y); this.view.render(); }
  spin(enabled) { this.view.spin(enabled ? 'y' : false, .6); }
  stop() { this.view.spin(false); }
}

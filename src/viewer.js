import * as Mol from '3dmol';
import { summarizeAtoms, visibleSelection, residueSelector } from './structures.js';
import { applyTransform, formatMeasurement, measurementValue } from './analysis.js';
import { MAX_TRAJECTORY_FRAMES } from './advanced.js';

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
    this.densityData = new Map();
    this.densityShapes = [];
    this.measurementShapes = [];
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
      candidate = this.view.addModelsAsFrames(text, format, { keepH: true });
      const frameCount = Math.max(1, candidate.getNumFrames());
      if (frameCount > MAX_TRAJECTORY_FRAMES) throw new Error(`Trajectories are limited to ${MAX_TRAJECTORY_FRAMES} frames in the browser.`);
      const atoms = candidate.selectedAtoms({});
      const summary = summarizeAtoms(atoms);
      const frames = Array.isArray(candidate.frames) ? candidate.frames : [];
      if (frames.some(frame => Array.isArray(frame) && frame.length !== atoms.length)) throw new Error('Every trajectory frame must contain the same number of atoms.');
      return { model: candidate, atoms, summary, frameCount };
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
    this.densityData.clear();
    this.densityShapes = [];
    this.measurementShapes = [];
    this.view.render();
  }

  apply(objects, selection = null, measurements = [], measurementDraft = []) {
    const version = ++this.revision;
    this.view.removeAllSurfaces();
    this.view.removeAllLabels();
    for (const shape of this.measurementShapes) this.view.removeShape(shape);
    this.measurementShapes = [];
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
    this.drawMeasurements(objects, measurements, measurementDraft);
    this.view.render();
  }

  resolvePoint(objects, descriptor) {
    const object = objects.find(item => item.id === descriptor.objectId);
    const entry = this.models.get(descriptor.objectId);
    if (!object || !entry) return null;
    const atom = entry.atoms.find(item => item.__workspaceIndex === descriptor.atomIndex);
    return atom ? { object, atom } : null;
  }

  drawMeasurements(objects, measurements, draft) {
    const addShape = shape => { this.measurementShapes.push(shape); return shape; };
    const drawPoint = (point, color, radius = .22) => addShape(this.view.addSphere({ center: point, radius, color }));
    for (const measurement of measurements) {
      const resolved = measurement.points.map(point => this.resolvePoint(objects, point));
      if (resolved.some(point => !point)) continue;
      const points = resolved.map(item => item.atom);
      const color = 0xffc857;
      for (let index = 1; index < points.length; index++) {
        addShape(this.view.addLine({ start: points[index - 1], end: points[index], color, dashed: true, dashLength: .35, gapLength: .18 }));
      }
      points.forEach(point => drawPoint(point, color));
      try {
        const value = measurementValue(measurement.type, points);
        const center = points.reduce((sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y, z: sum.z + point.z }), { x: 0, y: 0, z: 0 });
        center.x /= points.length; center.y /= points.length; center.z /= points.length;
        this.view.addLabel(formatMeasurement(measurement.type, value), {
          position: center, fontSize: 12, fontColor: '#182126', backgroundColor: '#ffc857',
          backgroundOpacity: .94, borderRadius: 3, inFront: true,
        });
      } catch { /* An invalidated measurement stays out of the viewport. */ }
    }
    for (const descriptor of draft) {
      const resolved = this.resolvePoint(objects, descriptor);
      if (resolved) drawPoint(resolved.atom, 0x4dd7c0, .3);
    }
  }

  setCoordinates(id, coordinates) {
    const entry = this.models.get(id);
    if (!entry || coordinates.length !== entry.atoms.length) throw new Error('The object coordinates could not be updated.');
    entry.model.setCoordinates([coordinates.map(point => [point.x, point.y, point.z])], 'array');
    entry.model.setFrame(0);
    const atoms = entry.model.selectedAtoms({});
    const summary = summarizeAtoms(atoms);
    entry.atoms = atoms;
    entry.summary = summary;
    return { atoms, summary };
  }

  transform(id, transform) {
    const entry = this.models.get(id);
    if (!entry) throw new Error('Choose a valid moving object.');
    return this.setCoordinates(id, entry.atoms.map(atom => applyTransform(atom, transform)));
  }

  async setFrame(id, frame) {
    const entry = this.models.get(id);
    if (!entry) throw new Error('Choose a valid trajectory object.');
    const count = Math.max(1, entry.model.getNumFrames());
    const index = Math.max(0, Math.min(count - 1, Math.floor(frame)));
    await entry.model.setFrame(index);
    const atoms = entry.model.selectedAtoms({});
    const summary = summarizeAtoms(atoms);
    entry.atoms = atoms;
    entry.summary = summary;
    entry.model.setClickable({}, true, atom => this.onAtomClick?.(id, atom));
    return { atoms, summary, frame: index, frameCount: count };
  }

  loadDensity(id, text, format) {
    this.densityData.set(id, new Mol.VolumeData(text, format));
  }

  removeDensity(id) {
    this.densityData.delete(id);
  }

  renderDensityMaps(maps) {
    for (const shape of this.densityShapes) this.view.removeShape(shape);
    this.densityShapes = [];
    for (const map of maps) {
      const data = this.densityData.get(map.id);
      if (!data || !map.visible) continue;
      const common = { opacity: map.opacity, wireframe: map.wireframe, smoothness: 2 };
      this.densityShapes.push(this.view.addIsosurface(data, { ...common, isoval: Math.abs(map.isovalue), color: map.color }));
      if (map.negative) this.densityShapes.push(this.view.addIsosurface(data, { ...common, isoval: -Math.abs(map.isovalue), color: map.negativeColor }));
    }
    this.view.render();
  }

  getView() { return this.view.getView().slice(0, 8); }
  setView(value) { this.view.setView(value); }
  rotate(degrees, axis = 'y') { this.view.rotate(degrees, axis); }
  imageURI() { return this.view.pngURI(); }

  animateView(target, duration = 700) {
    const start = this.getView();
    const destination = target.slice(0, 8);
    const started = performance.now();
    return new Promise(resolve => {
      const step = now => {
        const raw = Math.min(1, (now - started) / duration);
        const amount = raw < .5 ? 2 * raw * raw : 1 - ((-2 * raw + 2) ** 2) / 2;
        const view = start.map((value, index) => value + (destination[index] - value) * amount);
        const length = Math.hypot(...view.slice(4, 8)) || 1;
        for (let index = 4; index < 8; index++) view[index] /= length;
        this.setView(view);
        if (raw < 1) requestAnimationFrame(step); else resolve();
      };
      requestAnimationFrame(step);
    });
  }

  async turntableURI(frames = 24) {
    const start = this.getView();
    const capture = this.view.apngURI(frames);
    for (let index = 0; index < frames; index++) {
      this.rotate(360 / frames, 'y');
      await new Promise(resolve => requestAnimationFrame(resolve));
    }
    const uri = await capture;
    this.setView(start);
    return uri;
  }

  async trajectoryURI(id, indexes, startFrame = 0) {
    const entry = this.models.get(id);
    if (!entry || !indexes.length) throw new Error('The active object has no trajectory frames.');
    const capture = this.view.apngURI(indexes.length);
    for (const index of indexes) {
      await entry.model.setFrame(index);
      this.view.render();
      await new Promise(resolve => requestAnimationFrame(resolve));
    }
    const uri = await capture;
    await entry.model.setFrame(startFrame);
    this.view.render();
    return uri;
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

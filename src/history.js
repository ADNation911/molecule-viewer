// Display history is independent of camera motion and reset on structure changes.
export class DisplayHistory {
  constructor(initial, limit = 60) { this.limit = limit; this.reset(initial); }
  reset(value) { this.past = []; this.future = []; this.present = structuredClone(value); }
  get value() { return structuredClone(this.present); }
  get canUndo() { return this.past.length > 0; }
  get canRedo() { return this.future.length > 0; }
  commit(next) {
    if (JSON.stringify(next) === JSON.stringify(this.present)) return false;
    this.past.push(this.value);
    if (this.past.length > this.limit) this.past.shift();
    this.present = structuredClone(next);
    this.future = [];
    return true;
  }
  undo() {
    if (!this.canUndo) return false;
    this.future.push(this.value);
    this.present = this.past.pop();
    return true;
  }
  redo() {
    if (!this.canRedo) return false;
    this.past.push(this.value);
    this.present = this.future.pop();
    return true;
  }
}

export function defaultDisplay(hasBackbone = true) {
  return { style: hasBackbone ? 'cartoon' : 'ballstick', color: hasBackbone ? 'chain' : 'element', visible: true, water: true, labels: false, opacity: .8, hiddenResidues: [] };
}

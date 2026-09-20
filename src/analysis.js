const EPSILON = 1e-10;

const coordinates = point => ({ x: Number(point.x), y: Number(point.y), z: Number(point.z) });
const subtract = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a, b) => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
const magnitude = vector => Math.hypot(vector.x, vector.y, vector.z);
const scale = (vector, value) => ({ x: vector.x * value, y: vector.y * value, z: vector.z * value });

export function distanceBetween(first, second) {
  return magnitude(subtract(coordinates(first), coordinates(second)));
}

export function angleBetween(first, vertex, last) {
  const left = subtract(coordinates(first), coordinates(vertex));
  const right = subtract(coordinates(last), coordinates(vertex));
  const denominator = magnitude(left) * magnitude(right);
  if (denominator < EPSILON) throw new Error('An angle needs three distinct atom positions.');
  const cosine = Math.max(-1, Math.min(1, dot(left, right) / denominator));
  return Math.acos(cosine) * 180 / Math.PI;
}

export function dihedralBetween(first, second, third, fourth) {
  const b0 = subtract(coordinates(second), coordinates(first));
  const b1 = subtract(coordinates(third), coordinates(second));
  const b2 = subtract(coordinates(fourth), coordinates(third));
  const b1Length = magnitude(b1);
  if (b1Length < EPSILON) throw new Error('A dihedral needs four distinct atom positions.');
  const axis = scale(b1, 1 / b1Length);
  const v = subtract(b0, scale(axis, dot(b0, axis)));
  const w = subtract(b2, scale(axis, dot(b2, axis)));
  if (magnitude(v) < EPSILON || magnitude(w) < EPSILON) throw new Error('The selected atoms do not define a stable dihedral.');
  return Math.atan2(dot(cross(axis, v), w), dot(v, w)) * 180 / Math.PI;
}

export function measurementValue(type, points) {
  if (type === 'distance' && points.length === 2) return distanceBetween(...points);
  if (type === 'angle' && points.length === 3) return angleBetween(...points);
  if (type === 'dihedral' && points.length === 4) return dihedralBetween(...points);
  throw new Error(`A ${type} measurement has the wrong number of atoms.`);
}

export function formatMeasurement(type, value) {
  return type === 'distance' ? `${value.toFixed(2)} Å` : `${value.toFixed(1)}°`;
}

function anchorAtom(residue) {
  const atoms = residue.atoms || [];
  const named = name => atoms.find(atom => String(atom.atom || '').trim().toUpperCase() === name);
  return named('CA') || named('P') || named("C4'") || named('C4*') || null;
}

function polymerResidues(chain) {
  return (chain?.residues || []).filter(residue => !residue.hetflag && anchorAtom(residue));
}

export function alignSequences(first, second) {
  const rows = first.length + 1;
  const columns = second.length + 1;
  const scores = Array.from({ length: rows }, () => new Int32Array(columns));
  const trace = Array.from({ length: rows }, () => new Uint8Array(columns));
  for (let row = 1; row < rows; row++) { scores[row][0] = -2 * row; trace[row][0] = 1; }
  for (let column = 1; column < columns; column++) { scores[0][column] = -2 * column; trace[0][column] = 2; }
  for (let row = 1; row < rows; row++) {
    for (let column = 1; column < columns; column++) {
      const diagonal = scores[row - 1][column - 1] + (first[row - 1] === second[column - 1] ? 2 : -1);
      const up = scores[row - 1][column] - 2;
      const left = scores[row][column - 1] - 2;
      if (diagonal >= up && diagonal >= left) { scores[row][column] = diagonal; trace[row][column] = 0; }
      else if (up >= left) { scores[row][column] = up; trace[row][column] = 1; }
      else { scores[row][column] = left; trace[row][column] = 2; }
    }
  }
  const pairs = [];
  let row = first.length;
  let column = second.length;
  while (row || column) {
    const direction = trace[row][column];
    if (row && column && direction === 0) { pairs.push([row - 1, column - 1]); row--; column--; }
    else if (row && (direction === 1 || !column)) row--;
    else column--;
  }
  return { pairs: pairs.reverse(), score: scores[first.length][second.length] };
}

export function matchBackboneAtoms(movingSummary, referenceSummary, movingChainId = '', referenceChainId = '') {
  const movingChains = (movingSummary?.chains || []).filter(chain => !movingChainId || chain.id === movingChainId);
  const referenceChains = (referenceSummary?.chains || []).filter(chain => !referenceChainId || chain.id === referenceChainId);
  let best = null;
  for (const movingChain of movingChains) {
    const movingResidues = polymerResidues(movingChain);
    if (movingResidues.length < 3) continue;
    for (const referenceChain of referenceChains) {
      const referenceResidues = polymerResidues(referenceChain);
      if (referenceResidues.length < 3) continue;
      const alignment = alignSequences(movingResidues.map(item => item.symbol), referenceResidues.map(item => item.symbol));
      const identical = alignment.pairs.filter(([left, right]) => movingResidues[left].symbol === referenceResidues[right].symbol);
      if (identical.length < 3) continue;
      const candidate = {
        movingChain: movingChain.id,
        referenceChain: referenceChain.id,
        identity: identical.length / alignment.pairs.length,
        pairs: identical.map(([left, right]) => ({
          moving: anchorAtom(movingResidues[left]),
          reference: anchorAtom(referenceResidues[right]),
        })),
        score: alignment.score,
      };
      if (!best || candidate.pairs.length > best.pairs.length || (candidate.pairs.length === best.pairs.length && candidate.score > best.score)) best = candidate;
    }
  }
  if (!best) throw new Error('No compatible backbone chains with at least three matching Cα/P atoms were found.');
  return best;
}

function centroid(points) {
  const sum = points.reduce((result, point) => ({ x: result.x + point.x, y: result.y + point.y, z: result.z + point.z }), { x: 0, y: 0, z: 0 });
  return scale(sum, 1 / points.length);
}

function largestEigenvector(matrix) {
  const values = matrix.map(row => [...row]);
  const vectors = Array.from({ length: 4 }, (_, row) => Array.from({ length: 4 }, (_, column) => Number(row === column)));
  for (let iteration = 0; iteration < 80; iteration++) {
    let p = 0;
    let q = 1;
    let largest = 0;
    for (let row = 0; row < 4; row++) for (let column = row + 1; column < 4; column++) {
      if (Math.abs(values[row][column]) > largest) { largest = Math.abs(values[row][column]); p = row; q = column; }
    }
    if (largest < 1e-12) break;
    const angle = .5 * Math.atan2(2 * values[p][q], values[q][q] - values[p][p]);
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    for (let index = 0; index < 4; index++) {
      if (index === p || index === q) continue;
      const aip = values[index][p];
      const aiq = values[index][q];
      values[index][p] = values[p][index] = cosine * aip - sine * aiq;
      values[index][q] = values[q][index] = sine * aip + cosine * aiq;
    }
    const app = values[p][p];
    const aqq = values[q][q];
    const apq = values[p][q];
    values[p][p] = cosine * cosine * app - 2 * sine * cosine * apq + sine * sine * aqq;
    values[q][q] = sine * sine * app + 2 * sine * cosine * apq + cosine * cosine * aqq;
    values[p][q] = values[q][p] = 0;
    for (let row = 0; row < 4; row++) {
      const vip = vectors[row][p];
      const viq = vectors[row][q];
      vectors[row][p] = cosine * vip - sine * viq;
      vectors[row][q] = sine * vip + cosine * viq;
    }
  }
  let index = 0;
  for (let candidate = 1; candidate < 4; candidate++) if (values[candidate][candidate] > values[index][index]) index = candidate;
  const result = vectors.map(row => row[index]);
  const length = Math.hypot(...result);
  return result.map(value => value / length);
}

function rotationFromQuaternion([w, x, y, z]) {
  return [
    [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
    [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
    [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
  ];
}

export function applyTransform(point, transform) {
  const source = coordinates(point);
  const [first, second, third] = transform.rotation;
  const rowDot = row => row[0] * source.x + row[1] * source.y + row[2] * source.z;
  return {
    x: rowDot(first) + transform.translation.x,
    y: rowDot(second) + transform.translation.y,
    z: rowDot(third) + transform.translation.z,
  };
}

export function rigidSuperposition(moving, reference) {
  if (moving.length !== reference.length || moving.length < 3) throw new Error('Alignment needs at least three paired atom positions.');
  const source = moving.map(coordinates);
  const target = reference.map(coordinates);
  const sourceCenter = centroid(source);
  const targetCenter = centroid(target);
  const covariance = Array.from({ length: 3 }, () => [0, 0, 0]);
  for (let index = 0; index < source.length; index++) {
    const left = subtract(source[index], sourceCenter);
    const right = subtract(target[index], targetCenter);
    covariance[0][0] += left.x * right.x; covariance[0][1] += left.x * right.y; covariance[0][2] += left.x * right.z;
    covariance[1][0] += left.y * right.x; covariance[1][1] += left.y * right.y; covariance[1][2] += left.y * right.z;
    covariance[2][0] += left.z * right.x; covariance[2][1] += left.z * right.y; covariance[2][2] += left.z * right.z;
  }
  const [[sxx, sxy, sxz], [syx, syy, syz], [szx, szy, szz]] = covariance;
  const quaternion = largestEigenvector([
    [sxx + syy + szz, syz - szy, szx - sxz, sxy - syx],
    [syz - szy, sxx - syy - szz, sxy + syx, szx + sxz],
    [szx - sxz, sxy + syx, -sxx + syy - szz, syz + szy],
    [sxy - syx, szx + sxz, syz + szy, -sxx - syy + szz],
  ]);
  const rotation = rotationFromQuaternion(quaternion);
  const rotatedCenter = applyTransform(sourceCenter, { rotation, translation: { x: 0, y: 0, z: 0 } });
  const translation = subtract(targetCenter, rotatedCenter);
  const transform = { rotation, translation };
  const squared = source.reduce((sum, point, index) => {
    const delta = subtract(applyTransform(point, transform), target[index]);
    return sum + dot(delta, delta);
  }, 0);
  return { ...transform, rmsd: Math.sqrt(squared / source.length) };
}

export function refinedSuperposition(pairs, cutoff = 2, cycles = 5) {
  if (pairs.length < 3) throw new Error('Alignment needs at least three paired backbone atoms.');
  let retained = [...pairs];
  let transform;
  for (let cycle = 0; cycle <= cycles; cycle++) {
    transform = rigidSuperposition(retained.map(pair => pair.moving), retained.map(pair => pair.reference));
    if (cycle === cycles || retained.length <= 3) break;
    const residuals = retained.map(pair => distanceBetween(applyTransform(pair.moving, transform), pair.reference));
    const worst = residuals.indexOf(Math.max(...residuals));
    if (residuals[worst] <= cutoff) break;
    retained.splice(worst, 1);
  }
  return { ...transform, matchedCount: retained.length, rejectedCount: pairs.length - retained.length };
}

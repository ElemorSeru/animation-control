import { ANALYSIS_EDGE, DEFAULTS } from "./constants.js";

const MOTION_FLOOR = 0.35;
const MAX_OVERLAP = 0.4;
const MAX_LENGTH_RATIO = 0.85;

export function makeSignatureExtractor(edge = ANALYSIS_EDGE) {
  const canvas = document.createElement("canvas");
  canvas.width = edge;
  canvas.height = edge;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  return function extract(source) {
    ctx.clearRect(0, 0, edge, edge);
    ctx.drawImage(source, 0, 0, edge, edge);
    const { data } = ctx.getImageData(0, 0, edge, edge);
    const signature = new Uint8Array(edge * edge);
    for ( let i = 0, p = 0; i < data.length; i += 4, p++ ) {
      const alpha = data[i + 3] / 255;
      const luma = (0.299 * data[i]) + (0.587 * data[i + 1]) + (0.114 * data[i + 2]);
      signature[p] = Math.round(luma * alpha);
    }
    return signature;
  };
}

export function frameDistance(a, b) {
  if ( !a || !b || a.length !== b.length ) return 1;
  let total = 0;
  for ( let i = 0; i < a.length; i++ ) {
    const diff = a[i] - b[i];
    total += diff * diff;
  }
  return Math.sqrt(total / a.length) / 255;
}

export function buildDistanceMatrix(signatures) {
  const n = signatures.length;
  const matrix = new Float32Array(n * n);
  for ( let i = 0; i < n; i++ ) {
    for ( let j = i + 1; j < n; j++ ) {
      const d = frameDistance(signatures[i], signatures[j]);
      matrix[(i * n) + j] = d;
      matrix[(j * n) + i] = d;
    }
  }
  return matrix;
}

export function referenceStep(matrix, n) {
  if ( n < 2 ) return 1;
  const steps = [];
  for ( let i = 0; i < n - 1; i++ ) steps.push(matrix[(i * n) + i + 1]);
  steps.sort((a, b) => a - b);
  const median = steps[Math.floor(steps.length / 2)];
  return median > 0 ? median : 0.0001;
}

function costToScore(cost, reference) {
  const ratio = cost / (reference * 2);
  return Math.max(0, Math.min(1, 1 - ratio));
}

export function buildSeamCache(signatures) {
  const n = signatures.length;
  const matrix = buildDistanceMatrix(signatures);
  return { matrix, reference: referenceStep(matrix, n), n };
}

export function seamScore(signatures, startIndex, endIndex, cache = null) {
  const n = signatures.length;
  if ( n < 2 ) return null;
  const start = clampIndex(startIndex, n);
  const end = clampIndex(endIndex, n);
  if ( end <= start ) return null;

  const reference = (cache?.n === n)
    ? cache.reference
    : referenceStep(buildDistanceMatrix(signatures), n);
  const successor = Math.min(end + 1, n - 1);
  const cost = frameDistance(signatures[successor], signatures[start]);
  return { cost, score: costToScore(cost, reference) };
}

function clampIndex(value, n) {
  const index = Math.round(Number(value) || 0);
  return Math.max(0, Math.min(index, n - 1));
}

export function segmentMotion(matrix, n, start, end) {
  let total = 0;
  let steps = 0;
  for ( let i = start; i < end; i++ ) {
    total += matrix[(i * n) + i + 1];
    steps++;
  }
  return steps ? total / steps : 0;
}

function overlapRatio(a, b) {
  const low = Math.max(a.start, b.start);
  const high = Math.min(a.end, b.end);
  const shared = Math.max(0, high - low + 1);
  return shared / Math.max(1, Math.min(a.length, b.length));
}

function pick(candidates, limit, maxOverlap) {
  const chosen = [];
  for ( const candidate of candidates ) {
    if ( chosen.length >= limit ) break;
    if ( chosen.some(c => overlapRatio(c, candidate) > maxOverlap) ) continue;
    chosen.push(candidate);
  }
  return chosen;
}

export function findLoops(signatures, {
  minFrames = DEFAULTS.minLoopFrames,
  limit = 5,
  cache = null,
  motionFloor = MOTION_FLOOR,
  maxOverlap = MAX_OVERLAP,
  maxLengthRatio = MAX_LENGTH_RATIO
} = {}) {
  const n = signatures.length;
  if ( n < minFrames + 2 ) return [];

  const matrix = (cache?.n === n) ? cache.matrix : buildDistanceMatrix(signatures);
  const reference = (cache?.n === n) ? cache.reference : referenceStep(matrix, n);
  const all = [];
  const lively = [];

  for ( let start = 0; start < n - minFrames; start++ ) {
    for ( let end = start + minFrames; end < n; end++ ) {
      const successor = Math.min(end + 1, n - 1);
      const cost = matrix[(successor * n) + start];
      const length = end - start + 1;
      const lengthBias = 1 - (0.25 * (length / n));
      if ( length > n * maxLengthRatio ) continue;
      const motion = segmentMotion(matrix, n, start, end);
      const candidate = { start, end, cost, weighted: cost * lengthBias, length, motion };
      all.push(candidate);
      if ( motion >= reference * motionFloor ) lively.push(candidate);
    }
  }

  const pool = lively.length ? lively : all;
  pool.sort((a, b) => a.weighted - b.weighted);

  return pick(pool, limit, maxOverlap).map(c => ({
    start: c.start,
    end: c.end,
    length: c.length,
    cost: c.cost,
    motion: c.motion,
    score: costToScore(c.cost, reference)
  }));
}

export function scoreLabelKey(score) {
  if ( score === null || score === undefined ) return "Seam.Unknown";
  if ( score >= 0.85 ) return "Seam.Seamless";
  if ( score >= 0.6 ) return "Seam.Good";
  if ( score >= 0.35 ) return "Seam.Fair";
  return "Seam.Visible";
}

export function suggestBlendFrames(score, frameCount) {
  if ( score === null || score === undefined ) return DEFAULTS.blendFrames;
  if ( score >= 0.85 ) return 0;
  const span = Math.max(2, Math.round(frameCount * 0.08));
  return Math.min(span, score >= 0.6 ? DEFAULTS.blendFrames : DEFAULTS.blendFrames * 2);
}

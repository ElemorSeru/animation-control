import { MODULE_ID, SETTINGS, AUDIO_STATE, LOOP_MODE, LOOP_AUDIO, SEAM, ENGAGE, RELEASE, HOLD, START, IDLE, ENDED, DEFAULTS, RATE, DEFAULT_FPS } from "./constants.js";
import { kindForSource } from "./decode/index.js";
import { clampVolume, forgetAudio, forgetInspection } from "./audio.js";

export const PROFILE_VERSION = 4;

const LOOPS_VERSION = 3;

const ASSET_FIELDS = ["key", "kind", "source", "fps", "baked", "audioState"];
const BEHAVIOR_FIELDS = ["version", "playOn", "idle", "ended", "endedGotoId", "rate", "reversed", "desync", "volume", "audioIn", "audioOut", "from", "to", "enter", "exit", "loops", "seam"];

let loopCounter = 0;
function newLoopId() {
  const random = globalThis.foundry?.utils?.randomID;
  return random ? random() : "loop" + (++loopCounter);
}

export function assetKey(src) {
  if ( !src ) return "";
  return String(src).split("?")[0].split("#")[0].replace(/^\/+/, "");
}

// picked paths are percent-escaped but typed ones aren't so try both
export function keyCandidates(src) {
  const raw = assetKey(src);
  if ( !raw ) return [];
  const keys = [raw];
  if ( /%[0-9A-Fa-f]{2}/.test(raw) ) {
    try {
      const plain = assetKey(decodeURIComponent(raw));
      if ( plain && (plain !== raw) ) keys.push(plain);
    } catch { /* a stray percent, nothing to decode */ }
  }
  else {
    const escaped = assetKey(encodeURI(raw));
    if ( escaped && (escaped !== raw) ) keys.push(escaped);
  }
  return keys;
}

export function clampDesync(value) {
  const spread = Number(value);
  if ( !Number.isFinite(spread) || (spread <= 0) ) return 0;
  return Math.min(1, spread);
}

export function clampRate(value) {
  const rate = Number(value);
  if ( !Number.isFinite(rate) || (rate <= 0) ) return DEFAULTS.rate;
  return Math.min(RATE.max, Math.max(RATE.min, rate));
}

function transition(source = {}) {
  return {
    fade: !!source.fade,
    scale: !!source.scale,
    ms: Number(source.ms) > 0 ? Number(source.ms) : DEFAULTS.transitionMs
  };
}

function loopAudio(source = {}) {
  const bound = value => {
    const at = Number(value);
    return (Number.isFinite(at) && (at >= 0)) ? at : null;
  };
  const from = bound(source?.from);
  const to = bound(source?.to);
  const usable = (from !== null) && (to !== null) && (to > from);
  return {
    mode: Object.values(LOOP_AUDIO).includes(source?.mode) ? source.mode : LOOP_AUDIO.follow,
    from: usable ? from : null,
    to: usable ? to : null,
    level: clampVolume(source?.level ?? 1),
    crossfadeMs: Number(source?.crossfadeMs) > 0 ? Number(source.crossfadeMs) : DEFAULTS.crossfadeMs
  };
}

function holdOf(source = {}, loopMode = LOOP_MODE.loop) {
  let mode = Object.values(HOLD).includes(source?.mode) ? source.mode : HOLD.forever;
  if ( (loopMode === LOOP_MODE.pause) && (mode === HOLD.cycles) ) mode = HOLD.forever;
  const count = Math.max(1, Math.round(Number(source?.count) || 1));
  return { mode, count };
}

export function makeLoop(overrides = {}) {
  const from = Number(overrides.from) || 0;
  const to = Number(overrides.to) || 0;
  const mode = Object.values(LOOP_MODE).includes(overrides.mode) ? overrides.mode : LOOP_MODE.loop;
  return {
    id: overrides.id ?? newLoopId(),
    name: overrides.name ?? "",
    from,
    to: (mode === LOOP_MODE.pause) ? from : Math.max(from, to),
    mode,
    seam: Object.values(SEAM).includes(overrides.seam) ? overrides.seam : SEAM.cut,
    blendFrames: Number(overrides.blendFrames) > 0 ? Number(overrides.blendFrames) : DEFAULTS.blendFrames,
    engage: Object.values(ENGAGE).includes(overrides.engage) ? overrides.engage : ENGAGE.auto,
    release: Object.values(RELEASE).includes(overrides.release) ? overrides.release : RELEASE.carryOn,
    gotoId: overrides.gotoId ?? null,
    hold: holdOf(overrides.hold, mode),
    enter: transition(overrides.enter),
    exit: transition(overrides.exit),
    audio: loopAudio(overrides.audio)
  };
}

export function makeProfile(src, source = {}) {
  const duration = Number(source.duration) || 0;
  return {
    key: assetKey(src),
    version: PROFILE_VERSION,
    kind: kindForSource(src),
    source: {
      width: Number(source.width) || 0,
      height: Number(source.height) || 0,
      duration,
      frames: Number(source.frames) || 0
    },
    fps: DEFAULT_FPS,
    playOn: START.auto,
    idle: IDLE.frame,
    from: null,
    to: null,
    audioState: null,
    volume: 0,
    audioIn: true,
    audioOut: true,
    enter: transition(),
    exit: transition(),
    loops: [],
    seam: { score: null },
    baked: null
  };
}

export function makeBehavior(overrides = {}) {
  return behaviorOf(normalizeProfile(overrides, overrides?.key ?? ""));
}

function pick(source, fields) {
  const out = {};
  for ( const field of fields ) {
    if ( source && (field in source) ) out[field] = source[field];
  }
  return out;
}

export function behaviorOf(profile) {
  return pick(profile, BEHAVIOR_FIELDS);
}

export function assetOf(profile) {
  return pick(profile, ASSET_FIELDS);
}

function readAssets() {
  const stored = game.settings.get(MODULE_ID, SETTINGS.assets);
  return (stored && typeof stored === "object") ? stored : {};
}

export function getAsset(src) {
  const all = readAssets();
  for ( const key of keyCandidates(src) ) {
    const asset = all[key];
    if ( asset ) return assetOf(normalizeProfile(asset, key));
  }
  return null;
}

export async function saveAsset(asset) {
  const key = assetKey(asset?.key);
  if ( !key ) throw new Error("asset has no key");
  const all = foundry.utils.deepClone(readAssets());
  all[key] = { ...assetOf(asset), key };
  await game.settings.set(MODULE_ID, SETTINGS.assets, all);
  return all[key];
}

export async function deleteAsset(src) {
  const all = foundry.utils.deepClone(readAssets());
  const key = keyCandidates(src).find(k => k in all);
  if ( !key ) return false;
  delete all[key];
  await game.settings.set(MODULE_ID, SETTINGS.assets, all);
  forgetAudio(key);
  forgetAudio(src);
  forgetInspection(key);
  return true;
}

export function composeProfile(src, behavior) {
  const key = assetKey(src);
  const asset = getAsset(src) ?? { key };
  return normalizeProfile({ ...behaviorOf(behavior), ...assetOf(asset) }, key);
}

function optionalTime(value) {
  const number = Number(value);
  return Number.isFinite(number) && (number > 0) ? number : null;
}

export function normalizeProfile(profile, key) {
  const base = makeProfile(key, profile?.source ?? {});
  const stored = Number(profile?.version) || 0;
  const modern = Array.isArray(profile?.loops) || (stored >= LOOPS_VERSION);
  const loops = modern
    ? (Array.isArray(profile?.loops) ? profile.loops.map(makeLoop) : [])
    : migrateToLoops(profile);

  const trim = modern ? profile : migrateTrim(profile);

  const merged = {
    ...base,
    ...profile,
    key,
    version: PROFILE_VERSION,
    kind: profile?.kind ?? base.kind,
    source: { ...base.source, ...(profile?.source ?? {}) },
    fps: Number(profile?.fps) > 0 ? Number(profile.fps) : base.fps,
    playOn: Object.values(START).includes(profile?.playOn ?? profile?.start) ? (profile.playOn ?? profile.start) : base.playOn,
    idle: Object.values(IDLE).includes(profile?.idle) ? profile.idle : base.idle,
    ended: Object.values(ENDED).includes(profile?.ended) ? profile.ended : ENDED.last,
    endedGotoId: (typeof profile?.endedGotoId === "string") ? profile.endedGotoId : null,
    rate: clampRate(profile?.rate ?? base.rate),
    reversed: !!profile?.reversed,
    desync: clampDesync(profile?.desync),
    audioState: Object.values(AUDIO_STATE).includes(profile?.audioState) ? profile.audioState : null,
    volume: clampVolume(profile?.volume),
    audioIn: profile?.audioIn !== false,
    audioOut: profile?.audioOut !== false,
    from: optionalTime(trim?.from),
    to: optionalTime(trim?.to),
    enter: transition(trim?.enter ?? profile?.enter),
    exit: transition(trim?.exit ?? profile?.exit),
    loops,
    seam: { ...base.seam, ...(profile?.seam ?? {}) },
    baked: normalizeBaked(profile?.baked)
  };

  delete merged.audio;
  delete merged.stages;
  delete merged.segments;
  delete merged.start;

  const ids = new Set(merged.loops.map(l => l.id));
  for ( const loop of merged.loops ) {
    if ( (loop.release === RELEASE.goto) && !ids.has(loop.gotoId) ) loop.release = RELEASE.carryOn;
  }
  merged.loops.sort((a, b) => a.from - b.from);
  return merged;
}

function priorSegments(profile) {
  if ( Array.isArray(profile?.segments) ) return profile.segments;
  const stages = profile?.stages;
  if ( !stages ) return [];

  const out = [];
  if ( stages.in?.enabled ) out.push({ start: stages.in.start, end: stages.in.end, mode: "once", enter: profile.enter });
  const hold = stages.hold ?? {};
  out.push({
    start: hold.start ?? 0,
    end: hold.end ?? 0,
    mode: hold.mode === "pingpong" ? "pingpong" : "loop",
    seam: hold.mode === "blend" ? "blend" : "cut",
    blendFrames: hold.blendFrames
  });
  if ( stages.out?.enabled ) out.push({ start: stages.out.start, end: stages.out.end, mode: "once", exit: profile.exit });
  return out;
}

function migrateToLoops(profile) {
  return priorSegments(profile)
    .filter(s => (s.mode === "loop") || (s.mode === "pingpong"))
    .map(s => makeLoop({
      name: s.name,
      from: s.start,
      to: s.end,
      mode: s.mode === "pingpong" ? LOOP_MODE.pingpong : LOOP_MODE.loop,
      seam: s.seam,
      blendFrames: s.blendFrames,
      engage: ENGAGE.auto,
      release: (s.then === "stop") ? RELEASE.stop : RELEASE.carryOn,
      enter: s.enter,
      exit: s.exit
    }));
}

function migrateTrim(profile) {
  const segments = priorSegments(profile);
  const first = segments[0];
  const last = segments[segments.length - 1];
  return {
    from: null,
    to: null,
    enter: first?.enter ?? profile?.enter,
    exit: last?.exit ?? profile?.exit
  };
}

export function clipStart(profile) {
  return Number(profile?.from) || 0;
}

export function clipEnd(profile) {
  const to = Number(profile?.to);
  if ( Number.isFinite(to) && (to > 0) ) return to;
  return Number(profile?.source?.duration) || 0;
}

function normalizeBaked(baked) {
  if ( !baked || typeof baked !== "object" ) return null;
  const count = Number(baked.count) || 0;
  const cols = Number(baked.cols) || 0;
  const rows = Number(baked.rows) || 0;
  const frameW = Number(baked.frameW) || 0;
  const frameH = Number(baked.frameH) || 0;
  if ( !baked.path || !count || !cols || !rows || !frameW || !frameH ) return null;
  return {
    path: String(baked.path),
    bakedAt: Number(baked.bakedAt) || 0,
    count, cols, rows, frameW, frameH,
    delays: Array.isArray(baked.delays) ? baked.delays.map(d => Number(d) || 0) : [],
    sourceSize: Number(baked.sourceSize) || 0,
    sourceMtime: Number(baked.sourceMtime) || 0
  };
}

export function isBakeStale(asset, catalogEntry) {
  const baked = asset?.baked;
  if ( !baked ) return false;
  if ( !catalogEntry ) return false;
  if ( baked.sourceSize && catalogEntry.size && baked.sourceSize !== catalogEntry.size ) return true;
  if ( baked.sourceMtime && catalogEntry.mtime && baked.sourceMtime !== catalogEntry.mtime ) return true;
  return false;
}

export function cumulativeTimes(delays) {
  const times = [];
  let total = 0;
  for ( const delay of delays ) {
    times.push(total / 1000);
    total += delay;
  }
  return { times, totalSeconds: total / 1000 };
}

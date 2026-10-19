import { AUDIO_STATE, moduleWarn } from "./constants.js";

export const AUDIO_MAX_SECONDS = 600;

export const SILENCE_FLOOR = 0.0005;

const inspections = new Map();
const localBuffers = new Map();
const decoding = new Map();
const owners = new Map();

// core's budgeted cache, there before any user gesture
function bufferCache() {
  return globalThis.game?.audio?.buffers ?? null;
}

export function cachedBuffer(src) {
  const cache = bufferCache();
  if ( cache ) return cache.getBuffer(src) ?? null;
  return localBuffers.get(src) ?? null;
}

export function storeBuffer(src, buffer) {
  if ( !src || !buffer ) return buffer;
  const cache = bufferCache();
  if ( cache ) cache.setBuffer(src, buffer);
  else localBuffers.set(src, buffer);
  return buffer;
}

// lock it since eviction mid playback cuts the sound off
export function lockBuffer(src, locked = true) {
  bufferCache()?.lock(src, locked);
}

export function reversedKey(src) {
  return `${src}#animation-control-reversed`;
}

export function maxBufferSeconds() {
  const core = Number(globalThis.foundry?.audio?.Sound?.MAX_BUFFER_DURATION);
  return (Number.isFinite(core) && (core > 0)) ? core : AUDIO_MAX_SECONDS;
}

export function clampVolume(value) {
  const level = Number(value);
  if ( !Number.isFinite(level) || (level <= 0) ) return 0;
  return Math.min(1, level);
}

export function elementPlan({ baked } = {}) {
  return { muted: true, volume: 0, loop: false, playing: baked ? false : null };
}

export function applyElement(video, plan) {
  if ( !video || !plan ) return;
  try {
    video.muted = plan.muted;
    video.volume = plan.volume;
    video.loop = plan.loop;
    if ( (plan.playing === false) && !video.paused ) video.pause();
  } catch (err) {
    moduleWarn("video element could not be quietened", err);
  }
}

export function releaseElement(video, doc) {
  if ( !video ) return;
  try {
    video.muted = false;
    const level = Number(doc?.video?.volume);
    video.volume = (Number.isFinite(level) && (level > 0)) ? Math.min(1, level) : 0;
  } catch (err) {
    moduleWarn("video element could not be handed back", err);
  }
}

// no negative playbackRate so reverse plays a flipped buffer
export function mirrorOffset(seconds, duration) {
  const span = Number(duration) || 0;
  const at = Number(seconds) || 0;
  return Math.min(span, Math.max(0, span - at));
}

export function mirrorRange(from, to, duration) {
  return { from: mirrorOffset(to, duration), to: mirrorOffset(from, duration) };
}

export function claimAudio(key, ownerId) {
  if ( !key || !ownerId ) return false;
  const held = owners.get(key);
  if ( held && (held !== ownerId) ) return false;
  owners.set(key, ownerId);
  return true;
}

export function releaseAudioClaim(key, ownerId) {
  if ( owners.get(key) === ownerId ) owners.delete(key);
}

export async function audioContext() {
  const helper = globalThis.game?.audio;
  if ( !helper ) return null;
  try {
    await helper.unlock;
  } catch (err) {
    moduleWarn("audio never unlocked", err);
    return null;
  }
  return helper.environment ?? null;
}

export async function loadAudioBuffer(key, src, { maxSeconds } = {}) {
  if ( !key || !src ) return null;

  const held = cachedBuffer(src);
  if ( held ) return held;

  if ( decoding.has(src) ) return decoding.get(src);

  const cap = maxSeconds ?? maxBufferSeconds();
  const work = (async () => {
    const ctx = await audioContext();
    if ( !ctx ) return null;
    const response = await fetch(src);
    if ( !response.ok ) throw new Error(`audio fetch failed: ${response.status}`);
    const bytes = await response.arrayBuffer();
    const buffer = await ctx.decodeAudioData(bytes);
    if ( !buffer || !(buffer.duration > 0) || (buffer.duration > cap) ) return null;
    return storeBuffer(src, buffer);
  })().catch(err => {
    moduleWarn("audio could not be decoded", err);
    return null;
  }).finally(() => decoding.delete(src));

  decoding.set(src, work);
  return work;
}

export function reverseBuffer(ctx, key, buffer) {
  if ( !ctx || !buffer ) return null;
  const stored = cachedBuffer(reversedKey(key));
  if ( stored ) return stored;
  let copy = null;
  try {
    copy = ctx.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
    for ( let channel = 0; channel < buffer.numberOfChannels; channel++ ) {
      const source = buffer.getChannelData(channel);
      const target = copy.getChannelData(channel);
      const last = source.length - 1;
      for ( let i = 0; i <= last; i++ ) target[i] = source[last - i];
    }
  } catch (err) {
    moduleWarn("audio could not be reversed", err);
    return null;
  }
  return storeBuffer(reversedKey(key), copy);
}

export function forgetAudio(src) {
  const cache = bufferCache();
  if ( cache ) {
    cache.delete(src);
    cache.delete(reversedKey(src));
  }
  localBuffers.delete(src);
  localBuffers.delete(reversedKey(src));
}

export function sustainOf(loop) {
  const fallbackFrom = Number(loop?.from) || 0;
  const fallbackTo = Number(loop?.to) || 0;
  const from = Number(loop?.audio?.from);
  const to = Number(loop?.audio?.to);
  if ( Number.isFinite(from) && Number.isFinite(to) && (to > from) ) return { from, to };
  return { from: fallbackFrom, to: fallbackTo };
}

export function sustainForBuffer(loop, duration, reversed) {
  const span = Number(duration) || 0;
  const range = sustainOf(loop);
  const from = Math.max(0, Math.min(range.from, span));
  const to = Math.max(from, Math.min(range.to, span));
  return reversed ? mirrorRange(from, to, span) : { from, to };
}

export function swallowsMarker(loop, loops) {
  const range = sustainOf(loop);
  return (loops ?? []).some(other =>
    (other?.id !== loop?.id) && (range.from < other.to) && (range.to > other.from));
}

export function computePeaks(buffer, bins = 200) {
  const count = Math.max(1, Math.floor(bins));
  const peaks = new Array(count).fill(0);
  if ( !buffer?.length || !buffer.numberOfChannels ) return peaks;
  const step = buffer.length / count;
  for ( let channel = 0; channel < buffer.numberOfChannels; channel++ ) {
    const data = buffer.getChannelData(channel);
    for ( let bin = 0; bin < count; bin++ ) {
      const start = Math.floor(bin * step);
      const end = Math.min(data.length, Math.floor((bin + 1) * step));
      let peak = 0;
      for ( let i = start; i < end; i++ ) {
        const value = Math.abs(data[i]);
        if ( value > peak ) peak = value;
      }
      if ( peak > peaks[bin] ) peaks[bin] = peak;
    }
  }
  return peaks;
}

// decoding works before a user gesture, playback doesn't
function inspectContext(rate) {
  const Offline = globalThis.OfflineAudioContext ?? globalThis.webkitOfflineAudioContext;
  if ( !Offline ) return null;
  const sampleRate = Number(rate) || Number(globalThis.game?.audio?.environment?.sampleRate) || 48000;
  try {
    return new Offline(1, 1, sampleRate);
  } catch (err) {
    moduleWarn("no offline audio context", err);
    return null;
  }
}

export function peaksAreSilent(peaks, threshold = SILENCE_FLOOR) {
  if ( !peaks?.length ) return true;
  return peaks.every(peak => peak <= threshold);
}

export async function inspectAudio(key, src, { maxSeconds, bins = 320 } = {}) {
  if ( !key || !src ) return { state: AUDIO_STATE.unreadable, peaks: null, duration: 0 };
  if ( inspections.has(key) ) return inspections.get(key);

  const promise = (async () => {
    const ctx = inspectContext();
    if ( !ctx ) return { state: AUDIO_STATE.unreadable, peaks: null, duration: 0 };

    const response = await fetch(src);
    if ( !response.ok ) throw new Error(`audio fetch failed: ${response.status}`);
    const bytes = await response.arrayBuffer();

    let buffer = null;
    try {
      buffer = await ctx.decodeAudioData(bytes);
    } catch {
      // a missing track and a bad codec look the same
      return { state: AUDIO_STATE.unreadable, peaks: null, duration: 0 };
    }

    if ( !buffer || !(buffer.duration > 0) ) {
      return { state: AUDIO_STATE.silent, peaks: null, duration: 0 };
    }
    const duration = buffer.duration;
    if ( duration > (maxSeconds ?? maxBufferSeconds()) ) {
      return { state: AUDIO_STATE.tooLong, peaks: null, duration };
    }

    const peaks = computePeaks(buffer, bins);
    if ( peaksAreSilent(peaks) ) return { state: AUDIO_STATE.silent, peaks, duration };
    storeBuffer(src, buffer);
    return { state: AUDIO_STATE.sound, peaks, duration };
  })().catch(err => {
    moduleWarn("audio could not be inspected", err);
    return { state: AUDIO_STATE.unreadable, peaks: null, duration: 0 };
  });

  inspections.set(key, promise);
  return promise;
}

export function forgetInspection(key) {
  inspections.delete(key);
}

export class AudioVoice {
  #ctx;
  #buffer;
  #master;
  #src = null;
  #current = null;
  #destroyed = false;
  #rate = 1;

  constructor(ctx, buffer, src = null) {
    this.#ctx = ctx;
    this.#buffer = buffer;
    this.#src = src;
    if ( src ) lockBuffer(src, true);
    this.#master = ctx.createGain();
    this.#master.gain.value = 0;
    // the Ambient Volume slider controls this gain
    this.#master.connect(ctx.gainNode ?? ctx.destination);
  }

  get duration() {
    return this.#buffer?.duration ?? 0;
  }

  get playing() {
    return !!this.#current;
  }

  get looping() {
    return !!this.#current?.source?.loop;
  }

  #now() {
    return this.#ctx.currentTime ?? 0;
  }

  #safeOffset(offset) {
    const span = this.duration;
    if ( !(span > 0) ) return 0;
    return Math.min(Math.max(0, Number(offset) || 0), span - 0.001);
  }

  #spawn(offset) {
    const source = this.#ctx.createBufferSource();
    source.buffer = this.#buffer;
    source.playbackRate.value = this.#rate;
    const gain = this.#ctx.createGain();
    gain.gain.value = 0;
    source.connect(gain);
    gain.connect(this.#master);
    source.onended = () => {
      source.disconnect();
      gain.disconnect();
    };
    source.start(this.#now(), this.#safeOffset(offset));
    return { source, gain };
  }

  #retire(pair, ms) {
    if ( !pair ) return;
    const now = this.#now();
    const seconds = Math.max(0.001, (Number(ms) || 0) / 1000);
    try {
      pair.gain.gain.cancelScheduledValues(now);
      pair.gain.gain.setValueAtTime(pair.gain.gain.value, now);
      pair.gain.gain.linearRampToValueAtTime(0, now + seconds);
      pair.source.stop(now + seconds);
    } catch (err) {
      moduleWarn("voice could not be retired", err);
    }
  }

  start(offset, { volume = 1, fadeMs = 0 } = {}) {
    if ( this.#destroyed ) return;
    if ( this.#current ) this.#retire(this.#current, 0);
    this.#current = this.#spawn(offset);
    this.#current.gain.gain.setValueAtTime(1, this.#now());
    this.level(volume, fadeMs);
  }

  level(volume, ms = 0) {
    if ( this.#destroyed ) return;
    const target = clampVolume(volume);
    const now = this.#now();
    const gain = this.#master.gain;
    try {
      gain.cancelScheduledValues(now);
      gain.setValueAtTime(gain.value, now);
      if ( ms > 0 ) gain.linearRampToValueAtTime(target, now + (ms / 1000));
      else gain.setValueAtTime(target, now);
    } catch (err) {
      moduleWarn("level could not be set", err);
    }
  }

  rate(value) {
    const next = Number(value);
    this.#rate = (Number.isFinite(next) && (next > 0)) ? next : 1;
    if ( this.#current ) this.#current.source.playbackRate.value = this.#rate;
  }

  loopRange(from, to) {
    if ( this.#destroyed || !this.#current ) return;
    const source = this.#current.source;
    const start = Math.max(0, Number(from) || 0);
    const end = Math.min(this.duration, Number(to) || 0);
    source.loopStart = start;
    source.loopEnd = end;
    // clearing loop later lets the source run past loopEnd
    source.loop = end > start;
  }

  clearLoop() {
    if ( this.#current ) this.#current.source.loop = false;
  }

  spliceTo(offset, { crossfadeMs = 30 } = {}) {
    if ( this.#destroyed || !this.#current ) return;
    const now = this.#now();
    const seconds = Math.max(0.001, (Number(crossfadeMs) || 0) / 1000);
    const next = this.#spawn(offset);
    try {
      next.gain.gain.setValueAtTime(0, now);
      next.gain.gain.linearRampToValueAtTime(1, now + seconds);
    } catch (err) {
      moduleWarn("splice could not be faded", err);
    }
    this.#retire(this.#current, crossfadeMs);
    this.#current = next;
  }

  stop({ fadeMs = 0 } = {}) {
    if ( this.#current ) this.#retire(this.#current, fadeMs);
    this.#current = null;
  }

  destroy() {
    this.stop({ fadeMs: 0 });
    this.#destroyed = true;
    if ( this.#src ) lockBuffer(this.#src, false);
    try {
      this.#master.disconnect();
    } catch (err) {
      moduleWarn("voice could not be disconnected", err);
    }
  }
}

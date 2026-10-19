import { MODULE_ID, SETTINGS, LOOP_MODE, LOOP_AUDIO, SEAM, ENGAGE, RELEASE, HOLD, START, IDLE, ENDED, ACTION, DEFAULTS, moduleWarn } from "./constants.js";
import { BakedFrameSource, VideoFrameSource } from "./frame-source.js";
import { AudioVoice, applyElement, audioContext, claimAudio, clampVolume, elementPlan,
  loadAudioBuffer, mirrorOffset, releaseAudioClaim, releaseElement, reverseBuffer,
  sustainForBuffer, reversedKey } from "./audio.js";
import { cumulativeTimes, clipStart, clipEnd, clampRate, clampDesync } from "./profiles.js";

function easeInOut(t) {
  return t < 0.5 ? (2 * t * t) : (1 - Math.pow(-2 * t + 2, 2) / 2);
}

function frameAtTime(times, seconds) {
  if ( !times.length ) return 0;
  let low = 0;
  let high = times.length - 1;
  while ( low < high ) {
    const mid = (low + high + 1) >> 1;
    if ( times[mid] <= seconds ) low = mid;
    else high = mid - 1;
  }
  return low;
}

function ramp(now, startedAt, ms, direction) {
  if ( !(ms > 0) ) return 1;
  const t = Math.min(1, Math.max(0, (now - startedAt) / ms));
  const eased = easeInOut(t);
  return direction === "out" ? (1 - eased) : eased;
}

function pinch(now, startedAt, ms) {
  if ( !(ms > 0) ) return 1;
  const half = ms / 2;
  return ((now - startedAt) < half)
    ? ramp(now, startedAt, half, "out")
    : ramp(now, startedAt + half, half, "in");
}

// systems set their own round length, the setting is a fallback
function roundSeconds() {
  const system = Number(globalThis.CONFIG?.time?.roundTime);
  if ( Number.isFinite(system) && (system > 0) ) return system;
  const configured = Number(game.settings?.get?.(MODULE_ID, SETTINGS.roundSeconds));
  return (Number.isFinite(configured) && (configured > 0)) ? configured : 6;
}

export class AnimationController {
  #placeable;
  #profile;
  #source = null;
  #times = [];

  #playFrom = 0;
  #playTo = 0;
  #originClock = 0;
  #lastTime = -1;
  #lockedId = null;
  #lockedClock = 0;
  #loopShift = 0;
  #released = new Set();

  #idle = false;
  #ended = false;
  #paused = false;
  #pausedAt = 0;
  #startPaused = false;
  #startEnded = false;
  #startLoopShift = 0;
  #startReversed = null;
  #startPlayhead = null;
  #startShown = null;
  #startLoopClock = null;
  #startLockedAt = null;
  #startLockedRound = null;
  #pendingShow = null;
  #clockOffset = 0;
  #reversed = false;

  #fade = null;
  #enteredAt = 0;
  #endedAt = 0;
  #loopEnteredAt = 0;
  #loopLeftAt = 0;
  #leavingLoop = null;
  #transformed = false;

  #base = { alpha: 1, unoccludedAlpha: 1, scaleX: 1, scaleY: 1 };
  #originalTexture = null;
  #voice = null;
  #audioHeld = false;
  #destroyed = false;

  onStateChange = null;

  constructor(placeable, profile, {
    startLoopId = null, startIdle = null, startedClock = 0,
    startPaused = false, startReversed = null, startPlayhead = null,
    startShown = null, startLoopClock = null, startLockedAt = null, startLockedRound = null,
    startEnded = false, startLoopShift = 0
  } = {}) {
    this.#placeable = placeable;
    this.#profile = profile;
    this.#idle = (typeof startIdle === "boolean") ? startIdle : (profile?.playOn === START.trigger);
    this.#lockedId = startLoopId ?? null;
    this.#originClock = Number(startedClock) || 0;
    this.#startPaused = !!startPaused;
    this.#startReversed = (typeof startReversed === "boolean") ? startReversed : null;
    this.#startPlayhead = Number.isFinite(startPlayhead) ? Number(startPlayhead) : null;
    this.#startShown = Number.isFinite(startShown) ? Number(startShown) : null;
    this.#startLoopClock = Number.isFinite(startLoopClock) ? Number(startLoopClock) : null;
    this.#startLockedAt = Number.isFinite(startLockedAt) ? Number(startLockedAt) : null;
    this.#startLockedRound = Number.isFinite(startLockedRound) ? Number(startLockedRound) : null;
    this.#startEnded = !!startEnded;
    this.#startLoopShift = Number(startLoopShift) || 0;
  }

  get placeable() {
    return this.#placeable;
  }

  get profile() {
    return this.#profile;
  }

  get loops() {
    return this.#profile?.loops ?? [];
  }

  get lockedLoop() {
    return this.loops.find(l => l.id === this.#lockedId) ?? null;
  }

  get idle() {
    return this.#idle;
  }

  get ended() {
    return this.#ended;
  }

  get paused() {
    return this.#paused;
  }

  get reversed() {
    return this.#reversed;
  }

  get startedClock() {
    return this.#originClock;
  }

  get playhead() {
    return this.#playFrom + Math.max(0, this.#clipElapsed(this.#originClock));
  }

  get fadedOut() {
    return this.#fade?.dir === "out";
  }

  get isBaked() {
    return this.#source instanceof BakedFrameSource;
  }

  get mesh() {
    return this.#placeable?.mesh ?? null;
  }

  get shownTime() {
    return this.#shownTime;
  }

  get frameCanvas() {
    return this.#source?.canvas ?? null;
  }

  get canContinue() {
    return !this.#idle && !this.#ended && !!this.lockedLoop;
  }

  #combat() {
    const scene = this.#placeable?.scene ?? this.#placeable?.document?.parent ?? null;
    for ( const combat of (game.combats ?? []) ) {
      if ( !combat.active ) continue;
      if ( !combat.scene || (combat.scene === scene) ) return combat;
    }
    return null;
  }

  #loopPeriod(loop) {
    const span = Math.max((Number(loop.to) || 0) - (Number(loop.from) || 0), 0.001);
    if ( loop.mode === LOOP_MODE.pingpong ) return span * 2;
    if ( (loop.seam === SEAM.blend) && this.isBaked ) {
      const blendFrames = Math.max(0, Number(loop.blendFrames) || 0);
      const blend = blendFrames > 0 ? Math.min(blendFrames / Math.max(1, this.#profile.fps), span * 0.5) : 0;
      if ( blend > 0 ) return Math.max(0.001, span - blend);
    }
    return span;
  }

  #holdExpired(loop, clipClock, realClock) {
    const hold = loop?.hold;
    if ( !hold || (hold.mode === HOLD.forever) ) return false;
    const need = Math.max(1, Math.round(Number(hold.count) || 1));
    const elapsed = Math.max(0, clipClock);

    if ( hold.mode === HOLD.cycles ) return Math.floor(elapsed / this.#loopPeriod(loop)) >= need;
    if ( hold.mode === HOLD.seconds ) return Math.max(0, realClock) >= need;
    if ( hold.mode !== HOLD.rounds ) return false;

    const combat = this.#combat();
    if ( combat?.started ) {
      if ( this.#lockedRound === null ) this.#lockedRound = combat.round;
      return (combat.round - this.#lockedRound) >= need;
    }

    if ( this.#lockedRound === null ) return Math.max(0, realClock) >= (need * roundSeconds());

    if ( !this.#combatEndedAt ) this.#combatEndedAt = this.#now();
    return ((this.#now() - this.#combatEndedAt) / 1000) >= roundSeconds();
  }

  #serverNow() {
    return game.time?.serverTime ?? Date.now();
  }

  #now() {
    const server = this.#serverNow();
    return server - this.#clockOffset - (this.#paused ? (server - this.#pausedAt) : 0);
  }

  #frame = -1;
  #advances = 0;
  #shownTime = 0;
  #lockedRound = null;
  #combatEndedAt = 0;

  get debug() {
    const locked = this.lockedLoop;
    return {
      from: Number(this.#playFrom.toFixed(3)),
      to: Number(this.#playTo.toFixed(3)),
      playhead: Number(this.playhead.toFixed(3)),
      frame: this.#frame,
      advances: this.#advances,
      locked: locked?.name || locked?.id || null,
      loops: this.loops.length,
      loopFrames: locked ? Math.max(1, Math.round((locked.to - locked.from) * (this.#profile.fps || 24))) : null,
      hold: locked?.hold?.mode ?? null,
      heldRounds: this.#lockedRound,
      fadedOut: this.#fade?.dir === "out",
      idle: this.#idle,
      ended: this.#ended,
      paused: this.#paused,
      clockDrift: Number(((this.#now() - this.#originClock) / 1000).toFixed(3))
    };
  }

  async attach() {
    const profile = this.#profile;

    if ( profile.baked ) {
      const source = new BakedFrameSource(profile.baked);
      await source.load();
      if ( this.#destroyed || this.#placeable?.destroyed ) {
        source.destroy();
        return false;
      }
      this.#source = source;
      const { times } = cumulativeTimes(profile.baked.delays);
      this.#times = times.length ? times : [0];
      this.#applyTexture(source.texture);
    } else {
      const video = game.video.getVideoSource(this.#placeable?.texture);
      if ( !video ) return false;
      this.#source = new VideoFrameSource(video);
      this.#source.claim();
      await this.#source.play();
    }

    this.#playFrom = clipStart(profile);
    this.#playTo = clipEnd(profile) || this.#playFrom;
    this.captureBase();

    const now = performance.now();
    this.#enteredAt = now;
    this.#loopEnteredAt = now;
    if ( !this.#originClock ) this.#originClock = this.#now();
    if ( this.#lockedId ) {
      this.#lockedClock = this.#startLockedAt ?? this.#originClock;
      this.#lockedRound = this.#startLockedRound;
      this.#loopShift = this.#startLoopShift;
    }
    this.#ended = this.#startEnded && !this.#idle;
    if ( this.#ended ) this.#endedAt = -Infinity;
    this.#reversed = (this.#startReversed !== null) ? this.#startReversed : this.#defaultReversed();
    if ( this.#startPaused ) {
      this.#paused = true;
      this.#pausedAt = this.#serverNow();
      const traveled = (this.#startPlayhead ?? this.#playFrom) - this.#playFrom;
      if ( this.#startPlayhead !== null ) this.#originClock = this.#clockFor(traveled);
      if ( this.#lockedId && (this.#startLoopClock !== null) ) this.#lockedClock = this.#clockFor(this.#startLoopClock);
      const derived = (this.#lockedId || (this.#startPlayhead === null)) ? null
        : (this.#reversed ? (this.#playTo - traveled) : (this.#playFrom + traveled));
      this.#pendingShow = this.#startShown ?? derived;
      if ( this.#pendingShow !== null ) this.#shownTime = this.#pendingShow;
    }
    this.#quietenElement();
    this.#audioAttach().catch(err => moduleWarn("sound could not attach", err));
    return true;
  }

  // Foundry rewrites these on every refresh
  captureBase() {
    const mesh = this.mesh;
    if ( !mesh ) return;
    if ( this.#transformed ) return;
    this.#base = {
      alpha: mesh.alpha ?? 1,
      unoccludedAlpha: mesh.unoccludedAlpha ?? 1,
      scaleX: mesh.scale?.x ?? 1,
      scaleY: mesh.scale?.y ?? 1
    };
  }

  #quietenElement() {
    const texture = this.isBaked ? this.#originalTexture : this.#placeable?.texture;
    if ( !texture?.valid || !texture?.baseTexture?.resource ) return;
    const video = game.video?.getVideoSource?.(texture);
    if ( video ) applyElement(video, elementPlan({ baked: this.isBaked }));
  }

  get #audioLevel() {
    return clampVolume(this.#profile?.volume);
  }

  #audioOffset(seconds) {
    const span = this.#voice?.duration ?? 0;
    return this.#reversed ? mirrorOffset(seconds, span) : Math.max(0, Number(seconds) || 0);
  }

  async #audioAttach() {
    if ( this.#destroyed || !(this.#audioLevel > 0) ) return;
    const key = this.#profile?.key;
    const src = this.#audioSrc;
    if ( !key || !src ) return;

    if ( !claimAudio(key, this.#ownerId) ) return;
    this.#audioHeld = true;

    const buffer = await loadAudioBuffer(key, src);
    if ( this.#destroyed || !buffer ) return;
    const ctx = await audioContext();
    if ( this.#destroyed || !ctx ) return;

    this.#audioVoiceFor(ctx, src, buffer);
    if ( !this.#voice || this.#idle || this.#ended || this.#paused || this.#atPause ) return;
    this.#audioStart(this.#shownTime, this.#audioIntended);
    const loop = this.lockedLoop;
    if ( loop?.audio?.mode === LOOP_AUDIO.loop ) {
      const range = sustainForBuffer(loop, this.#voice.duration, this.#reversed);
      this.#voice.loopRange(range.from, range.to);
    }
  }

  #audioVoiceFor(ctx, src, buffer) {
    const playable = this.#reversed ? reverseBuffer(ctx, src, buffer) : buffer;
    if ( !playable ) return null;
    this.#voice = new AudioVoice(ctx, playable, this.#reversed ? reversedKey(src) : src);
    this.#voice.rate(this.#rate);
    return this.#voice;
  }

  async #audioFlip() {
    if ( !this.#voice ) return;
    const wanted = this.#reversed;
    const at = this.#shownTime;
    const src = this.#audioSrc;
    if ( !src ) return;
    const buffer = await loadAudioBuffer(this.#profile?.key, src);
    const ctx = await audioContext();
    if ( this.#destroyed || !buffer || !ctx ) return;
    if ( this.#reversed !== wanted ) return;
    this.#voice.destroy();
    this.#voice = null;
    this.#audioVoiceFor(ctx, src, buffer);
    if ( this.#voice && !this.#idle && !this.#ended && !this.#paused && !this.#atPause ) this.#audioStart(at);
  }

  #audioStart(seconds, volume = this.#audioLevel) {
    if ( !this.#voice ) return;
    const fade = (this.#profile?.audioIn !== false) ? (Number(this.#profile?.enter?.ms) || 0) : 0;
    this.#voice.start(this.#audioOffset(seconds), { volume, fadeMs: fade });
  }

  get #atPause() {
    return this.lockedLoop?.mode === LOOP_MODE.pause;
  }

  #audioEnterLoop(loop) {
    if ( !this.#voice || !loop ) return;
    if ( loop.mode === LOOP_MODE.pause ) return this.#audioStop({ faded: true });
    const mode = loop.audio?.mode ?? LOOP_AUDIO.follow;
    if ( mode === LOOP_AUDIO.silent ) return this.#voice.level(0, Number(loop.enter?.ms) || 0);
    if ( mode === LOOP_AUDIO.duck ) {
      return this.#voice.level(this.#audioLevel * clampVolume(loop.audio?.level ?? 1),
        Number(loop.enter?.ms) || 0);
    }
    if ( mode !== LOOP_AUDIO.loop ) return;
    const range = sustainForBuffer(loop, this.#voice.duration, this.#reversed);
    this.#voice.loopRange(range.from, range.to);
  }

  #audioLeaveLoop(loop) {
    if ( !this.#voice || !loop ) return;
    if ( loop.mode === LOOP_MODE.pause ) {
      if ( !this.#paused ) this.#audioStart(loop.from);
      return;
    }
    this.#voice.clearLoop();
    const mode = loop.audio?.mode ?? LOOP_AUDIO.follow;
    if ( (mode === LOOP_AUDIO.silent) || (mode === LOOP_AUDIO.duck) ) {
      this.#voice.level(this.#audioLevel, Number(loop.exit?.ms) || 0);
    }
    if ( mode === LOOP_AUDIO.loop ) {
      this.#voice.spliceTo(this.#audioOffset(this.#reversed ? loop.from : loop.to),
        { crossfadeMs: Number(loop.audio?.crossfadeMs) || DEFAULTS.crossfadeMs });
    }
  }

  #audioJump(seconds) {
    if ( !this.#voice ) return;
    this.#voice.clearLoop();
    this.#voice.level(this.#audioLevel, 0);
    this.#voice.spliceTo(this.#audioOffset(seconds), { crossfadeMs: DEFAULTS.crossfadeMs });
  }

  get #audioIntended() {
    const loop = this.lockedLoop;
    const mode = loop?.audio?.mode ?? LOOP_AUDIO.follow;
    if ( !loop || (mode === LOOP_AUDIO.follow) || (mode === LOOP_AUDIO.loop) ) return this.#audioLevel;
    if ( mode === LOOP_AUDIO.silent ) return 0;
    return this.#audioLevel * clampVolume(loop.audio?.level ?? 1);
  }

  #audioStop({ faded = false } = {}) {
    if ( !this.#voice ) return;
    const fade = (faded && (this.#profile?.audioOut !== false)) ? (Number(this.#profile?.exit?.ms) || 0) : 0;
    this.#voice.stop({ fadeMs: fade });
  }

  #audioRelease() {
    this.#voice?.destroy();
    this.#voice = null;
    if ( this.#audioHeld ) releaseAudioClaim(this.#profile?.key, this.#ownerId);
    this.#audioHeld = false;
  }

  #applyTexture(texture) {
    if ( !texture || !this.#placeable ) return;
    if ( !this.#originalTexture ) this.#originalTexture = this.#placeable.texture ?? null;
    this.#placeable.texture = texture;
    if ( this.#placeable.mesh ) this.#placeable.mesh.texture = texture;
  }

  reassert() {
    if ( this.#destroyed ) return;
    this.captureBase();
    if ( this.isBaked ) this.#applyTexture(this.#source.texture);
    else this.#source?.claim();
    this.#quietenElement();
  }

  #notify() {
    const loop = this.lockedLoop;
    this.onStateChange?.({
      loopId: this.#lockedId,
      idle: this.#idle,
      ended: this.#ended,
      // use server time or late joiners run ahead
      startedClock: this.#originClock + (this.#serverNow() - this.#now()),
      paused: this.#paused,
      reversed: this.#reversed,
      playhead: this.playhead,
      shown: this.#shownTime,
      loopClock: loop ? this.#clipElapsed(this.#lockedClock) : null,
      lockedAt: loop ? this.#lockedClock + (this.#serverNow() - this.#now()) : null,
      lockedRound: loop ? this.#lockedRound : null,
      loopShift: loop ? this.#loopShift : null
    });
  }

  play() {
    if ( this.#destroyed ) return false;
    const now = performance.now();
    this.#idle = false;
    this.#ended = false;
    this.#paused = false;
    this.#reversed = this.#defaultReversed();
    this.#fade = null;
    this.#clockOffset = 0;
    this.#lastTime = -1;
    this.#lockedId = null;
    this.#leavingLoop = null;
    this.#released.clear();
    this.#originClock = this.#now();
    this.#enteredAt = now;
    this.#audioStart(this.#playFrom);
    this.#notify();
    return true;
  }

  resumeAt(seconds) {
    if ( this.#destroyed ) return false;
    this.#clockOffset = 0;
    this.#originClock = this.#clockFor(this.#elapsedFor(seconds));
    this.#lastTime = -1;
    return true;
  }

  goIdle() {
    if ( this.#destroyed ) return false;
    this.#audioStop();
    this.#idle = true;
    this.#ended = false;
    this.#fade = null;
    this.#lockedId = null;
    this.#released.clear();
    this.#notify();
    return true;
  }

  #lockInto(loop) {
    this.#audioEnterLoop(loop);
    this.#lockedId = loop.id;
    this.#lockedClock = this.#now();
    this.#loopShift = 0;
    this.#loopEnteredAt = performance.now();
    this.#leavingLoop = null;
    const combat = this.#combat();
    this.#lockedRound = combat?.started ? combat.round : null;
    this.#combatEndedAt = 0;
    this.#notify();
  }

  #release(loop) {
    this.#audioLeaveLoop(loop);
    this.#released.add(loop.id);
    const back = this.#reversed;
    this.#lastTime = back ? loop.from : loop.to;
    this.#lockedId = null;
    this.#leavingLoop = loop;
    this.#loopLeftAt = performance.now();
    this.#originClock = this.#clockFor(this.#elapsedFor(back ? loop.from : loop.to));
    this.#notify();
  }

  continue() {
    const loop = this.lockedLoop;
    if ( this.#destroyed || !loop ) return false;

    if ( loop.release === RELEASE.stop ) {
      this.#lockedId = null;
      this.#leavingLoop = loop;
      this.#loopLeftAt = performance.now();
      this.#finish();
      return true;
    }

    if ( loop.release === RELEASE.goto ) {
      const target = this.loops.find(l => l.id === loop.gotoId);
      if ( target ) {
        this.#released.add(loop.id);
        if ( loop.mode === LOOP_MODE.pause ) this.#audioStart(this.#reversed ? target.to : target.from);
        this.#lockInto(target);
        return true;
      }
    }

    this.#release(loop);
    return true;
  }

  jumpTo(loopId) {
    const target = this.loops.find(l => l.id === loopId);
    if ( !target || this.#destroyed ) return false;
    this.#idle = false;
    this.#ended = false;
    this.#audioJump(this.#reversed ? target.to : target.from);
    this.#lockInto(target);
    return true;
  }

  #settleIntoLoop() {
    if ( this.#profile?.ended !== ENDED.goto ) return false;
    const target = this.loops.find(l => l.id === this.#profile?.endedGotoId);
    if ( !target ) return false;
    this.#released.clear();
    return this.jumpTo(target.id);
  }

  #restartRun() {
    if ( this.#profile?.ended !== ENDED.restart ) return false;
    const span = this.#playTo - this.#playFrom;
    if ( !(span > 0) ) return false;
    this.#released.clear();
    this.#lockedId = null;
    this.#leavingLoop = null;
    this.#lastTime = -1;
    this.#originClock += (span / this.#rate) * 1000;
    this.#audioJump(this.#reversed ? this.#playTo : this.#playFrom);
    return true;
  }

  #finish({ natural = false } = {}) {
    if ( natural && this.#settleIntoLoop() ) return;
    if ( natural && this.#restartRun() ) return;
    this.#ended = true;
    this.#endedAt = performance.now();
    this.#audioStop({ faded: true });
    this.#lockedId = null;
    this.#notify();
  }

  command(action, payload = {}) {
    switch ( action ) {
      case ACTION.play:
      case ACTION.restart:
        return this.play();
      case ACTION.continue:
        return this.continue();
      case ACTION.goto:
        return this.jumpTo(payload.loopId ?? payload.segmentId);
      case ACTION.pause:
        this.setPaused(true);
        return true;
      case ACTION.resume:
        this.setPaused(false);
        return true;
      case ACTION.reverse:
        this.setReversed(!this.#reversed);
        return true;
      case ACTION.fadeToggle:
        return this.command(this.#fade?.dir === "out" ? ACTION.fadeIn : ACTION.fadeOut);
      case ACTION.fadeOut:
        this.#fade = { dir: "out", startedAt: performance.now(), ms: this.#fadeMs() };
        this.#voice?.level(0, this.#fade.ms);
        return true;
      case ACTION.fadeIn:
        this.setPaused(false);
        this.#fade = { dir: "in", startedAt: performance.now(), ms: this.#fadeMs() };
        this.#voice?.level(this.#audioIntended, this.#fade.ms);
        return true;
      default:
        return false;
    }
  }

  #fadeMs() {
    return Number(this.#profile?.exit?.ms) || Number(this.#profile?.enter?.ms) || DEFAULTS.transitionMs;
  }

  setPaused(paused) {
    if ( this.#paused === paused ) return;
    const now = this.#serverNow();
    if ( paused ) this.#pausedAt = now;
    else this.#clockOffset += now - this.#pausedAt;
    this.#paused = paused;
    if ( paused ) this.#audioStop();
    else if ( !this.#atPause ) this.#audioStart(this.#shownTime);
    this.#notify();
  }

  // videos can't play backwards so reverse needs baked frames
  #defaultReversed() {
    return this.isBaked && !!this.#profile?.reversed;
  }

  setReversed(reversed) {
    if ( !this.isBaked ) return false;
    if ( this.lockedLoop?.mode === LOOP_MODE.pingpong ) return false;
    if ( this.#reversed === reversed ) return true;
    const turning = !this.#idle && !this.#ended;
    const loop = this.lockedLoop;
    const at = turning ? (loop ? this.#loopPoint(loop) : this.#runPoint()) : null;
    this.#reversed = reversed;
    if ( turning ) this.#turnAt(at, loop);
    this.#audioFlip().catch(err => moduleWarn("sound could not follow the reverse", err));
    this.#notify();
    return true;
  }

  #runPoint() {
    const elapsed = Math.max(0, this.#clipElapsed(this.#originClock));
    return this.#reversed
      ? Math.max(this.#playFrom, this.#playTo - elapsed)
      : Math.min(this.#playTo, this.#playFrom + elapsed);
  }

  #loopPoint(loop) {
    const from = Number(loop.from) || 0;
    if ( loop.mode === LOOP_MODE.pause ) return from;
    const span = Math.max((Number(loop.to) || 0) - from, 0.001);
    const period = this.#loopPeriod(loop);
    const shown = this.#clipElapsed(this.#lockedClock) + this.#phaseOffset(period) + this.#loopShift;
    if ( this.#reversed ) return from + (span - (((shown % span) + span) % span));
    return from + (((shown % period) + period) % period);
  }

  #turnAt(at, loop) {
    if ( !loop ) {
      this.#originClock = this.#clockFor(this.#elapsedFor(at));
      this.#lastTime = at;
      return;
    }
    if ( loop.mode === LOOP_MODE.pause ) return;
    const from = Number(loop.from) || 0;
    const span = Math.max((Number(loop.to) || 0) - from, 0.001);
    const into = at - from;
    const base = this.#clipElapsed(this.#lockedClock) + this.#phaseOffset(this.#loopPeriod(loop));
    this.#loopShift = (this.#reversed ? (span - into) : into) - base;
  }

  #showTime(seconds) {
    if ( !this.#source ) return;
    this.#shownTime = seconds;
    if ( this.isBaked ) {
      const index = frameAtTime(this.#times, seconds);
      this.#frame = index;
      this.#source.setFrame(index);
    } else {
      this.#source.seek(seconds);
    }
  }

  #showBlended(seconds, otherSeconds, mix) {
    if ( !this.isBaked ) return this.#showTime(seconds);
    this.#shownTime = seconds;
    this.#source.setBlendedFrame(frameAtTime(this.#times, seconds), frameAtTime(this.#times, otherSeconds), mix);
  }

  advance(nowMs) {
    if ( this.#destroyed || !this.#source ) return;
    this.#advances++;
    this.#source.hold?.(this.#idle || this.#paused || this.#ended || this.#atPause);

    if ( this.#idle ) {
      this.#showTime(this.#playFrom);
      this.#applyTransitions(nowMs);
      return;
    }
    if ( this.#paused ) {
      // restored pauses haven't drawn yet and videos ignore early seeks
      if ( this.#pendingShow !== null ) this.#showTime(this.#pendingShow);
      this.#applyTransitions(nowMs);
      return;
    }
    this.#pendingShow = null;
    if ( this.#ended ) {
      this.#showTime(this.#endFrame());
      this.#applyTransitions(nowMs);
      return;
    }

    const loop = this.lockedLoop;
    if ( loop ) this.#runLoop(loop);
    else this.#runPlayhead();

    this.#applyTransitions(nowMs);
  }

  #elapsedSince(clock) {
    return (this.#now() - clock) / 1000;
  }

  get #ownerId() {
    return this.#placeable?.isSurface
      ? String(this.#placeable.id ?? "")
      : String(this.#placeable?.document?.id ?? "");
  }

  // resolve it here since placeables.js imports this file
  get #audioSrc() {
    return this.#placeable?.isSurface
      ? (this.#placeable.src ?? null)
      : (this.#placeable?.document?.texture?.src ?? null);
  }

  #phaseSeed() {
    const id = this.#ownerId;
    let hash = 0;
    for ( let i = 0; i < id.length; i++ ) hash = ((hash << 5) - hash + id.charCodeAt(i)) | 0;
    return (Math.abs(hash) % 1000) / 1000;
  }

  #phaseOffset(period) {
    const spread = clampDesync(this.#profile?.desync);
    if ( spread <= 0 ) return 0;
    return this.#phaseSeed() * spread * period;
  }

  get #rate() {
    return clampRate(this.#profile?.rate);
  }

  #clipElapsed(clock) {
    return this.#elapsedSince(clock) * this.#rate;
  }

  #elapsedFor(time) {
    const at = Number(time) || 0;
    return this.#reversed ? (this.#playTo - at) : (at - this.#playFrom);
  }

  #clockFor(seconds) {
    return this.#now() - ((Math.max(0, seconds) / this.#rate) * 1000);
  }

  #endFrame() {
    const back = this.#reversed;
    if ( this.#profile?.ended === ENDED.first ) return back ? this.#playTo : this.#playFrom;
    return back ? this.#playFrom : this.#playTo;
  }

  #runPlayhead() {
    const back = this.#reversed;
    const elapsed = Math.max(0, this.#clipElapsed(this.#originClock));
    const time = back ? (this.#playTo - elapsed) : (this.#playFrom + elapsed);
    const previous = (this.#lastTime < 0) ? time : this.#lastTime;
    this.#lastTime = time;

    // test the whole interval since slow ticks skip short markers
    const gate = this.loops.find(l =>
      (l.engage === ENGAGE.auto)
      && !this.#released.has(l.id)
      && (back
        ? ((l.from < previous) && ((l.to > time) || ((l.mode === LOOP_MODE.pause) && (l.to >= time))))
        : ((l.from <= time) && (l.to > previous))));

    if ( gate ) {
      this.#lockInto(gate);
      this.#runLoop(gate);
      return;
    }

    if ( back ? (time <= this.#playFrom) : (time >= this.#playTo) ) {
      this.#showTime(back ? this.#playFrom : this.#playTo);
      this.#finish({ natural: true });
      return;
    }

    this.#showTime(time);
  }

  #runLoop(loop) {
    const from = Number(loop.from) || 0;
    const span = Math.max((Number(loop.to) || 0) - from, 0.001);
    const clock = this.#clipElapsed(this.#lockedClock);

    if ( this.#holdExpired(loop, clock, this.#elapsedSince(this.#lockedClock)) ) {
      this.continue();
      return;
    }

    if ( loop.mode === LOOP_MODE.pause ) {
      this.#showTime(from);
      return;
    }

    const shown = clock + this.#phaseOffset(this.#loopPeriod(loop)) + this.#loopShift;

    if ( loop.mode === LOOP_MODE.pingpong ) {
      const cycle = this.#loopPeriod(loop);
      const phase = ((shown % cycle) + cycle) % cycle;
      this.#showTime(from + (phase <= span ? phase : (cycle - phase)));
      return;
    }

    if ( this.#reversed ) {
      const phase = ((shown % span) + span) % span;
      this.#showTime(from + (span - phase));
      return;
    }

    if ( (loop.seam === SEAM.blend) && this.isBaked ) {
      const blendFrames = Math.max(0, Number(loop.blendFrames) || 0);
      const blend = blendFrames > 0 ? Math.min(blendFrames / Math.max(1, this.#profile.fps), span * 0.5) : 0;
      if ( blend > 0 ) {
        const period = this.#loopPeriod(loop);
        const phase = ((shown % period) + period) % period;
        if ( phase < blend ) {
          this.#showBlended(from + period + phase, from + phase, phase / blend);
          return;
        }
        this.#showTime(from + phase);
        return;
      }
    }

    const phase = ((shown % span) + span) % span;
    this.#showTime(from + phase);
  }

  #applyTransitions(nowMs) {
    const mesh = this.mesh;
    if ( !mesh ) return;

    if ( this.#idle ) {
      const hide = this.#profile?.idle === IDLE.hidden;
      this.#transformed = hide;
      mesh.alpha = hide ? 0 : this.#base.alpha;
      if ( "unoccludedAlpha" in mesh ) mesh.unoccludedAlpha = hide ? 0 : this.#base.unoccludedAlpha;
      return;
    }

    if ( this.#ended && (this.#profile?.ended === ENDED.hidden) ) {
      this.#transformed = true;
      mesh.alpha = 0;
      if ( "unoccludedAlpha" in mesh ) mesh.unoccludedAlpha = 0;
      return;
    }

    const clipEnter = this.#profile?.enter;
    const clipExit = this.#profile?.exit;
    const loop = this.lockedLoop;
    const leaving = this.#leavingLoop;

    let alpha = 1;
    let scale = 1;
    let touched = false;

    if ( this.#fade ) {
      alpha *= ramp(nowMs, this.#fade.startedAt, this.#fade.ms, this.#fade.dir);
      touched = true;
    }

    if ( clipEnter?.fade || clipEnter?.scale ) {
      const factor = ramp(nowMs, this.#enteredAt, clipEnter.ms, "in");
      if ( clipEnter.fade ) alpha *= factor;
      if ( clipEnter.scale ) scale *= factor;
      touched = true;
    }

    const manualFadeIn = this.#fade?.dir === "in";
    if ( this.#ended && !manualFadeIn && (clipExit?.fade || clipExit?.scale) ) {
      const factor = ramp(nowMs, this.#endedAt, clipExit.ms, "out");
      if ( clipExit.fade ) alpha *= factor;
      if ( clipExit.scale ) scale *= factor;
      touched = true;
    }

    if ( loop && (loop.enter?.fade || loop.enter?.scale) ) {
      const factor = ramp(nowMs, this.#loopEnteredAt, loop.enter.ms, "in");
      if ( loop.enter.fade ) alpha *= factor;
      if ( loop.enter.scale ) scale *= factor;
      touched = true;
    }

    if ( !loop && leaving && !this.#ended && (leaving.exit?.fade || leaving.exit?.scale) ) {
      const factor = pinch(nowMs, this.#loopLeftAt, leaving.exit.ms);
      if ( leaving.exit.fade ) alpha *= factor;
      if ( leaving.exit.scale ) scale *= factor;
      touched = true;
    }

    if ( !touched ) {
      if ( this.#transformed ) {
        mesh.alpha = this.#base.alpha;
        if ( "unoccludedAlpha" in mesh ) mesh.unoccludedAlpha = this.#base.unoccludedAlpha;
        if ( mesh.scale ) mesh.scale.set(this.#base.scaleX, this.#base.scaleY);
        this.#transformed = false;
      }
      return;
    }

    this.#transformed = (alpha !== 1) || (scale !== 1);
    mesh.alpha = this.#base.alpha * alpha;
    if ( "unoccludedAlpha" in mesh ) mesh.unoccludedAlpha = this.#base.unoccludedAlpha * alpha;
    if ( mesh.scale ) mesh.scale.set(this.#base.scaleX * scale, this.#base.scaleY * scale);
  }

  restore() {
    const mesh = this.mesh;
    this.#audioRelease();
    this.#transformed = false;
    if ( mesh ) {
      try {
        mesh.alpha = this.#base.alpha;
        if ( "unoccludedAlpha" in mesh ) mesh.unoccludedAlpha = this.#base.unoccludedAlpha;
        if ( mesh.scale ) mesh.scale.set(this.#base.scaleX, this.#base.scaleY);
        if ( this.#originalTexture ) mesh.texture = this.#originalTexture;
      } catch (err) {
        moduleWarn("restore failed", err);
      }
    }
    if ( this.#originalTexture && this.#placeable ) this.#placeable.texture = this.#originalTexture;

    try {
      const doc = this.#placeable?.document;
      const texture = this.#placeable?.texture;
      const usable = texture?.valid && texture?.baseTexture?.resource;
      const video = usable ? game.video?.getVideoSource?.(texture) : null;
      if ( video && doc?.video ) {
        releaseElement(video, doc);
        video.loop = !!doc.video.loop;
        if ( doc.video.autoplay ) video.play?.()?.catch?.(() => {});
      }
    } catch (err) {
      moduleWarn("could not hand playback back", err);
    }
  }

  destroy() {
    if ( this.#destroyed ) return;
    this.#destroyed = true;
    this.onStateChange = null;
    this.restore();
    this.#source?.destroy();
    this.#source = null;
    this.#placeable = null;
    this.#originalTexture = null;
  }
}

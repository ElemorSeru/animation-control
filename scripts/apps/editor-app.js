import { MODULE_ID, FLAGS, ACTION, LOOP_MODE, SEAM, ENGAGE, RELEASE, HOLD, START, IDLE, ENDED, LOOP_AUDIO, AUDIO_STATE, DEFAULTS, RATE, localize, moduleWarn } from "../constants.js";
import { appV2, handlebarsMixin } from "../compat.js";
import { loadSheetImage, sheetUrl } from "../frame-source.js";
import { clampVolume, inspectAudio, maxBufferSeconds, sustainOf, swallowsMarker } from "../audio.js";
import { makeSignatureExtractor, findLoops, seamScore, scoreLabelKey, suggestBlendFrames, buildSeamCache } from "../analysis.js";
import { composeProfile, behaviorOf, makeBehavior, makeLoop, cumulativeTimes, clipStart, clipEnd, clampRate, clampDesync, getAsset, saveAsset } from "../profiles.js";
import { prepareAsset } from "../bake.js";
import { AnimationController } from "../scheduler.js";
import { buttonsFor } from "../hud.js";
import { loadCatalog, getEntry } from "../catalog.js";
import { enhanceSelects } from "../dropdown.js";
import { saveSurfaceBehavior } from "../scene-surface.js";

const TEMPLATE = `modules/${MODULE_ID}/templates/editor.hbs`;
const STRIP_HEIGHT = 44;
const ZOOM_STEPS = [1, 1.5, 2, 3, 4, 6, 8];
const KEPT_SCROLL = [".ac-editor-stage", ".ac-editor-detail", ".ac-stage-side", ".ac-thumbs"];

function durationFrom(value) {
  const text = String(value ?? "").trim();
  if ( !text ) return DEFAULTS.transitionMs;
  const ms = Math.round(Number(text));
  if ( !Number.isFinite(ms) || (ms < 1) ) return DEFAULTS.transitionMs;
  return Math.min(ms, 10000);
}

const RATE_STEPS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4]
  .filter(r => (r >= RATE.min) && (r <= RATE.max));

const RELEASE_TONE = {
  [RELEASE.carryOn]: "pass",
  [RELEASE.goto]: "jump",
  [RELEASE.stop]: "stop"
};

export class EditorApp extends handlebarsMixin()(appV2()) {
  static DEFAULT_OPTIONS = {
    id: "animation-control-editor",
    classes: ["animation-control", "ac-editor"],
    tag: "div",
    window: { title: `${MODULE_ID}.Editor.Title`, icon: "fa-solid fa-sliders", resizable: true },
    position: { width: 1080, height: 820 },
    actions: {
      analyze: EditorApp.#onAnalyze,
      findLoops: EditorApp.#onFindLoops,
      applyCandidate: EditorApp.#onApplyCandidate,
      addCandidate: EditorApp.#onAddCandidate,
      addLoop: EditorApp.#onAddLoop,
      addPause: EditorApp.#onAddPause,
      toggleSection: EditorApp.#onToggleSection,
      deleteLoop: EditorApp.#onDeleteLoop,
      clearTrim: EditorApp.#onClearTrim,
      save: EditorApp.#onSave,
      reset: EditorApp.#onReset,
      zoomIn: EditorApp.#onZoomIn,
      zoomOut: EditorApp.#onZoomOut,
      zoomReset: EditorApp.#onZoomReset
    }
  };

  static PARTS = { body: { template: TEMPLATE } };

  static #open = new Set();

  constructor(options = {}) {
    super(options);
    this.doc = options.doc ?? null;
    this.surface = options.surface ?? null;
    this.src = options.src;
    this.profile = null;
    this.signatures = [];
    this.seamCache = null;
    this.times = [];
    this.candidates = [];
    this.collapsedSections = new Set();
    this.repeat = false;
    this.peaks = null;
    this.peaksPending = false;
    this.audioDuration = 0;
    this.frameSeconds = 0;
    this.inspected = false;
    this.audioState = null;
    this.autoStarted = false;
    this.busy = null;
    this.previewBackground = "dark";
    this.sheet = null;
    this.rafHandle = null;
    this.selectedId = null;
    this.zoomStep = 0;
    this.timelineScrollLeft = 0;
    this.paneScroll = {};
    this.hoverCandidate = null;
    this.run = null;
  }

  static async open(target) {
    const src = target?.isSurface ? target.src : target?.texture?.src;
    if ( !src ) return null;
    for ( const app of EditorApp.#open ) await app.close();
    EditorApp.#open.clear();
    const app = new EditorApp({
      doc: target?.isSurface ? null : target,
      surface: target?.isSurface ? target : null,
      src
    });
    EditorApp.#open.add(app);
    return app.render(true);
  }

  get title() {
    const name = String(this.src ?? "").split("/").pop();
    const what = this.surface ? `${this.surface.label} - ` : "";
    return `${localize("Editor.Title")}: ${what}${name}`;
  }

  get baked() {
    return this.profile?.baked ?? null;
  }

  get frameCount() {
    return this.baked?.count ?? 0;
  }

  get duration() {
    return Number(this.profile?.source?.duration) || this.frameSeconds || 0;
  }

  get loops() {
    return this.profile?.loops ?? [];
  }

  get selected() {
    return this.loops.find(l => l.id === this.selectedId) ?? this.loops[0] ?? null;
  }

  // the select shows its first option without saving it
  #resolveEndedTarget() {
    if ( this.profile?.ended !== ENDED.goto ) return;
    const loops = this.loops;
    if ( !loops.length ) return;
    if ( loops.some(l => l.id === this.profile.endedGotoId) ) return;
    this.profile.endedGotoId = loops[0].id;
  }

  #resolveLoopTarget(loop) {
    if ( !loop || (loop.release !== RELEASE.goto) ) return;
    const others = this.loops.filter(l => l.id !== loop.id);
    if ( !others.length ) return;
    if ( others.some(l => l.id === loop.gotoId) ) return;
    loop.gotoId = others[0].id;
  }

  async _prepareContext() {
    await loadCatalog();
    const stored = this.surface
      ? this.surface.behavior
      : this.doc?.getFlag(MODULE_ID, FLAGS.profile);
    this.profile ??= composeProfile(this.src, stored ?? makeBehavior());
    const entry = getEntry(this.src);

    if ( this.baked ) {
      try {
        await this.#ensureSheet();
      } catch (err) {
        moduleWarn("sheet load failed", err);
      }
    }

    const selected = this.selected;
    if ( selected ) this.selectedId = selected.id;
    this.#resolveEndedTarget();
    this.#resolveLoopTarget(selected);

    const seam = (selected && this.signatures.length)
      ? seamScore(this.signatures, this.#timeToIndex(selected.from), this.#timeToIndex(selected.to), this.seamCache)
      : null;

    return {
      src: this.src,
      entry,
      profile: this.profile,
      prepared: !!this.baked,
      busy: this.busy,
      candidates: this.candidates.map((c, i) => ({
        ...c,
        index: i,
        percent: Math.round(c.score * 100)
      })),
      previewBackground: this.previewBackground,
      zoomLabel: `${ZOOM_STEPS[this.zoomStep]}x`,
      seamLabel: localize(scoreLabelKey(seam?.score ?? null)),
      seamDots: this.#seamDots(seam?.score ?? null),
      hasTrim: (this.profile?.from !== null) || (this.profile?.to !== null),
      trimFrom: this.#fmt(clipStart(this.profile)),
      trimTo: this.#fmt(clipEnd(this.profile)),
      loopCount: this.loops.length,
      selected,
      selectedTone: RELEASE_TONE[selected?.release] ?? "pass",
      selectedTitle: selected ? this.#markerLabel(selected, this.loops.indexOf(selected)) : "",
      isPause: selected?.mode === LOOP_MODE.pause,
      collapsed: {
        candidates: this.collapsedSections.has("candidates"),
        clip: this.collapsedSections.has("clip")
      },
      starts: this.#options(START, "Start", this.profile?.playOn),
      spreads: [
        { value: 0, label: localize("Editor.DesyncNone") },
        { value: 0.25, label: localize("Editor.DesyncSome") },
        { value: 0.5, label: localize("Editor.DesyncHalf") },
        { value: 1, label: localize("Editor.DesyncFull") }
      ].map(s => ({
        ...s,
        selected: Math.abs(s.value - clampDesync(this.profile?.desync)) < 0.001
      })),
      directions: [
        { value: "forward", label: localize("Editor.Forward"), selected: !this.profile?.reversed },
        { value: "reversed", label: localize("Editor.Backwards"), selected: !!this.profile?.reversed }
      ],
      rates: RATE_STEPS.map(value => ({
        value,
        label: localize("Editor.SpeedTimes", { rate: value }),
        selected: Math.abs(value - (Number(this.profile?.rate) || 1)) < 0.001
      })),
      idles: this.#options(IDLE, "Idle", this.profile?.idle),
      endings: this.#options(ENDED, "Ended", this.profile?.ended),
      hasAudio: this.audioState === AUDIO_STATE.sound,
      soundOff: (this.audioState !== null) && (this.audioState !== AUDIO_STATE.sound),
      soundReason: this.#soundReason(),
      loopAudioModes: this.#options(LOOP_AUDIO, "LoopAudio", selected?.audio?.mode),
      loopAudioLevel: Math.round(clampVolume(selected?.audio?.level ?? 1) * 100),
      loopCrossfade: Number(selected?.audio?.crossfadeMs) || DEFAULTS.crossfadeMs,
      showSustain: selected?.audio?.mode === LOOP_AUDIO.loop,
      sustainWarning: selected ? swallowsMarker(selected, this.loops) : false,
      sustainLabel: selected ? this.#sustainLabel(selected) : "",
      volume: Math.round(clampVolume(this.profile?.volume) * 100),
      audioIn: this.profile?.audioIn !== false,
      audioOut: this.profile?.audioOut !== false,
      showEndedGoto: this.profile?.ended === ENDED.goto,
      endedGotoTargets: this.loops.map((l, i) => ({
        value: l.id,
        label: this.#markerLabel(l, i),
        selected: l.id === this.profile?.endedGotoId
      })),
      showIdle: this.profile?.playOn === START.trigger,
      clipEnter: this.profile?.enter,
      clipExit: this.profile?.exit,
      modes: this.#options(LOOP_MODE, "Mode", selected?.mode).filter(o => o.value !== LOOP_MODE.pause),
      seams: this.#options(SEAM, "SeamMode", selected?.seam),
      engages: this.#options(ENGAGE, "Engage", selected?.engage),
      releases: this.#options(RELEASE, "Release", selected?.release),
      loopFrames: selected ? Math.max(1, this.#timeToIndex(selected.to) - this.#timeToIndex(selected.from) + 1) : 0,
      loopTooShort: (selected && (selected.mode !== LOOP_MODE.pause))
        ? ((this.#timeToIndex(selected.to) - this.#timeToIndex(selected.from) + 1) < 6)
        : false,
      holds: this.#options(HOLD, "Hold", selected?.hold?.mode ?? HOLD.forever)
        .filter(o => !((selected?.mode === LOOP_MODE.pause) && (o.value === HOLD.cycles))),
      holdCount: selected?.hold?.count ?? 1,
      showHold: selected?.engage === ENGAGE.auto,
      showHoldCount: (selected?.engage === ENGAGE.auto) && (selected?.hold?.mode !== HOLD.forever),
      showGoto: selected?.release === RELEASE.goto,
      gotoTargets: this.loops
        .map((l, i) => ({
          value: l.id,
          label: this.#markerLabel(l, i),
          selected: l.id === selected?.gotoId,
          isSelf: l.id === selected?.id
        }))
        .filter(t => !t.isSelf)
    };
  }

  #markerLabel(loop, index) {
    if ( loop.name ) return loop.name;
    const key = (loop.mode === LOOP_MODE.pause) ? "Editor.PauseIndex" : "Editor.LoopIndex";
    return localize(key, { index: index + 1 });
  }

  #fmt(seconds) {
    return `${(Number(seconds) || 0).toFixed(2)}s`;
  }

  #options(source, prefix, current) {
    return Object.values(source).map(value => ({
      value,
      label: localize(`${prefix}.${value}`),
      selected: value === current
    }));
  }

  #seamDots(score) {
    const filled = score === null ? 0 : Math.max(1, Math.round(score * 5));
    return Array.from({ length: 5 }, (_, i) => ({ filled: i < filled }));
  }

  #timeToIndex(seconds) {
    if ( !this.times.length ) return 0;
    let index = 0;
    for ( let i = 0; i < this.times.length; i++ ) {
      if ( this.times[i] <= seconds ) index = i;
      else break;
    }
    return index;
  }

  #indexToTime(index) {
    if ( !this.times.length ) return 0;
    const clamped = Math.max(0, Math.min(Math.round(index), this.times.length - 1));
    return this.times[clamped];
  }

  async #ensureSheet() {
    if ( this.sheet || !this.baked ) return this.sheet;
    const image = await loadSheetImage(sheetUrl(this.baked));
    this.sheet = image;

    const { times, totalSeconds } = cumulativeTimes(this.baked.delays);
    this.times = times.length ? times : [0];
    this.frameSeconds = totalSeconds;

    if ( !this.signatures.length ) this.signatures = this.#extractSignatures(image);
    this.seamCache ??= buildSeamCache(this.signatures);
    return image;
  }

  #extractSignatures(image) {
    const { cols, frameW, frameH, count } = this.baked;
    const extract = makeSignatureExtractor();
    const cell = document.createElement("canvas");
    cell.width = frameW;
    cell.height = frameH;
    const ctx = cell.getContext("2d", { willReadFrequently: true });

    const signatures = [];
    for ( let i = 0; i < count; i++ ) {
      const sx = (i % cols) * frameW;
      const sy = Math.floor(i / cols) * frameH;
      ctx.clearRect(0, 0, frameW, frameH);
      ctx.drawImage(image, sx, sy, frameW, frameH, 0, 0, frameW, frameH);
      signatures.push(extract(cell));
    }
    return signatures;
  }

  #fitCanvas(canvas) {
    if ( !canvas || !this.baked ) return false;
    const { frameW, frameH } = this.baked;
    if ( (canvas.width !== frameW) || (canvas.height !== frameH) ) {
      canvas.width = frameW;
      canvas.height = frameH;
    }
    return true;
  }

  #drawFrame(ctx, index, width, height) {
    if ( !this.sheet || !this.baked ) return;
    const { cols, frameW, frameH, count } = this.baked;
    const clamped = Math.max(0, Math.min(Math.round(index), count - 1));
    const sx = (clamped % cols) * frameW;
    const sy = Math.floor(clamped / cols) * frameH;
    ctx.drawImage(this.sheet, sx, sy, frameW, frameH, 0, 0, width, height);
  }

  async _onRender(context, options) {
    super._onRender?.(context, options);
    this.#stopPreview();
    const wasRunning = !!this.run;
    const resumeAt = this.run?.controller?.shownTime ?? null;
    this.#stopRun();

    const root = this.element;
    root.dataset.background = this.previewBackground;
    this.#bindControls(root);
    enhanceSelects(root);
    for ( const selector of KEPT_SCROLL ) {
      const pane = root.querySelector(selector);
      if ( !pane ) continue;
      const kept = this.paneScroll[selector];
      if ( kept ) {
        pane.scrollTop = kept.top;
        pane.scrollLeft = kept.left;
      }
      pane.addEventListener("scroll", () => {
        this.paneScroll[selector] = { top: pane.scrollTop, left: pane.scrollLeft };
      }, { passive: true });
    }

    if ( !this.baked || !this.sheet ) return;
    if ( (this.audioState === null) && this.profile?.audioState ) this.audioState = this.profile.audioState;
    this.#loadWave();
    this.#renderTimeline(root);
    this.#renderTransport(root);
    this.#startPreview(root);
    if ( wasRunning ) await this.#startRun(root, { at: resumeAt });
    else if ( !this.autoStarted ) {
      this.autoStarted = true;
      await this.#startRun(root);
    }
  }

  #bindControls(root) {
    root.querySelector("[data-control='background']")?.addEventListener("change", event => {
      this.previewBackground = event.currentTarget.value;
      root.dataset.background = this.previewBackground;
    });

    root.querySelector("[data-profile='volume']")?.addEventListener("change", event => {
      if ( !this.profile ) return;
      this.profile.volume = clampVolume(Number(event.currentTarget.value) / 100);
      this.render({ parts: ["body"] });
    });

    for ( const control of root.querySelectorAll("[data-loop-audio]") ) {
      control.addEventListener("change", event => {
        const loop = this.selected;
        if ( !loop ) return;
        const field = event.currentTarget.dataset.loopAudio;
        const raw = event.currentTarget.value;
        if ( field === "level" ) loop.audio.level = clampVolume(Number(raw) / 100);
        else if ( field === "crossfadeMs" ) loop.audio.crossfadeMs = Math.max(0, Number(raw) || 0);
        else loop.audio.mode = raw;
        this.render({ parts: ["body"] });
      });
    }

    root.querySelector("[data-action='resetSustain']")?.addEventListener("click", () => {
      const loop = this.selected;
      if ( !loop ) return;
      loop.audio.from = null;
      loop.audio.to = null;
      this.render({ parts: ["body"] });
    });

    for ( const box of root.querySelectorAll("[data-profile-flag]") ) {
      box.addEventListener("change", event => {
        if ( !this.profile ) return;
        this.profile[event.currentTarget.dataset.profileFlag] = event.currentTarget.checked;
        this.render({ parts: ["body"] });
      });
    }

    for ( const key of ["playOn", "idle", "ended", "endedGotoId"] ) {
      root.querySelector(`[data-profile='${key}']`)?.addEventListener("change", event => {
        if ( !this.profile ) return;
        this.profile[key] = event.currentTarget.value;
        this.render({ parts: ["body"] });
      });
    }

    root.querySelector("[data-profile='desync']")?.addEventListener("change", event => {
      if ( !this.profile ) return;
      this.profile.desync = clampDesync(event.currentTarget.value);
      this.render({ parts: ["body"] });
    });

    root.querySelector("[data-profile='reversed']")?.addEventListener("change", event => {
      if ( !this.profile ) return;
      this.profile.reversed = event.currentTarget.value === "reversed";
      this.render({ parts: ["body"] });
    });

    root.querySelector("[data-profile='rate']")?.addEventListener("change", event => {
      if ( !this.profile ) return;
      this.profile.rate = clampRate(event.currentTarget.value);
      this.render({ parts: ["body"] });
    });

    for ( const box of root.querySelectorAll("[data-clip-transition]") ) {
      box.addEventListener("change", event => {
        if ( !this.profile ) return;
        const [group, key] = event.currentTarget.dataset.clipTransition.split(".");
        this.profile[group] = { ...this.profile[group], [key]: event.currentTarget.checked };
      });
    }

    root.querySelector("[data-field='name']")?.addEventListener("input", event => {
      const loop = this.selected;
      if ( loop ) loop.name = event.currentTarget.value;
    });

    root.querySelector("[data-field='holdMode']")?.addEventListener("change", event => {
      const loop = this.selected;
      if ( !loop ) return;
      loop.hold = { ...loop.hold, mode: event.currentTarget.value };
      this.render({ parts: ["body"] });
    });

    root.querySelector("[data-field='holdCount']")?.addEventListener("change", event => {
      const loop = this.selected;
      if ( !loop ) return;
      loop.hold = { ...loop.hold, count: Math.max(1, Math.round(Number(event.currentTarget.value) || 1)) };
    });

    for ( const field of ["mode", "seam", "engage", "release", "gotoId"] ) {
      root.querySelector(`[data-field='${field}']`)?.addEventListener("change", event => {
        const loop = this.selected;
        if ( !loop ) return;
        loop[field] = event.currentTarget.value;
        this.render({ parts: ["body"] });
      });
    }

    for ( const input of root.querySelectorAll("[data-clip-duration]") ) {
      input.addEventListener("change", event => {
        if ( !this.profile ) return;
        const group = event.currentTarget.dataset.clipDuration;
        const ms = durationFrom(event.currentTarget.value);
        this.profile[group] = { ...this.profile[group], ms };
        event.currentTarget.value = String(ms);
      });
    }

    for ( const input of root.querySelectorAll("[data-loop-duration]") ) {
      input.addEventListener("change", event => {
        const loop = this.selected;
        if ( !loop ) return;
        const group = event.currentTarget.dataset.loopDuration;
        const ms = durationFrom(event.currentTarget.value);
        loop[group] = { ...loop[group], ms };
        event.currentTarget.value = String(ms);
      });
    }

    for ( const box of root.querySelectorAll("[data-loop-transition]") ) {
      box.addEventListener("change", event => {
        const loop = this.selected;
        if ( !loop ) return;
        const [group, key] = event.currentTarget.dataset.loopTransition.split(".");
        loop[group] = { ...loop[group], [key]: event.currentTarget.checked };
      });
    }

    for ( const canvas of root.querySelectorAll("[data-candidate-canvas]") ) {
      const candidate = this.candidates[Number(canvas.dataset.candidateCanvas)];
      if ( !candidate || !this.#fitCanvas(canvas) ) continue;
      this.#drawFrame(canvas.getContext("2d"), candidate.start, canvas.width, canvas.height);
    }

    for ( const button of root.querySelectorAll(".ac-candidate") ) {
      const index = Number(button.dataset.candidate);
      button.addEventListener("pointerenter", () => {
        this.hoverCandidate = this.candidates[index] ?? null;
        this.#paintGhost(root);
      });
      button.addEventListener("pointerleave", () => {
        this.hoverCandidate = null;
        this.#paintGhost(root);
      });
    }
  }

  async #loadWave() {
    if ( this.peaksPending || this.inspected ) return;
    this.peaksPending = true;
    const found = await inspectAudio(this.profile?.key, this.src);
    this.peaks = found.peaks;
    this.audioState = found.state;
    this.audioDuration = Number(found.duration) || 0;
    this.inspected = true;
    this.peaksPending = false;
    if ( this.profile ) this.profile.audioState = found.state;
    await this.#rememberAudioState(found.state);
    this.render({ parts: ["body"] });
  }

  async #rememberAudioState(state) {
    try {
      const asset = getAsset(this.src);
      if ( !asset || (asset.audioState === state) ) return;
      await saveAsset({ ...asset, audioState: state });
    } catch (err) {
      moduleWarn("audio verdict could not be stored", err);
    }
  }


  #renderWave(root) {
    const lane = root.querySelector("[data-wave-lane]");
    const wave = root.querySelector("[data-wave]");
    if ( !lane || !wave ) return;

    const peaks = this.peaks ?? [];
    const height = 56;
    const mid = height / 2;
    wave.setAttribute("viewBox", `0 0 ${Math.max(1, peaks.length)} ${height}`);
    wave.innerHTML = peaks.map((peak, i) => {
      const half = Math.max(0.5, peak * mid);
      return `<rect x="${i}" y="${(mid - half).toFixed(2)}" width="0.8" height="${(half * 2).toFixed(2)}"></rect>`;
    }).join("");

    const clip = Math.max(0.001, this.duration);
    const sound = Number(this.audioDuration) || 0;
    wave.style.width = `${(sound > 0 ? (sound / clip) : 1) * 100}%`;

    lane.querySelector(".ac-wave-over")?.remove();
    if ( sound > (clip + 0.01) ) {
      const over = document.createElement("div");
      over.className = "ac-wave-over";
      over.dataset.tooltip = localize("Editor.SoundPastEnd", { seconds: (sound - clip).toFixed(2) });
      lane.appendChild(over);
    }

    for ( const stale of lane.querySelectorAll(".ac-wave-region") ) stale.remove();

    for ( const loop of this.loops ) {
      if ( loop.audio?.mode !== LOOP_AUDIO.loop ) continue;
      const range = sustainOf(loop);
      const selected = loop.id === this.selectedId;
      const region = document.createElement("div");
      region.className = `ac-wave-region${selected ? " is-selected" : ""}`;
      region.dataset.sustain = loop.id;
      region.style.left = `${this.#pct(range.from)}%`;
      region.style.width = `${Math.max(1, this.#pct(range.to - range.from))}%`;

      const label = document.createElement("span");
      label.className = "ac-wave-region-label";
      label.textContent = loop.name || localize(`Mode.${loop.mode}`);
      region.appendChild(label);

      if ( selected ) {
        for ( const edge of ["start", "end"] ) {
          const handle = document.createElement("div");
          handle.className = `ac-wave-handle ac-wave-handle-${edge}`;
          handle.dataset.edge = edge;
          region.appendChild(handle);
        }
      }

      region.addEventListener("pointerdown", event => this.#dragSustain(event, loop, lane));
      lane.appendChild(region);
    }
  }

  #dragSustain(event, loop, lane) {
    event.preventDefault();
    event.stopPropagation();

    if ( this.selectedId !== loop.id ) {
      this.selectedId = loop.id;
      this.render({ parts: ["body"] });
      return;
    }

    const edge = event.target?.dataset?.edge ?? null;
    if ( !edge ) return;

    const duration = Math.max(0.001, this.duration);
    const rect = lane.getBoundingClientRect();
    const startX = event.clientX;
    const origin = sustainOf(loop);
    const minSpan = duration / Math.max(1, this.frameCount);

    const onMove = moveEvent => {
      const delta = ((moveEvent.clientX - startX) / rect.width) * duration;
      const next = sustainOf(loop);
      if ( edge === "start" ) next.from = Math.max(0, Math.min(origin.from + delta, next.to - minSpan));
      else next.to = Math.min(duration, Math.max(origin.to + delta, next.from + minSpan));
      loop.audio.from = next.from;
      loop.audio.to = next.to;
      const region = lane.querySelector(`[data-sustain='${loop.id}']`);
      if ( region ) {
        region.style.left = `${this.#pct(next.from)}%`;
        region.style.width = `${Math.max(1, this.#pct(next.to - next.from))}%`;
      }
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      this.render({ parts: ["body"] });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  #soundReason() {
    if ( this.audioState === AUDIO_STATE.silent ) return localize("Editor.SoundSilent");
    if ( this.audioState === AUDIO_STATE.tooLong ) {
      return localize("Editor.SoundTooLong", { seconds: maxBufferSeconds() });
    }
    if ( this.audioState === AUDIO_STATE.unreadable ) return localize("Editor.SoundUnreadable");
    return "";
  }

  #sustainLabel(loop) {
    const range = sustainOf(loop);
    return localize("Editor.SustainSpan", { span: (range.to - range.from).toFixed(2) });
  }

  #renderTimeline(root) {
    const timeline = root.querySelector("[data-timeline]");
    const strip = root.querySelector("[data-filmstrip]");
    const lane = root.querySelector("[data-lane]");
    const ruler = root.querySelector("[data-ruler]");
    if ( !timeline || !strip || !lane ) return;

    timeline.style.width = `${ZOOM_STEPS[this.zoomStep] * 100}%`;

    const count = this.frameCount;
    strip.replaceChildren();
    ruler?.replaceChildren();

    const aspect = (this.baked?.frameW && this.baked?.frameH) ? (this.baked.frameW / this.baked.frameH) : 1;
    const thumbWidth = Math.max(2, Math.round(STRIP_HEIGHT * aspect));
    for ( let i = 0; i < count; i++ ) {
      const cell = document.createElement("canvas");
      cell.width = thumbWidth;
      cell.height = STRIP_HEIGHT;
      cell.className = "ac-strip-cell";
      cell.dataset.frame = String(i);
      this.#drawFrame(cell.getContext("2d"), i, thumbWidth, STRIP_HEIGHT);
      strip.appendChild(cell);
    }

    if ( ruler ) {
      const seconds = Math.floor(this.duration);
      for ( let s = 0; s <= seconds; s++ ) {
        const tick = document.createElement("div");
        tick.className = "ac-tick";
        tick.style.left = `${(s / Math.max(0.001, this.duration)) * 100}%`;
        tick.textContent = `${s}s`;
        ruler.appendChild(tick);
      }
    }

    this.#renderTrim(root);
    this.#renderLoops(lane);
    this.#renderWave(root);
    this.#paintGhost(root);

    const wrap = root.querySelector(".ac-timeline-wrap");
    if ( wrap ) {
      wrap.scrollLeft = this.timelineScrollLeft ?? 0;
      wrap.addEventListener("scroll", () => { this.timelineScrollLeft = wrap.scrollLeft; });
    }
  }

  #pct(seconds) {
    return (seconds / Math.max(0.001, this.duration)) * 100;
  }

  #renderTrim(root) {
    const layer = root.querySelector("[data-trim]");
    if ( !layer ) return;
    layer.replaceChildren();

    const from = clipStart(this.profile);
    const to = clipEnd(this.profile);

    const head = document.createElement("div");
    head.className = "ac-trim-shade";
    head.style.left = "0%";
    head.style.width = `${this.#pct(from)}%`;
    layer.appendChild(head);

    const tail = document.createElement("div");
    tail.className = "ac-trim-shade";
    tail.style.left = `${this.#pct(to)}%`;
    tail.style.right = "0";
    layer.appendChild(tail);

    for ( const [edge, time] of [["from", from], ["to", to]] ) {
      const handle = document.createElement("div");
      handle.className = `ac-trim-handle ac-trim-${edge}`;
      handle.style.left = `${this.#pct(time)}%`;
      handle.dataset.trim = edge;
      handle.addEventListener("pointerdown", event => this.#dragTrim(event, edge, layer));
      layer.appendChild(handle);
    }
  }

  #dragTrim(event, edge, layer) {
    event.preventDefault();
    event.stopPropagation();
    const rect = layer.getBoundingClientRect();
    const duration = Math.max(0.001, this.duration);
    const step = duration / Math.max(1, this.frameCount);

    const onMove = moveEvent => {
      const t = ((moveEvent.clientX - rect.left) / rect.width) * duration;
      if ( edge === "from" ) this.profile.from = Math.max(0, Math.min(t, clipEnd(this.profile) - step));
      else this.profile.to = Math.min(duration, Math.max(t, clipStart(this.profile) + step));
      this.#renderTrim(this.element);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      this.render({ parts: ["body"] });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  #renderLoops(lane) {
    lane.replaceChildren();

    for ( const loop of this.loops ) {
      const block = document.createElement("div");
      block.className = `ac-segment${loop.id === this.selectedId ? " is-selected" : ""}`;
      if ( loop.engage === ENGAGE.jump ) block.classList.add("ac-segment-jump");
      block.dataset.segment = loop.id;
      block.dataset.release = loop.release ?? RELEASE.carryOn;
      block.style.left = `${this.#pct(loop.from)}%`;

      if ( loop.mode === LOOP_MODE.pause ) {
        block.classList.add("ac-segment-pause");
        block.dataset.tooltip = loop.name || localize("Mode.pause");
        block.innerHTML = '<i class="fa-solid fa-pause" inert></i>';
        block.addEventListener("pointerdown", event => this.#dragLoop(event, loop, lane));
        lane.appendChild(block);
        continue;
      }

      block.style.width = `${Math.max(1, this.#pct(loop.to - loop.from))}%`;

      const label = document.createElement("span");
      label.className = "ac-segment-label";
      label.textContent = loop.name || localize(`Mode.${loop.mode}`);
      block.appendChild(label);

      for ( const edge of ["start", "end"] ) {
        const handle = document.createElement("div");
        handle.className = `ac-segment-handle ac-segment-handle-${edge}`;
        handle.dataset.edge = edge;
        block.appendChild(handle);
      }

      block.addEventListener("pointerdown", event => this.#dragLoop(event, loop, lane));
      lane.appendChild(block);
    }
  }

  #dragLoop(event, loop, lane) {
    event.preventDefault();
    event.stopPropagation();

    if ( this.selectedId !== loop.id ) {
      this.selectedId = loop.id;
      this.render({ parts: ["body"] });
      return;
    }

    const edge = event.target?.dataset?.edge ?? null;
    const duration = Math.max(0.001, this.duration);
    const rect = lane.getBoundingClientRect();
    const startX = event.clientX;
    const originFrom = loop.from;
    const originTo = loop.to;
    const minSpan = duration / Math.max(1, this.frameCount);

    const onMove = moveEvent => {
      const delta = ((moveEvent.clientX - startX) / rect.width) * duration;
      if ( edge === "start" ) loop.from = Math.max(0, Math.min(originFrom + delta, loop.to - minSpan));
      else if ( edge === "end" ) loop.to = Math.min(duration, Math.max(originTo + delta, loop.from + minSpan));
      else {
        const span = originTo - originFrom;
        const shifted = Math.max(0, Math.min(originFrom + delta, duration - span));
        loop.from = shifted;
        loop.to = shifted + span;
      }
      const block = lane.querySelector(`[data-segment='${loop.id}']`);
      if ( block ) {
        block.style.left = `${this.#pct(loop.from)}%`;
        if ( loop.mode !== LOOP_MODE.pause ) block.style.width = `${Math.max(1, this.#pct(loop.to - loop.from))}%`;
      }
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      this.render({ parts: ["body"] });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  #paintGhost(root) {
    const lane = root.querySelector("[data-lane]");
    if ( !lane ) return;
    lane.querySelector(".ac-ghost")?.remove();
    const candidate = this.hoverCandidate;
    if ( !candidate ) return;

    const ghost = document.createElement("div");
    ghost.className = "ac-ghost";
    ghost.style.left = `${this.#pct(this.#indexToTime(candidate.start))}%`;
    ghost.style.width = `${Math.max(1, this.#pct(this.#indexToTime(candidate.end) - this.#indexToTime(candidate.start)))}%`;
    lane.appendChild(ghost);
  }

  #startPreview(root) {
    const canvas = root.querySelector("[data-preview]");
    const seamCanvas = root.querySelector("[data-seam-preview]");
    const playhead = root.querySelector("[data-playhead]");
    if ( !canvas ) return;

    this.#fitCanvas(canvas);
    this.#fitCanvas(seamCanvas);

    const ctx = canvas.getContext("2d");
    const seamCtx = seamCanvas?.getContext("2d") ?? null;
    const started = performance.now();

    const tick = now => {
      const hover = this.hoverCandidate;
      const loop = this.selected;
      const from = hover ? this.#indexToTime(hover.start) : (loop ? loop.from : clipStart(this.profile));
      const to = hover ? this.#indexToTime(hover.end) : (loop ? loop.to : clipEnd(this.profile));

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const mode = hover ? LOOP_MODE.loop : (loop?.mode ?? LOOP_MODE.loop);
      const time = this.run
        ? this.#drawRun(ctx, canvas)
        : this.#drawScrub(ctx, canvas, from, to, now - started, mode);

      if ( seamCtx ) {
        const flip = (((now - started) / 900) % 2) < 1;
        seamCtx.clearRect(0, 0, seamCanvas.width, seamCanvas.height);
        this.#drawFrame(seamCtx, this.#timeToIndex(flip ? to : from), seamCanvas.width, seamCanvas.height);
      }

      if ( playhead ) {
        const running = !!this.run;
        if ( playhead.hidden === running ) playhead.hidden = !running;
        if ( running ) playhead.style.left = `${this.#pct(time)}%`;
      }
      this.rafHandle = requestAnimationFrame(tick);
    };

    this.rafHandle = requestAnimationFrame(tick);
  }

  #drawScrub(ctx, canvas, from, to, elapsedMs, mode) {
    const span = Math.max(0.001, to - from);
    const bounce = mode === LOOP_MODE.pingpong;
    const clip = (elapsedMs / 1000) * clampRate(this.profile?.rate);
    const phase = clip % (bounce ? span * 2 : span);
    const time = from + ((bounce && (phase > span)) ? (span * 2) - phase : phase);
    this.#drawFrame(ctx, this.#timeToIndex(time), canvas.width, canvas.height);
    return time;
  }

  #drawRun(ctx, canvas) {
    const { controller, target } = this.run;
    controller.advance(performance.now());

    const frame = controller.frameCanvas;
    const mesh = target.mesh;
    if ( frame && mesh ) {
      const width = canvas.width * mesh.scale.x;
      const height = canvas.height * mesh.scale.y;
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(mesh.alpha, 1));
      ctx.drawImage(frame, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
      ctx.restore();
    }

    const status = this.run.statusEl;
    if ( status ) {
      const text = this.#runStatus(controller);
      if ( status.textContent !== text ) status.textContent = text;
    }
    return controller.shownTime;
  }

  async #startRun(root, { at = null } = {}) {
    this.#stopRun();
    if ( !this.profile?.baked ) return;

    const mesh = {
      alpha: 1,
      unoccludedAlpha: 1,
      texture: null,
      scale: { x: 1, y: 1, set(x, y) { this.x = x; this.y = y; } }
    };
    const target = { texture: null, mesh };
    const controller = new AnimationController(target, this.profile);

    let started = false;
    try {
      started = await controller.attach();
    } catch (err) {
      moduleWarn("preview run failed to start", err);
    }

    if ( !started || !this.element?.isConnected ) {
      controller.destroy();
      if ( !started ) ui.notifications?.warn(localize("Editor.RunFailed"));
      return;
    }

    if ( Number.isFinite(at) && (at > 0) ) controller.resumeAt(at);

    this.run = { controller, target, statusEl: null };
    controller.onStateChange = state => {
      if ( this.repeat && state?.ended ) controller.command(ACTION.restart);
      this.#renderTransport(root);
    };
    this.#renderTransport(root);
  }

  #stopRun() {
    const run = this.run;
    this.run = null;
    if ( !run ) return;
    try {
      run.controller.destroy();
    } catch (err) {
      moduleWarn("preview run teardown", err);
    }
  }

  #runStatus(controller) {
    if ( controller.idle ) return localize("Editor.RunIdle");
    if ( controller.ended ) return localize("Editor.RunEnded");
    if ( controller.paused ) return localize("Editor.RunPaused");
    const loop = controller.lockedLoop;
    if ( loop ) return localize("Editor.RunHeld", { name: loop.name || localize("Editor.RunUnnamed") });
    return localize("Editor.RunPlaying");
  }

  // built in place since a re-render kills the preview
  #renderTransport(root) {
    const bar = root?.querySelector("[data-transport]");
    if ( !bar ) return;
    bar.replaceChildren();

    const controller = this.run?.controller ?? null;
    const ended = !!controller?.ended;

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "ac-button ac-button-primary";
    const toggleIcon = document.createElement("i");
    toggleIcon.className = "fa-solid " + (!controller ? "fa-play" : (ended ? "fa-rotate-right" : "fa-stop"));
    toggle.dataset.tooltip = localize("Editor.RunHint");
    toggle.append(toggleIcon, localize(!controller ? "Editor.RunStart" : (ended ? "Editor.RunAgain" : "Editor.RunStop")));
    toggle.addEventListener("click", () => {
      if ( !this.run ) return this.#startRun(root);
      if ( this.run.controller.ended ) this.run.controller.command(ACTION.restart);
      else this.#stopRun();
      this.#renderTransport(root);
    });
    bar.appendChild(toggle);

    const repeat = document.createElement("button");
    repeat.type = "button";
    repeat.className = "ac-icon-button" + (this.repeat ? " ac-icon-on" : "");
    repeat.dataset.tooltip = localize("Editor.Repeat");
    repeat.setAttribute("aria-label", localize("Editor.Repeat"));
    const repeatIcon = document.createElement("i");
    repeatIcon.className = "fa-solid fa-repeat";
    repeat.appendChild(repeatIcon);
    repeat.addEventListener("click", () => {
      this.repeat = !this.repeat;
      if ( this.repeat && this.run?.controller?.ended ) this.run.controller.command(ACTION.restart);
      this.#renderTransport(root);
    });
    bar.appendChild(repeat);

    if ( !controller ) return;

    for ( const spec of buttonsFor(controller) ) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "ac-icon-button" + (spec.active ? " ac-icon-on" : "");
      button.dataset.tooltip = spec.tooltip;
      button.setAttribute("aria-label", spec.tooltip);
      const icon = document.createElement("i");
      icon.className = "fa-solid " + spec.icon;
      button.appendChild(icon);
      button.addEventListener("click", () => {
        controller.command(spec.action, spec.payload ?? {});
        this.#renderTransport(root);
      });
      bar.appendChild(button);
    }

    const status = document.createElement("span");
    status.className = "ac-transport-status";
    status.textContent = this.#runStatus(controller);
    bar.appendChild(status);
    this.run.statusEl = status;
  }

  #stopPreview() {
    if ( this.rafHandle ) cancelAnimationFrame(this.rafHandle);
    this.rafHandle = null;
  }

  async _preClose(options) {
    this.#stopPreview();
    this.#stopRun();
    EditorApp.#open.delete(this);
    return super._preClose?.(options);
  }

  static async #onAnalyze() {
    if ( this.busy ) return;
    this.busy = { progress: 0, label: localize("Editor.Preparing") };
    await this.render({ parts: ["body"] });
    try {
      await prepareAsset(this.src, {
        onProgress: info => {
          this.busy = { progress: Math.round((info.progress ?? 0) * 100), label: info.label ?? localize("Editor.Preparing") };
        }
      });
      this.profile = composeProfile(this.src, behaviorOf(this.profile));
      this.sheet = null;
      this.signatures = [];
      this.seamCache = null;
      this.times = [];
      this.inspected = false;
      this.peaks = null;
      this.audioState = null;
      this.audioDuration = 0;
    } catch (err) {
      moduleWarn("analyze failed", err);
      ui.notifications.error(err.message ?? localize("Errors.PrepareFailed"));
    } finally {
      this.busy = null;
      await this.render({ parts: ["body"] });
    }
  }

  static async #onFindLoops() {
    if ( !this.signatures.length ) return;
    this.candidates = findLoops(this.signatures, { cache: this.seamCache, limit: 4 });
    await this.render({ parts: ["body"] });
  }

  #applyTo(loop, candidate) {
    loop.from = this.#indexToTime(candidate.start);
    loop.to = this.#indexToTime(candidate.end);
    loop.mode = LOOP_MODE.loop;
    loop.seam = candidate.score >= 0.85 ? SEAM.cut : SEAM.blend;
    loop.blendFrames = suggestBlendFrames(candidate.score, this.frameCount) || DEFAULTS.blendFrames;
  }

  static async #onApplyCandidate(event, target) {
    const candidate = this.candidates[Number(target.dataset.candidate)];
    const loop = this.selected;
    if ( !candidate || !loop ) return;
    this.#applyTo(loop, candidate);
    this.hoverCandidate = null;
    await this.render({ parts: ["body"] });
  }

  static async #onAddCandidate(event, target) {
    const candidate = this.candidates[Number(target.dataset.candidate)];
    if ( !candidate || !this.profile ) return;
    const loop = makeLoop({});
    this.#applyTo(loop, candidate);
    this.profile.loops.push(loop);
    this.selectedId = loop.id;
    this.hoverCandidate = null;
    await this.render({ parts: ["body"] });
  }

  static #onToggleSection(event, target) {
    const key = target.dataset.section;
    if ( !key ) return;
    if ( this.collapsedSections.has(key) ) this.collapsedSections.delete(key);
    else this.collapsedSections.add(key);
    target.closest(".ac-section")?.classList.toggle("is-collapsed");
  }

  static async #onAddLoop() {
    if ( !this.profile ) return;
    const from = this.selected ? this.selected.to : clipStart(this.profile);
    const loop = makeLoop({
      from,
      to: Math.min(clipEnd(this.profile), from + Math.max(0.2, this.duration * 0.15))
    });
    this.profile.loops.push(loop);
    this.selectedId = loop.id;
    await this.render({ parts: ["body"] });
  }

  static async #onAddPause() {
    if ( !this.profile ) return;
    const start = clipStart(this.profile);
    const end = clipEnd(this.profile);
    const at = this.run?.controller?.shownTime ?? (start + ((end - start) / 2));
    const loop = makeLoop({ mode: LOOP_MODE.pause, from: Math.min(end, Math.max(start, at)) });
    this.profile.loops.push(loop);
    this.selectedId = loop.id;
    await this.render({ parts: ["body"] });
  }

  static async #onDeleteLoop() {
    const loops = this.loops;
    const index = loops.findIndex(l => l.id === this.selectedId);
    if ( index < 0 ) return;
    loops.splice(index, 1);
    this.selectedId = loops[Math.max(0, index - 1)]?.id ?? null;
    await this.render({ parts: ["body"] });
  }

  static async #onClearTrim() {
    if ( !this.profile ) return;
    this.profile.from = null;
    this.profile.to = null;
    await this.render({ parts: ["body"] });
  }

  static async #onSave() {
    if ( !this.profile ) return;
    try {
      if ( this.surface ) {
        await saveSurfaceBehavior(this.surface.document, this.surface.kind, behaviorOf(this.profile));
      }
      else if ( this.doc ) await this.doc.setFlag(MODULE_ID, FLAGS.profile, behaviorOf(this.profile));
      else throw new Error("editor has no document to save to");
      ui.notifications.info(localize("Editor.Saved"));
    } catch (err) {
      moduleWarn("save failed", err);
      ui.notifications.error(localize("Errors.SaveFailed"));
    }
  }

  static async #onReset() {
    if ( !this.profile ) return;
    this.profile.from = null;
    this.profile.to = null;
    this.profile.loops = [];
    this.selectedId = null;
    this.candidates = [];
    await this.render({ parts: ["body"] });
  }

  static #onZoomIn() {
    this.zoomStep = Math.min(ZOOM_STEPS.length - 1, this.zoomStep + 1);
    this.render({ parts: ["body"] });
  }

  static #onZoomOut() {
    this.zoomStep = Math.max(0, this.zoomStep - 1);
    this.render({ parts: ["body"] });
  }

  static #onZoomReset() {
    this.zoomStep = 0;
    this.timelineScrollLeft = 0;
    this.render({ parts: ["body"] });
  }
}

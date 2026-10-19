import { MODULE_ID, FLAGS, ACTION, moduleWarn } from "./constants.js";
import { AnimationController } from "./scheduler.js";
import { BakedFrameSource } from "./frame-source.js";
import { composeProfile } from "./profiles.js";
import { currentSurfaces, retireSurfaces } from "./scene-surface.js";

let tracing = false;

export function setTrace(on) {
  tracing = !!on;
  return tracing;
}

function trace(...args) {
  if ( tracing ) console.log(MODULE_ID + " |", ...args);
}

const controllers = new Map();
const pending = new Map();
let tickerAttached = false;

// config previews share the document id so don't register them
export function isPreviewPlaceable(placeable) {
  if ( !placeable ) return false;
  return !!placeable._original || (placeable.isPreview === true);
}

function registryKey(placeable) {
  const doc = placeable?.document;
  if ( !doc ) return null;
  if ( isPreviewPlaceable(placeable) ) return null;
  if ( placeable.isSurface ) return `${doc.documentName}:${placeable.id}`;
  return `${doc.documentName}:${doc.id ?? placeable.id}`;
}

function sourceOf(placeable) {
  if ( placeable?.isSurface ) return placeable.src ?? null;
  return placeable?.document?.texture?.src ?? null;
}

export function resolveProfile(placeable) {
  if ( placeable?.isSurface ) return placeable.profile();

  const doc = placeable?.document;
  if ( !doc ) return null;
  if ( doc.getFlag(MODULE_ID, FLAGS.disabled) ) return null;

  const src = sourceOf(placeable);
  if ( !src ) return null;

  const behavior = doc.getFlag(MODULE_ID, FLAGS.profile);
  if ( !behavior || (typeof behavior !== "object") ) return null;

  return composeProfile(src, behavior);
}

export function controllerFor(placeable) {
  const key = registryKey(placeable);
  return key ? controllers.get(key) ?? null : null;
}

export function allControllers() {
  return Array.from(controllers.values());
}

export async function attachTo(placeable) {
  const key = registryKey(placeable);
  if ( !key ) return null;

  const previous = pending.get(key) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(() => doAttach(placeable, key));
  pending.set(key, next);

  try {
    return await next;
  } finally {
    if ( pending.get(key) === next ) pending.delete(key);
  }
}

async function doAttach(placeable, key) {
  trace("attach requested", key);
  const existing = controllers.get(key);
  if ( existing ) {
    trace("replacing an existing controller", key);
    existing.destroy();
    controllers.delete(key);
  }

  if ( placeable.destroyed ) {
    trace("bail: placeable already destroyed", key);
    return null;
  }

  const profile = resolveProfile(placeable);
  if ( !profile ) {
    trace("bail: no profile", key);
    return null;
  }
  if ( placeable.isSurface ) await placeable.reloadIfFailed();

  const state = placeable.isSurface
    ? placeable.state
    : (placeable.document.getFlag(MODULE_ID, FLAGS.state) ?? {});
  const controller = new AnimationController(placeable, profile, controllerOptions(state));
  controller.onStateChange = next => rememberState(placeable, next);
  try {
    const ok = await controller.attach();
    if ( !ok || placeable.destroyed ) {
      trace("bail after load", key, { ok, destroyed: placeable.destroyed });
      controller.destroy();
      return null;
    }
    controllers.set(key, controller);
    ensureTicker();
    trace("attached", key, controller.lockedLoop?.name || "playing");
    Hooks.callAll(`${MODULE_ID}.attached`, placeable);
    return controller;
  } catch (err) {
    controller.destroy();
    moduleWarn(`could not attach to ${key}`, err);
    return null;
  }
}

function controllerOptions(state) {
  return {
    startLoopId: state.loopId ?? null,
    startIdle: (typeof state.idle === "boolean") ? state.idle : null,
    startedClock: Number(state.startedClock) || 0,
    startPaused: state.paused === true,
    startReversed: (typeof state.reversed === "boolean") ? state.reversed : null,
    startPlayhead: Number.isFinite(state.playhead) ? state.playhead : null,
    startShown: Number.isFinite(state.shown) ? state.shown : null,
    startLoopClock: Number.isFinite(state.loopClock) ? state.loopClock : null,
    startLockedAt: Number.isFinite(state.lockedAt) ? state.lockedAt : null,
    startLockedRound: Number.isFinite(state.lockedRound) ? state.lockedRound : null,
    startEnded: state.ended === true,
    startLoopShift: Number.isFinite(state.loopShift) ? state.loopShift : 0
  };
}

export async function explainAttach(placeable) {
  if ( !registryKey(placeable) ) return "no document";
  if ( placeable.destroyed ) return "placeable is destroyed";
  if ( placeable.document.getFlag(MODULE_ID, FLAGS.disabled) ) return "turned off on this object";

  const profile = resolveProfile(placeable);
  if ( !profile ) return "no saved profile for this file";


  if ( profile.baked ) {
    const source = new BakedFrameSource(profile.baked);
    try {
      await source.load();
      source.destroy();
    } catch (err) {
      return "frame sheet did not load: " + err.message;
    }
    return "should attach from frames";
  }

  if ( !game.video?.getVideoSource?.(placeable.texture) ) return "no video source on this placeable";
  return "should attach from the video";
}

export function detachFrom(placeable) {
  const key = registryKey(placeable);
  if ( !key ) return false;
  const controller = controllers.get(key);
  if ( !controller ) return false;
  trace("detach", key);
  controller.destroy();
  controllers.delete(key);
  return true;
}

export function detachAll() {
  for ( const controller of controllers.values() ) controller.destroy();
  controllers.clear();
  retireSurfaces();
  removeTicker();
}

function onTick() {
  const now = performance.now();
  for ( const controller of controllers.values() ) {
    try {
      controller.advance(now);
    } catch (err) {
      moduleWarn("controller tick failed", err);
    }
  }
}

function ensureTicker() {
  if ( tickerAttached || !canvas?.app?.ticker ) return;
  canvas.app.ticker.add(onTick, null, PIXI.UPDATE_PRIORITY.LOW);
  tickerAttached = true;
}

function removeTicker() {
  if ( !tickerAttached ) return;
  canvas?.app?.ticker?.remove(onTick, null);
  tickerAttached = false;
}

export function attachableNow() {
  return [
    ...(canvas?.tiles?.placeables ?? []),
    ...(canvas?.tokens?.placeables ?? []),
    ...currentSurfaces()
  ];
}

export function reattachAll() {
  const placeables = attachableNow();
  for ( const placeable of placeables ) {
    attachTo(placeable).catch(err => moduleWarn("reattach failed", err));
  }
}

export function commandPlaceable(placeable, action, payload = {}) {
  return controllerFor(placeable)?.command(action, payload) ?? false;
}

// run locally first since Foundry merges rapid writes
export async function issueCommand(placeable, action, payload = {}) {
  const doc = placeable?.document;
  if ( !doc ) return false;

  const applied = commandPlaceable(placeable, action, payload);
  if ( !game.user.isGM ) return applied;

  const next = {
    action,
    payload,
    at: Date.now(),
    by: game.user.id
  };
  try {
    if ( placeable.isSurface ) await placeable.saveState(next);
    else await writeState(doc, next);
  } catch (err) {
    moduleWarn("could not broadcast the command", err);
  }
  return applied;
}

function writeState(doc, state) {
  return doc.update({ [`flags.${MODULE_ID}.${FLAGS.state}`]: state }, { render: false });
}

function rememberState(placeable, { loopId, idle, ended, startedClock, paused, reversed, playhead, shown, loopClock, lockedAt, lockedRound, loopShift } = {}) {
  if ( !game.user.isGM ) return;
  const doc = placeable?.document;
  if ( !doc ) return;

  const held = (!idle && !ended) ? (loopId ?? null) : null;
  const current = placeable.isSurface
    ? placeable.state
    : (doc.getFlag(MODULE_ID, FLAGS.state) ?? {});
  if ( ((current.loopId ?? null) === held)
    && ((current.idle ?? null) === !!idle)
    && ((current.ended ?? false) === (!idle && !!ended))
    && ((current.paused ?? false) === !!paused)
    && ((current.reversed ?? null) === (reversed ?? null))
    && (Math.abs((Number(current.startedClock) || 0) - (Number(startedClock) || 0)) < 50) ) return;

  // setFlag merges so missing keys keep the old command
  const next = {
    loopId: held,
    idle: !!idle,
    ended: !idle && !!ended,
    startedClock: Number(startedClock) || 0,
    paused: !!paused,
    reversed: reversed ?? null,
    playhead: Number.isFinite(playhead) ? Number(playhead) : null,
    shown: Number.isFinite(shown) ? Number(shown) : null,
    loopClock: Number.isFinite(loopClock) ? Number(loopClock) : null,
    lockedAt: (held && Number.isFinite(lockedAt)) ? Number(lockedAt) : null,
    lockedRound: (held && Number.isFinite(lockedRound)) ? Number(lockedRound) : null,
    loopShift: (held && Number.isFinite(loopShift)) ? Number(loopShift) : null,
    action: null,
    payload: null,
    by: null,
    at: 0
  };
  const written = placeable.isSurface
    ? placeable.saveState(next)
    : writeState(doc, next);
  written.catch(err => moduleWarn("could not record the animation state", err));
}

function bindType(type) {
  Hooks.on(`draw${type}`, placeable => {
    attachTo(placeable).catch(err => moduleWarn("attach failed", err));
  });

  Hooks.on(`refresh${type}`, placeable => {
    controllerFor(placeable)?.reassert();
  });

  Hooks.on(`destroy${type}`, placeable => {
    detachFrom(placeable);
  });
}

export function registerPlaceableHooks() {
  bindType("Tile");
  bindType("Token");

  const onUpdate = (doc, changed, options, userId) => {
    const ours = changed?.flags?.[MODULE_ID];
    const placeable = doc.object;
    if ( !placeable ) return;

    if ( ours && (FLAGS.state in ours) && !("texture" in (changed ?? {})) ) {
      const state = ours[FLAGS.state] ?? {};
      if ( !state.action ) return;
      if ( userId === game.user.id ) return;
      if ( commandPlaceable(placeable, state.action, state.payload ?? {}) ) return;
    }

    const touchesUs = ("texture" in (changed ?? {})) || !!ours;
    if ( !touchesUs ) return;
    trace("update triggered a reattach", Object.keys(changed ?? {}));
    attachTo(placeable).catch(err => moduleWarn("reattach failed", err));
  };

  Hooks.on("updateTile", onUpdate);
  Hooks.on("updateToken", onUpdate);

  Hooks.on("canvasTearDown", () => {
    trace("canvas tear down");
    detachAll();
  });
  Hooks.on("canvasReady", () => {
    for ( const placeable of attachableNow() ) {
      attachTo(placeable).catch(err => moduleWarn("attach on canvas ready failed", err));
    }
  });

  const onSurfaceUpdate = (doc, changed, options, userId) => {
    const ours = changed?.flags?.[MODULE_ID]?.[FLAGS.sceneProfile];
    const imageChanged = ("background" in (changed ?? {})) || ("foreground" in (changed ?? {}));
    if ( !imageChanged && !changed?.flags?.[MODULE_ID] ) return;
    const scene = (doc?.documentName === "Level") ? doc.parent : doc;
    if ( scene && (scene.id !== canvas?.scene?.id) ) return;

    const changedStates = (!imageChanged && ours && ("state" in ours)
      && (Object.keys(ours).length === 1)) ? (ours.state ?? {}) : null;

    for ( const surface of currentSurfaces() ) {
      if ( changedStates ) {
        const state = changedStates[surface.kind];
        if ( !state?.action ) continue;
        if ( userId === game.user.id ) continue;
        if ( commandPlaceable(surface, state.action, state.payload ?? {}) ) continue;
      }
      detachFrom(surface);
      attachTo(surface).catch(err => moduleWarn("surface reattach failed", err));
    }
  };

  Hooks.on("updateScene", onSurfaceUpdate);
  Hooks.on("updateLevel", onSurfaceUpdate);
}

export function actionsFor(placeable) {
  const controller = controllerFor(placeable);
  if ( !controller ) return null;
  const loop = controller.lockedLoop;
  return {
    idle: controller.idle,
    loopId: loop?.id ?? null,
    loopName: loop?.name ?? "",
    loopCount: controller.loops.length,
    paused: controller.paused,
    reversed: controller.reversed,
    ended: controller.ended,
    canContinue: controller.canContinue,
    canReverse: controller.isBaked,
    fadedOut: controller.fadedOut,
    actions: ACTION
  };
}

export function restart(placeable) {
  return issueCommand(placeable, ACTION.restart);
}

export function goToLoop(placeable, loopId) {
  return issueCommand(placeable, ACTION.goto, { loopId });
}

export function continuePlayback(placeable) {
  return issueCommand(placeable, ACTION.continue);
}

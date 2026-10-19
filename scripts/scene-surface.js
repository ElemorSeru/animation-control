import { MODULE_ID, FLAGS, localize } from "./constants.js";
import { composeProfile } from "./profiles.js";
import { loadCanvasTexture } from "./compat.js";

export const SURFACE_KINDS = ["background", "foreground"];

// on Level in v14, the v12/v13 foreground is just a path
export function surfaceSource(doc, kind) {
  if ( !doc ) return null;
  const value = doc[kind];
  if ( typeof value === "string" ) return value || null;
  return value?.src || null;
}

function isShowable(texture) {
  return !!texture?.valid && (texture !== PIXI.Texture.EMPTY);
}

export function isLevelDocument(doc) {
  return doc?.documentName === "Level";
}

export function activeSurfaceDocument(scene = null) {
  const target = scene ?? canvas?.scene ?? null;
  if ( !target ) return null;
  if ( !target.levels ) return target;
  return canvas?.level ?? target.initialLevel ?? target.firstLevel ?? target;
}

export function surfaceLabel(doc, kind) {
  const which = localize(`Scene.Kind_${kind}`);
  if ( !isLevelDocument(doc) ) return which;
  return `${doc.name || localize("Scene.UnnamedLevel")}: ${which}`;
}

function storedProfiles(doc) {
  const stored = doc?.getFlag?.(MODULE_ID, FLAGS.sceneProfile);
  return (stored && (typeof stored === "object")) ? stored : {};
}

export function surfaceBehavior(doc, kind) {
  const behavior = storedProfiles(doc)[kind];
  return (behavior && (typeof behavior === "object")) ? behavior : null;
}

export async function saveSurfaceBehavior(doc, kind, behavior) {
  const stored = { ...storedProfiles(doc) };
  if ( behavior ) stored[kind] = behavior;
  else delete stored[kind];
  return doc.setFlag(MODULE_ID, FLAGS.sceneProfile, stored);
}

export function surfaceState(doc, kind) {
  const all = storedProfiles(doc).state;
  const state = (all && (typeof all === "object")) ? all[kind] : null;
  return (state && (typeof state === "object")) ? state : {};
}

export async function saveSurfaceState(doc, kind, state) {
  const stored = { ...storedProfiles(doc) };
  stored.state = { ...(stored.state ?? {}), [kind]: state };
  return doc.update({ [`flags.${MODULE_ID}.${FLAGS.sceneProfile}`]: stored }, { render: false });
}

let surfaceGeneration = 0;
export function retireSurfaces() {
  surfaceGeneration++;
}

export class SceneSurface {
  constructor(doc, kind) {
    this.document = doc;
    this.kind = kind;
    this.isSurface = true;
    this.generation = surfaceGeneration;
  }

  // v14 default levels share one id across scenes
  get id() {
    const own = `${this.document?.id ?? "scene"}:${this.kind}`;
    return isLevelDocument(this.document) ? `${this.scene?.id ?? "scene"}.${own}` : own;
  }

  get scene() {
    return isLevelDocument(this.document) ? (this.document.parent ?? null) : this.document;
  }

  get destroyed() {
    if ( this.generation !== surfaceGeneration ) return true;
    if ( this.scene?.id !== canvas?.scene?.id ) return true;
    return isLevelDocument(this.document) && !!canvas?.level && (canvas.level.id !== this.document.id);
  }

  get src() {
    return surfaceSource(this.document, this.kind);
  }

  get label() {
    return surfaceLabel(this.document, this.kind);
  }

  get mesh() {
    if ( this.destroyed ) return null;
    const mesh = canvas?.primary?.[this.kind];
    return (mesh && !mesh.destroyed) ? mesh : null;
  }

  get texture() {
    return this.mesh?.texture ?? null;
  }

  set texture(value) {
    const mesh = this.mesh;
    if ( !mesh ) return;
    mesh.texture = value;
    // core decides this only once while drawing
    mesh.visible = isShowable(value);
  }

  // core hides a background whose first load failed and doesn't try again
  async reloadIfFailed() {
    const mesh = this.mesh;
    if ( !mesh || isShowable(mesh.texture) || !this.src ) return;
    const texture = await loadCanvasTexture(this.src).catch(() => null);
    if ( (this.mesh !== mesh) || mesh.destroyed || !isShowable(texture) ) return;
    this.texture = texture;
  }

  get behavior() {
    return surfaceBehavior(this.document, this.kind);
  }

  get disabled() {
    return !!storedProfiles(this.document).disabled?.[this.kind];
  }

  get state() {
    return surfaceState(this.document, this.kind);
  }

  saveState(state) {
    return saveSurfaceState(this.document, this.kind, state);
  }

  profile() {
    const src = this.src;
    if ( !src || this.disabled ) return null;
    const behavior = this.behavior;
    if ( !behavior ) return null;
    return composeProfile(src, behavior);
  }
}

export function currentSurfaces(scene = null) {
  const doc = activeSurfaceDocument(scene);
  if ( !doc ) return [];
  return SURFACE_KINDS
    .map(kind => new SceneSurface(doc, kind))
    .filter(surface => !!surface.src);
}

import { CATALOG_FILE, STATUS, moduleWarn } from "./constants.js";
import { browseSource, browseStorage, ensureStorageDir, uploadPersistent } from "./compat.js";
import { extensionOf, kindForExtension } from "./decode/index.js";
import { probeMedia } from "./probe.js";
import { assetKey, keyCandidates, getAsset, isBakeStale } from "./profiles.js";

const entries = new Map();
const probing = new Map();
let loaded = false;
let saveTimer = null;

export async function loadCatalog() {
  if ( loaded ) return;
  loaded = true;
  try {
    const listing = await browseStorage("");
    const found = (listing.files ?? []).find(f => f.endsWith(CATALOG_FILE));
    if ( !found ) return;
    const response = await fetch(`${found}?t=${Date.now()}`);
    if ( !response.ok ) return;
    const data = await response.json();
    if ( !Array.isArray(data?.entries) ) return;
    for ( const entry of data.entries ) {
      const key = assetKey(entry?.path);
      if ( key ) entries.set(key, normalizeEntry(entry, key));
    }
  } catch (err) {
    moduleWarn("catalog could not be read, starting empty", err);
    entries.clear();
  }
}

function normalizeEntry(entry, key) {
  return {
    path: key,
    ext: String(entry?.ext ?? extensionOf(key)),
    kind: entry?.kind ?? kindForExtension(extensionOf(key)),
    width: Number(entry?.width) || 0,
    height: Number(entry?.height) || 0,
    duration: Number(entry?.duration) || 0,
    frames: Number(entry?.frames) || 0,
    size: Number(entry?.size) || 0,
    mtime: Number(entry?.mtime) || 0,
    error: entry?.error ? String(entry.error) : null
  };
}

export function getEntry(src) {
  for ( const key of keyCandidates(src) ) {
    const entry = entries.get(key);
    if ( entry ) return entry;
  }
  return null;
}

export function allEntries() {
  return Array.from(entries.values());
}

export function statusOf(entry) {
  if ( !entry ) return null;
  if ( entry.error ) return STATUS.failed;
  const profile = getAsset(entry.path);
  if ( profile?.baked && !isBakeStale(profile, entry) ) return STATUS.prepared;
  return STATUS.indexed;
}

export function setEntry(entry) {
  const key = assetKey(entry?.path);
  if ( !key ) return null;
  const normalized = normalizeEntry(entry, key);
  entries.set(key, normalized);
  queueSave();
  return normalized;
}

export function removeEntry(src) {
  const key = keyCandidates(src).find(k => entries.has(k));
  const removed = key ? entries.delete(key) : false;
  if ( removed ) queueSave();
  return removed;
}

function queueSave() {
  if ( !game.user?.isGM ) return;
  if ( saveTimer ) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveCatalog().catch(err => moduleWarn("catalog save failed", err));
  }, 1500);
}

export async function saveCatalog() {
  if ( !game.user?.isGM ) return;
  const payload = JSON.stringify({ version: 1, entries: allEntries() });
  const file = new File([payload], CATALOG_FILE, { type: "application/json" });
  await ensureStorageDir("");
  await uploadPersistent("", file);
}

export async function flushCatalog() {
  if ( saveTimer ) {
    clearTimeout(saveTimer);
    saveTimer = null;
    await saveCatalog();
  }
}

export async function indexFile(src, { signal, force = false } = {}) {
  const key = assetKey(src);
  if ( !key ) return null;
  if ( !force && entries.has(key) ) return entries.get(key);
  if ( !kindForExtension(extensionOf(key)) ) return null;

  const inFlight = probing.get(key);
  if ( inFlight ) return inFlight;

  const promise = probeAndStore(key, signal).finally(() => probing.delete(key));
  probing.set(key, promise);
  return promise;
}

async function probeAndStore(key, signal) {
  try {
    const info = await probeMedia(key, { signal });
    if ( !info ) return null;
    if ( !info.animated ) {
      entries.delete(key);
      queueSave();
      return null;
    }
    return setEntry({ path: key, ...info, error: null });
  } catch (err) {
    if ( err?.name === "AbortError" ) throw err;
    return setEntry({ path: key, ext: extensionOf(key), error: err?.message ?? "probe failed" });
  }
}

async function collectFiles(source, target, out, { signal, onProgress, seen }) {
  if ( signal?.aborted ) throw new DOMException("aborted", "AbortError");
  if ( seen.has(target) ) return;
  seen.add(target);

  let listing;
  try {
    listing = await browseSource(source, target);
  } catch {
    return;
  }

  for ( const file of listing.files ?? [] ) {
    const ext = extensionOf(file);
    if ( kindForExtension(ext) ) out.push(file);
  }
  onProgress?.({ phase: "walk", found: out.length, dir: target });

  for ( const dir of listing.dirs ?? [] ) {
    await collectFiles(source, dir, out, { signal, onProgress, seen });
  }
}

export async function scanSources(roots, { signal, onProgress } = {}) {
  const candidates = [];
  const seen = new Set();

  for ( const root of roots ) {
    await collectFiles(root.source, root.target, candidates, { signal, onProgress, seen });
  }

  let processed = 0;
  let added = 0;
  for ( const file of candidates ) {
    if ( signal?.aborted ) throw new DOMException("aborted", "AbortError");
    const entry = await indexFile(file, { signal, force: true });
    if ( entry && !entry.error ) added++;
    processed++;
    onProgress?.({ phase: "probe", processed, total: candidates.length, added, file });
  }

  await flushCatalog();
  return { scanned: candidates.length, added };
}

export function defaultScanRoots() {
  return [{ source: "data", target: "" }];
}

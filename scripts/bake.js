import { SHEET_DIR, MAX_SHEET_EDGE, DEFAULTS, DEFAULT_FPS, MODULE_ID, SETTINGS, localize } from "./constants.js";
import { ensureStorageDir, uploadPersistent } from "./compat.js";
import { streamFrames, kindForSource } from "./decode/index.js";
import { makeSignatureExtractor } from "./analysis.js";
import { getAsset, makeProfile, saveAsset, assetOf, assetKey } from "./profiles.js";
import { getEntry, indexFile } from "./catalog.js";
import { forgetAudio, forgetInspection } from "./audio.js";

function hashKey(key) {
  let hash = 0x811c9dc5;
  for ( let i = 0; i < key.length; i++ ) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function safeStem(key) {
  const base = key.split("/").pop() ?? "sheet";
  const stem = base.replace(/\.[^.]+$/, "").replace(/[^a-z0-9_-]+/gi, "-").slice(0, 40);
  return stem || "sheet";
}

export function sheetFileName(key) {
  return `${safeStem(key)}-${hashKey(key)}.webp`;
}

function settingNumber(key, fallback) {
  const value = Number(game.settings.get(MODULE_ID, key));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

async function canvasToBlob(canvas) {
  const webp = await new Promise(resolve => canvas.toBlob(resolve, "image/webp", 0.92));
  if ( webp ) return { blob: webp, ext: "webp" };
  const png = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
  if ( png ) return { blob: png, ext: "png" };
  throw new Error(localize("Errors.EncodeFailed"));
}

function planLayout(maxFrames, sourceWidth, sourceHeight, maxEdge) {
  const aspect = (sourceWidth > 0 && sourceHeight > 0) ? sourceWidth / sourceHeight : 1;

  let targetW = aspect >= 1 ? maxEdge : maxEdge * aspect;
  let targetH = aspect >= 1 ? maxEdge / aspect : maxEdge;

  if ( sourceWidth > 0 ) targetW = Math.min(targetW, sourceWidth);
  if ( sourceHeight > 0 ) targetH = Math.min(targetH, sourceHeight);

  const frames = Math.max(1, Math.round(maxFrames));
  let best = null;
  for ( let cols = 1; cols <= frames; cols++ ) {
    const rows = Math.ceil(frames / cols);
    const scale = Math.min(1, (MAX_SHEET_EDGE / cols) / targetW, (MAX_SHEET_EDGE / rows) / targetH);
    const frameW = Math.max(8, Math.floor(targetW * scale));
    const frameH = Math.max(8, Math.floor(targetH * scale));
    if ( ((cols * frameW) > MAX_SHEET_EDGE) || ((rows * frameH) > MAX_SHEET_EDGE) ) continue;
    const area = frameW * frameH;
    const longest = Math.max(cols * frameW, rows * frameH);
    if ( !best || (area > best.area) || ((area === best.area) && (longest < best.longest)) ) {
      best = { cols, rows, frameW, frameH, area, longest };
    }
  }

  if ( !best ) return { cols: frames, rows: 1, frameW: 8, frameH: 8 };
  return { cols: best.cols, rows: best.rows, frameW: best.frameW, frameH: best.frameH };
}

export async function prepareAsset(src, { signal, onProgress } = {}) {
  const key = assetKey(src);
  if ( !key ) throw new Error("no source");
  if ( !game.user?.isGM ) throw new Error(localize("Errors.GMOnly"));

  const entry = getEntry(key) ?? await indexFile(key, { signal });
  if ( !entry || entry.error ) throw new Error(entry?.error ?? localize("Errors.NotIndexed"));

  const kind = entry.kind ?? kindForSource(key);
  const maxFrames = Math.round(settingNumber(SETTINGS.bakeMaxFrames, DEFAULTS.bakeMaxFrames));
  const maxEdge = Math.round(settingNumber(SETTINGS.bakeMaxEdge, DEFAULTS.bakeMaxEdge));

  const layout = planLayout(maxFrames, entry.width, entry.height, maxEdge);
  const sheet = document.createElement("canvas");
  sheet.width = layout.cols * layout.frameW;
  sheet.height = layout.rows * layout.frameH;
  const sheetCtx = sheet.getContext("2d");

  const extractSignature = makeSignatureExtractor();
  const signatures = [];
  const delays = [];

  const streamOptions = {
    signal,
    maxFrames,
    onFrame: async ({ canvas, delayMs, index }) => {
      if ( index >= maxFrames ) return;
      const col = index % layout.cols;
      const row = Math.floor(index / layout.cols);
      sheetCtx.clearRect(col * layout.frameW, row * layout.frameH, layout.frameW, layout.frameH);
      sheetCtx.drawImage(canvas, col * layout.frameW, row * layout.frameH, layout.frameW, layout.frameH);
      signatures.push(extractSignature(canvas));
      delays.push(delayMs);
      onProgress?.({ phase: "decode", index, total: maxFrames });
    }
  };

  const result = await streamFrames(key, kind, streamOptions);
  const count = signatures.length;
  if ( !count ) throw new Error(localize("Errors.NoFrames"));

  const usedRows = Math.ceil(count / layout.cols);
  let output = sheet;
  if ( usedRows < layout.rows ) {
    output = document.createElement("canvas");
    output.width = sheet.width;
    output.height = usedRows * layout.frameH;
    output.getContext("2d").drawImage(sheet, 0, 0);
  }

  onProgress?.({ phase: "encode" });
  const { blob, ext } = await canvasToBlob(output);
  const fileName = sheetFileName(key).replace(/\.webp$/, `.${ext}`);

  onProgress?.({ phase: "upload" });
  await ensureStorageDir(SHEET_DIR);
  const upload = await uploadPersistent(SHEET_DIR, new File([blob], fileName, { type: blob.type }));
  const path = upload?.path;
  if ( !path ) throw new Error(localize("Errors.UploadFailed"));

  const totalMs = delays.reduce((sum, d) => sum + d, 0);
  const duration = result.duration ?? (totalMs / 1000);

  forgetAudio(key);
  forgetInspection(key);

  const existing = getAsset(key);
  const profile = existing ?? assetOf(makeProfile(key, {
    width: entry.width,
    height: entry.height,
    duration,
    frames: count
  }));

  profile.audioState = null;
  profile.kind = kind;
  profile.source = {
    width: entry.width || result.width || 0,
    height: entry.height || result.height || 0,
    duration,
    frames: count
  };
  profile.fps = totalMs > 0 ? Math.max(1, Math.round(count / (totalMs / 1000))) : DEFAULT_FPS;
  profile.baked = {
    path,
    bakedAt: Date.now(),
    count,
    cols: layout.cols,
    rows: usedRows,
    frameW: layout.frameW,
    frameH: layout.frameH,
    delays,
    sourceSize: entry.size,
    sourceMtime: entry.mtime
  };

  const saved = await saveAsset(profile);
  onProgress?.({ phase: "done" });

  return { profile: saved, signatures, delays, count };
}

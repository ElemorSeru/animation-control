import { parseGif, buildSingleFrameGif } from "./gif-parser.js";
import { localize } from "../constants.js";

const DEFAULT_DELAY_MS = 100;

export function hasImageDecoder() {
  return typeof globalThis.ImageDecoder === "function";
}

function makeCanvas(width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function samplePlan(total, maxFrames) {
  const cap = (maxFrames > 0 && total > maxFrames) ? maxFrames : total;
  const step = total / cap;
  const picks = [];
  for ( let i = 0; i < cap; i++ ) picks.push(Math.min(total - 1, Math.floor(i * step)));
  return picks;
}

function frameMs(image) {
  return image.duration ? (image.duration / 1000) : DEFAULT_DELAY_MS;
}

function throwIfAborted(signal) {
  if ( signal?.aborted ) throw new DOMException("aborted", "AbortError");
}

async function fetchBuffer(src, signal) {
  const response = await fetch(src, { signal });
  if ( !response.ok ) throw new Error(`${response.status} ${response.statusText}`);
  return response.arrayBuffer();
}

// ImageDecoder frames already have disposal applied
async function streamViaImageDecoder(buffer, mimeType, { signal, onFrame, maxFrames = 0 }) {
  const decoder = new globalThis.ImageDecoder({ data: buffer, type: mimeType });
  try {
    // completed alone can still leave the track list empty
    await decoder.tracks.ready;
    await decoder.completed;
    const track = decoder.tracks.selectedTrack;
    const total = track?.frameCount ?? 0;
    if ( !total ) throw new Error("no frames");
    const picks = samplePlan(total, maxFrames);

    let width = 0;
    let height = 0;
    let canvas = null;
    let ctx = null;
    let totalMs = 0;

    for ( let i = 0; i < picks.length; i++ ) {
      throwIfAborted(signal);
      const { image } = await decoder.decode({ frameIndex: picks[i] });
      // read it before close since close clears it
      let spanMs = frameMs(image);
      try {
        if ( !canvas ) {
          width = image.displayWidth;
          height = image.displayHeight;
          canvas = makeCanvas(width, height);
          ctx = canvas.getContext("2d", { willReadFrequently: true });
        }
        ctx.clearRect(0, 0, width, height);
        ctx.drawImage(image, 0, 0, width, height);
      } finally {
        image.close();
      }
      const next = picks[i + 1] ?? total;
      for ( let skip = picks[i] + 1; skip < next; skip++ ) {
        throwIfAborted(signal);
        const { image: passed } = await decoder.decode({ frameIndex: skip });
        spanMs += frameMs(passed);
        passed.close();
      }
      const delayMs = Math.max(10, Math.round(spanMs));
      totalMs += delayMs;
      await onFrame({ canvas, delayMs, index: i });
    }

    return { width, height, count: picks.length, totalMs };
  } finally {
    decoder.close?.();
  }
}

async function streamViaGifParser(buffer, { signal, onFrame, maxFrames = 0 }) {
  const parsed = parseGif(buffer);
  const { width, height, frames } = parsed;

  const canvas = makeCanvas(width, height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const scratch = makeCanvas(width, height);
  const scratchCtx = scratch.getContext("2d");

  const picks = samplePlan(frames.length, maxFrames);
  const spans = new Map(picks.map((pick, k) => {
    let ms = 0;
    for ( let j = pick; j < (picks[k + 1] ?? frames.length); j++ ) ms += frames[j].delay > 0 ? frames[j].delay : DEFAULT_DELAY_MS;
    return [pick, ms];
  }));
  let totalMs = 0;
  let emitted = 0;

  for ( let i = 0; i < frames.length; i++ ) {
    throwIfAborted(signal);
    const frame = frames[i];

    if ( frame.disposal === 3 ) {
      scratchCtx.clearRect(0, 0, width, height);
      scratchCtx.drawImage(canvas, 0, 0);
    }

    const gifBytes = buildSingleFrameGif(frame);
    const bitmap = await createImageBitmap(new Blob([gifBytes], { type: "image/gif" }));
    try {
      ctx.drawImage(bitmap, frame.left, frame.top);
    } finally {
      bitmap.close();
    }

    if ( spans.has(i) ) {
      const delayMs = Math.max(10, spans.get(i));
      totalMs += delayMs;
      await onFrame({ canvas, delayMs, index: emitted });
      emitted++;
    }

    if ( frame.disposal === 2 ) ctx.clearRect(frame.left, frame.top, frame.width, frame.height);
    else if ( frame.disposal === 3 ) {
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(scratch, 0, 0);
    }
  }

  return { width, height, count: emitted, totalMs };
}

export async function streamImageFrames(src, mimeType, { signal, onFrame, maxFrames = 0 } = {}) {
  const buffer = await fetchBuffer(src, signal);

  if ( hasImageDecoder() ) {
    try {
      return await streamViaImageDecoder(buffer, mimeType, { signal, onFrame, maxFrames });
    } catch (err) {
      if ( err?.name === "AbortError" ) throw err;
      if ( mimeType !== "image/gif" ) throw err;
    }
  }

  if ( mimeType !== "image/gif" ) throw new Error(localize("Errors.NoDecoder"));
  return streamViaGifParser(buffer, { signal, onFrame, maxFrames });
}

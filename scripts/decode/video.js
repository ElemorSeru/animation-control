import { DEFAULT_FPS } from "../constants.js";

function throwIfAborted(signal) {
  if ( signal?.aborted ) throw new DOMException("aborted", "AbortError");
}

export function createProbeVideo(src) {
  const video = document.createElement("video");
  video.preload = "metadata";
  video.muted = true;
  video.playsInline = true;
  video.crossOrigin = "anonymous";
  video.src = src;
  return video;
}

export async function readVideoMetadata(src, { signal } = {}) {
  const video = createProbeVideo(src);
  try {
    await new Promise((resolve, reject) => {
      const onLoaded = () => { cleanup(); resolve(); };
      const onError = () => { cleanup(); reject(new Error("video metadata failed")); };
      const onAbort = () => { cleanup(); reject(new DOMException("aborted", "AbortError")); };
      const cleanup = () => {
        video.removeEventListener("loadedmetadata", onLoaded);
        video.removeEventListener("error", onError);
        signal?.removeEventListener("abort", onAbort);
      };
      video.addEventListener("loadedmetadata", onLoaded, { once: true });
      video.addEventListener("error", onError, { once: true });
      signal?.addEventListener("abort", onAbort, { once: true });
    });

    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    return { width: video.videoWidth, height: video.videoHeight, duration };
  } finally {
    video.removeAttribute("src");
    video.load();
  }
}

async function seekTo(video, time, signal) {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const onSeeked = () => { cleanup(); resolve(); };
    const onError = () => { cleanup(); reject(new Error("seek failed")); };
    const onAbort = () => { cleanup(); reject(new DOMException("aborted", "AbortError")); };
    const cleanup = () => {
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", onError);
      signal?.removeEventListener("abort", onAbort);
    };
    video.addEventListener("seeked", onSeeked, { once: true });
    video.addEventListener("error", onError, { once: true });
    signal?.addEventListener("abort", onAbort, { once: true });
    video.currentTime = time;
  });
}

export async function streamVideoFrames(src, { signal, onFrame, start = 0, end = null, fps = DEFAULT_FPS, maxFrames = 0 } = {}) {
  const video = createProbeVideo(src);
  video.preload = "auto";

  try {
    await new Promise((resolve, reject) => {
      const onReady = () => { cleanup(); resolve(); };
      const onError = () => { cleanup(); reject(new Error("video load failed")); };
      const onAbort = () => { cleanup(); reject(new DOMException("aborted", "AbortError")); };
      const cleanup = () => {
        video.removeEventListener("loadeddata", onReady);
        video.removeEventListener("error", onError);
        signal?.removeEventListener("abort", onAbort);
      };
      video.addEventListener("loadeddata", onReady, { once: true });
      video.addEventListener("error", onError, { once: true });
      signal?.addEventListener("abort", onAbort, { once: true });
    });

    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    if ( !duration ) throw new Error("video duration unavailable");

    const from = Math.max(0, Math.min(start, duration));
    const to = Math.max(from, Math.min(end ?? duration, duration));
    const span = Math.max(to - from, 1 / fps);

    let count = Math.max(1, Math.round(span * fps));
    if ( maxFrames > 0 && count > maxFrames ) count = maxFrames;
    const step = span / count;

    const width = video.videoWidth;
    const height = video.videoHeight;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });

    const delayMs = Math.max(10, Math.round(step * 1000));

    for ( let i = 0; i < count; i++ ) {
      const time = Math.min(from + (i * step), Math.max(0, duration - 0.001));
      await seekTo(video, time, signal);
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(video, 0, 0, width, height);
      await onFrame({ canvas, delayMs, index: i, time });
    }

    return { width, height, count, totalMs: Math.round(span * 1000), duration, start: from, end: to };
  } finally {
    video.removeAttribute("src");
    video.load();
  }
}

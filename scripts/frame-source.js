import { moduleWarn } from "./constants.js";

const CACHE_BUDGET = 256 * 1024 * 1024;
const imageCache = new Map();
let cacheBytes = 0;

function imageBytes(image) {
  return Math.max(0, (image?.naturalWidth || 0) * (image?.naturalHeight || 0) * 4);
}

function trimCache() {
  for (const key of [...imageCache.keys()]) {
    if ( cacheBytes <= CACHE_BUDGET ) return;
    cacheBytes -= imageCache.get(key)?.bytes ?? 0;
    imageCache.delete(key);
  }
}

export function sheetUrl(baked) {
  if ( !baked?.path ) return "";
  return baked.bakedAt ? `${baked.path}?v=${baked.bakedAt}` : baked.path;
}

export function loadSheetImage(url) {
  const hit = imageCache.get(url);
  if ( hit ) {
    imageCache.delete(url);
    imageCache.set(url, hit);
    return hit.promise;
  }

  const entry = { bytes: 0 };
  entry.promise = new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`sheet failed to load: ${url}`));
    image.src = url;
  }).then(image => {
    entry.bytes = imageBytes(image);
    cacheBytes += entry.bytes;
    trimCache();
    return image;
  }).catch(err => {
    forgetSheetImage(url);
    throw err;
  });
  imageCache.set(url, entry);
  return entry.promise;
}

export function forgetSheetImage(url) {
  const entry = imageCache.get(url);
  if ( !entry ) return;
  cacheBytes -= entry.bytes;
  imageCache.delete(url);
}

export function sheetCacheUsage() {
  return { sheets: imageCache.size, bytes: cacheBytes, budget: CACHE_BUDGET };
}

export class BakedFrameSource {
  #baked;
  #image = null;
  #canvas = null;
  #ctx = null;
  #texture = null;
  #current = -1;

  constructor(baked) {
    this.#baked = baked;
  }

  get count() {
    return this.#baked.count;
  }

  get delays() {
    return this.#baked.delays;
  }

  get texture() {
    return this.#texture;
  }

  get canvas() {
    return this.#canvas;
  }

  get ready() {
    return !!this.#texture;
  }

  async load() {
    const url = sheetUrl(this.#baked);
    this.#image = await loadSheetImage(url);

    const expectedW = this.#baked.cols * this.#baked.frameW;
    const expectedH = this.#baked.rows * this.#baked.frameH;
    if ( this.#image.naturalWidth !== expectedW || this.#image.naturalHeight !== expectedH ) {
      forgetSheetImage(url);
      throw new Error("sheet dimensions do not match the stored record");
    }

    this.#canvas = document.createElement("canvas");
    this.#canvas.width = this.#baked.frameW;
    this.#canvas.height = this.#baked.frameH;
    this.#ctx = this.#canvas.getContext("2d");

    const base = new PIXI.BaseTexture(this.#canvas);
    this.#texture = new PIXI.Texture(base);
    this.setFrame(0);
    return this;
  }

  #drawFrame(index, alpha = 1) {
    const { cols, frameW, frameH } = this.#baked;
    const clamped = Math.max(0, Math.min(Math.round(index), this.#baked.count - 1));
    const sx = (clamped % cols) * frameW;
    const sy = Math.floor(clamped / cols) * frameH;
    this.#ctx.globalAlpha = alpha;
    this.#ctx.drawImage(this.#image, sx, sy, frameW, frameH, 0, 0, frameW, frameH);
    this.#ctx.globalAlpha = 1;
  }

  setFrame(index) {
    if ( !this.#texture ) return;
    const clamped = Math.max(0, Math.min(Math.round(index), this.#baked.count - 1));
    if ( clamped === this.#current ) return;
    this.#ctx.clearRect(0, 0, this.#canvas.width, this.#canvas.height);
    this.#drawFrame(clamped);
    this.#texture.baseTexture.update();
    this.#current = clamped;
  }

  setBlendedFrame(fromIndex, toIndex, mix) {
    if ( !this.#texture ) return;
    this.#ctx.clearRect(0, 0, this.#canvas.width, this.#canvas.height);
    this.#drawFrame(fromIndex, 1);
    this.#drawFrame(toIndex, Math.max(0, Math.min(mix, 1)));
    this.#texture.baseTexture.update();
    this.#current = -1;
  }

  destroy() {
    try {
      this.#texture?.destroy(true);
    } catch (err) {
      moduleWarn("frame source teardown", err);
    }
    this.#texture = null;
    this.#canvas = null;
    this.#ctx = null;
    this.#image = null;
  }
}

export class VideoFrameSource {
  #video;
  #held = false;

  constructor(video) {
    this.#video = video;
  }

  get video() {
    return this.#video;
  }

  get ready() {
    return !!this.#video && Number.isFinite(this.#video.duration) && this.#video.duration > 0;
  }

  get duration() {
    return Number.isFinite(this.#video?.duration) ? this.#video.duration : 0;
  }

  // Foundry re-asserts loop on every refresh
  claim() {
    if ( !this.#video ) return;
    this.#video.loop = false;
    this.#video.autoplay = false;
  }

  seek(time) {
    if ( !this.ready ) return;
    const target = Math.max(0, Math.min(time, this.duration - 0.001));
    if ( Math.abs(this.#video.currentTime - target) < 0.001 ) return;
    this.#video.currentTime = target;
  }

  async play() {
    if ( !this.#video ) return;
    try {
      await this.#video.play();
    } catch {
    }
  }

  pause() {
    this.#video?.pause();
  }

  // stop the element on still clips too or it keeps decoding
  hold(held) {
    const video = this.#video;
    if ( !video ) return;
    // check every tick since core can restart the element
    if ( held ) {
      if ( !video.paused ) video.pause();
    } else if ( this.#held ) {
      video.play().catch(() => {});
    }
    this.#held = held;
  }

  get currentTime() {
    return this.#video?.currentTime ?? 0;
  }

  destroy() {
    this.#video = null;
  }
}

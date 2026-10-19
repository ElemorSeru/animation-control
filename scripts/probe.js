import { KIND } from "./constants.js";
import { extensionOf, kindForExtension, readVideoMetadata } from "./decode/index.js";

const HEADER_BYTES = 65536;
const GIF_HEADER_BYTES = 262144;

async function fetchHead(src, { signal, bytes = HEADER_BYTES } = {}) {
  const response = await fetch(src, {
    signal,
    headers: { Range: `bytes=0-${bytes - 1}` }
  });
  if ( !response.ok && response.status !== 206 ) throw new Error(`${response.status} ${response.statusText}`);

  const buffer = await response.arrayBuffer();
  const range = response.headers.get("Content-Range");
  const total = range ? Number(range.split("/")[1]) : Number(response.headers.get("Content-Length") ?? 0);
  const modified = response.headers.get("Last-Modified");

  return {
    data: new Uint8Array(buffer),
    size: Number.isFinite(total) && total > 0 ? total : buffer.byteLength,
    mtime: modified ? Date.parse(modified) || 0 : 0,
    partial: buffer.byteLength < (Number.isFinite(total) ? total : buffer.byteLength)
  };
}

function readU32BE(bytes, offset) {
  return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
}

function readU24LE(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function fourCC(bytes, offset) {
  return String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
}

function inspectPng(bytes) {
  const signature = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
  if ( !signature.every((b, i) => bytes[i] === b) ) return null;

  let p = 8;
  let width = 0;
  let height = 0;
  let frames = 0;
  let animated = false;

  while ( p + 8 <= bytes.length ) {
    const length = readU32BE(bytes, p);
    const type = fourCC(bytes, p + 4);

    if ( type === "IHDR" ) {
      width = readU32BE(bytes, p + 8);
      height = readU32BE(bytes, p + 12);
    } else if ( type === "acTL" ) {
      animated = true;
      frames = readU32BE(bytes, p + 8);
      break;
    } else if ( type === "IDAT" ) {
      break;
    }

    p += 12 + length;
    if ( length > bytes.length ) break;
  }

  return { width, height, animated, frames, kind: KIND.apng };
}

function inspectWebp(bytes) {
  if ( fourCC(bytes, 0) !== "RIFF" || fourCC(bytes, 8) !== "WEBP" ) return null;

  let p = 12;
  let width = 0;
  let height = 0;
  let animated = false;
  let frames = 0;

  while ( p + 8 <= bytes.length ) {
    const type = fourCC(bytes, p);
    const size = bytes[p + 4] | (bytes[p + 5] << 8) | (bytes[p + 6] << 16) | (bytes[p + 7] << 24);
    const body = p + 8;

    if ( type === "VP8X" ) {
      animated = !!(bytes[body] & 0x02);
      width = readU24LE(bytes, body + 4) + 1;
      height = readU24LE(bytes, body + 7) + 1;
    } else if ( type === "ANMF" ) {
      frames++;
    }

    if ( size <= 0 ) break;
    p = body + size + (size % 2);
  }

  return { width, height, animated, frames, kind: KIND.webp };
}

function inspectGif(bytes) {
  if ( !(bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) ) return null;

  const width = bytes[6] | (bytes[7] << 8);
  const height = bytes[8] | (bytes[9] << 8);
  const packed = bytes[10];

  let p = 13;
  if ( packed & 0x80 ) p += 3 * (1 << ((packed & 0x07) + 1));

  let frames = 0;
  let truncated = false;

  while ( p < bytes.length ) {
    const block = bytes[p];
    if ( block === 0x3B ) break;

    if ( block === 0x21 ) {
      p += 2;
      let guard = 0;
      while ( p < bytes.length && bytes[p] !== 0 ) {
        p += bytes[p] + 1;
        if ( ++guard > 4096 ) break;
      }
      p += 1;
      continue;
    }

    if ( block === 0x2C ) {
      frames++;
      if ( frames > 1 ) break;
      const localPacked = bytes[p + 9];
      p += 10;
      if ( localPacked & 0x80 ) p += 3 * (1 << ((localPacked & 0x07) + 1));
      p += 1;
      let guard = 0;
      while ( p < bytes.length && bytes[p] !== 0 ) {
        p += bytes[p] + 1;
        if ( ++guard > 65536 ) break;
      }
      p += 1;
      continue;
    }

    truncated = true;
    break;
  }

  if ( p >= bytes.length && frames < 2 ) truncated = true;
  return { width, height, animated: frames > 1, frames, truncated, kind: KIND.gif };
}

function inspectBuffer(bytes) {
  return inspectPng(bytes) ?? inspectWebp(bytes) ?? inspectGif(bytes);
}

export async function probeMedia(src, { signal } = {}) {
  const ext = extensionOf(src);
  const kind = kindForExtension(ext);
  if ( !kind ) return null;

  if ( kind === KIND.video ) {
    const head = await fetchHead(src, { signal, bytes: 1024 }).catch(() => null);
    const meta = await readVideoMetadata(src, { signal });
    return {
      kind,
      ext,
      animated: meta.duration > 0,
      width: meta.width,
      height: meta.height,
      duration: meta.duration,
      frames: 0,
      size: head?.size ?? 0,
      mtime: head?.mtime ?? 0
    };
  }

  let head = await fetchHead(src, { signal, bytes: kind === KIND.gif ? GIF_HEADER_BYTES : HEADER_BYTES });
  let info = inspectBuffer(head.data);

  // a long first frame can hide the second
  if ( info?.kind === KIND.gif && info.truncated && head.partial ) {
    head = await fetchHead(src, { signal, bytes: Math.min(head.size, 16 * 1024 * 1024) });
    info = inspectBuffer(head.data);
  }

  if ( !info ) return null;

  return {
    kind: info.kind,
    ext,
    animated: !!info.animated,
    width: info.width,
    height: info.height,
    duration: 0,
    frames: info.frames ?? 0,
    size: head.size,
    mtime: head.mtime
  };
}

const SIGNATURE = [0x47, 0x49, 0x46];

export function isGifBuffer(bytes) {
  return SIGNATURE.every((b, i) => bytes[i] === b);
}

function colorTableSize(packed) {
  return 3 * (1 << ((packed & 0x07) + 1));
}

export function parseGif(buffer) {
  const bytes = new Uint8Array(buffer);
  if ( !isGifBuffer(bytes) ) throw new Error("not a GIF");

  let p = 6;
  const width = bytes[p] | (bytes[p + 1] << 8);
  const height = bytes[p + 2] | (bytes[p + 3] << 8);
  const lsdPacked = bytes[p + 4];
  p += 7;

  let globalTable = null;
  if ( lsdPacked & 0x80 ) {
    const size = colorTableSize(lsdPacked);
    globalTable = bytes.subarray(p, p + size);
    p += size;
  }

  const frames = [];
  let pending = { delay: 0, disposal: 0, transparentIndex: -1 };

  while ( p < bytes.length ) {
    const block = bytes[p];

    if ( block === 0x3B ) break;

    if ( block === 0x21 ) {
      const label = bytes[p + 1];
      p += 2;
      if ( label === 0xF9 ) {
        const size = bytes[p];
        const packed = bytes[p + 1];
        pending = {
          disposal: (packed >> 2) & 0x07,
          transparentIndex: (packed & 0x01) ? bytes[p + 4] : -1,
          delay: (bytes[p + 2] | (bytes[p + 3] << 8)) * 10
        };
        p += size + 1;
      }
      p = skipSubBlocks(bytes, p);
      continue;
    }

    if ( block === 0x2C ) {
      const start = p;
      p += 1;
      const left = bytes[p] | (bytes[p + 1] << 8);
      const top = bytes[p + 2] | (bytes[p + 3] << 8);
      const fw = bytes[p + 4] | (bytes[p + 5] << 8);
      const fh = bytes[p + 6] | (bytes[p + 7] << 8);
      const packed = bytes[p + 8];
      p += 9;

      let localTable = null;
      if ( packed & 0x80 ) {
        const size = colorTableSize(packed);
        localTable = bytes.subarray(p, p + size);
        p += size;
      }

      const lzwMin = bytes[p];
      p += 1;
      const dataStart = p;
      p = skipSubBlocks(bytes, p);

      frames.push({
        left, top, width: fw, height: fh,
        interlaced: !!(packed & 0x40),
        table: localTable ?? globalTable,
        lzwMin,
        data: bytes.subarray(dataStart, p),
        delay: pending.delay,
        disposal: pending.disposal,
        transparentIndex: pending.transparentIndex
      });

      pending = { delay: 0, disposal: 0, transparentIndex: -1 };
      if ( p <= start ) break;
      continue;
    }

    // unknown block, the file is malformed past this point
    break;
  }

  if ( !frames.length ) throw new Error("GIF contained no frames");
  return { width, height, frames };
}

function skipSubBlocks(bytes, p) {
  while ( p < bytes.length ) {
    const size = bytes[p];
    if ( size === 0 ) return p + 1;
    p += size + 1;
  }
  return p;
}

export function buildSingleFrameGif(frame) {
  const table = frame.table;
  if ( !table ) throw new Error("GIF frame has no color table");

  const entries = table.length / 3;
  let sizeBits = 0;
  while ( (1 << (sizeBits + 1)) < entries ) sizeBits++;

  const out = [];
  const push = (...vals) => out.push(...vals);
  const push16 = v => push(v & 0xFF, (v >> 8) & 0xFF);

  push(0x47, 0x49, 0x46, 0x38, 0x39, 0x61);
  push16(frame.width);
  push16(frame.height);
  push(0x80 | (sizeBits & 0x07), 0, 0);
  push(...table);

  const gceFlags = (frame.transparentIndex >= 0 ? 0x01 : 0x00);
  push(0x21, 0xF9, 0x04, gceFlags, 0, 0, frame.transparentIndex >= 0 ? frame.transparentIndex : 0, 0x00);

  push(0x2C);
  push16(0);
  push16(0);
  push16(frame.width);
  push16(frame.height);
  push(frame.interlaced ? 0x40 : 0x00);

  push(frame.lzwMin);
  const bytes = new Uint8Array(out.length + frame.data.length + 2);
  bytes.set(out, 0);
  bytes.set(frame.data, out.length);
  bytes[out.length + frame.data.length] = 0x00;
  bytes[out.length + frame.data.length + 1] = 0x3B;
  return bytes;
}

import { KIND, VIDEO_EXTENSIONS } from "../constants.js";
import { streamImageFrames } from "./images.js";
import { streamVideoFrames, readVideoMetadata } from "./video.js";

const IMAGE_MIME = {
  [KIND.gif]: "image/gif",
  [KIND.webp]: "image/webp",
  [KIND.apng]: "image/png"
};

export function extensionOf(src) {
  const clean = String(src ?? "").split("?")[0].split("#")[0];
  const dot = clean.lastIndexOf(".");
  return dot < 0 ? "" : clean.slice(dot + 1).toLowerCase();
}

export function kindForExtension(ext) {
  if ( VIDEO_EXTENSIONS.includes(ext) ) return KIND.video;
  if ( ext === "gif" ) return KIND.gif;
  if ( ext === "webp" ) return KIND.webp;
  if ( ext === "png" || ext === "apng" ) return KIND.apng;
  return null;
}

export function kindForSource(src) {
  return kindForExtension(extensionOf(src));
}

export function isVideoKind(kind) {
  return kind === KIND.video;
}

export async function streamFrames(src, kind, options = {}) {
  if ( isVideoKind(kind) ) return streamVideoFrames(src, options);
  const mime = IMAGE_MIME[kind];
  if ( !mime ) throw new Error(`unsupported kind ${kind}`);
  return streamImageFrames(src, mime, options);
}

export { readVideoMetadata };

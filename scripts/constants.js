export const BUILD = "2026-08-25 23:55:20";

export const MODULE_ID = "animation-control";

export const SETTINGS = {
  assets: "assets",
  controllerPosition: "controllerPosition",
  controllerView: "controllerView",
  controllerReset: "controllerReset",
  roundSeconds: "roundSeconds",
  bakeMaxFrames: "bakeMaxFrames",
  bakeMaxEdge: "bakeMaxEdge",
  indexOnPlacement: "indexOnPlacement",
  updateCheckCache: "updateCheckCache",
  libraryMenu: "libraryMenu"
};

export const FLAGS = {
  disabled: "disabled",
  profile: "profile",
  state: "state",
  sceneProfile: "sceneProfile"
};

export const ACTION = {
  restart: "restart",
  play: "play",
  continue: "continue",
  goto: "goto",
  pause: "pause",
  resume: "resume",
  reverse: "reverse",
  fadeIn: "fadeIn",
  fadeOut: "fadeOut",
  fadeToggle: "fadeToggle"
};

export const KIND = {
  video: "video",
  gif: "gif",
  apng: "apng",
  webp: "webp"
};

export const STATUS = {
  indexed: "indexed",
  prepared: "prepared",
  failed: "failed"
};

export const LOOP_MODE = {
  loop: "loop",
  pingpong: "pingpong",
  pause: "pause"
};

export const ENGAGE = {
  auto: "auto",
  jump: "jump"
};

export const HOLD = {
  forever: "forever",
  cycles: "cycles",
  rounds: "rounds",
  seconds: "seconds"
};

export const RELEASE = {
  carryOn: "carryOn",
  goto: "goto",
  stop: "stop"
};

export const AUDIO_STATE = {
  sound: "sound",
  silent: "silent",
  tooLong: "tooLong",
  unreadable: "unreadable"
};

export const LOOP_AUDIO = {
  follow: "follow",
  loop: "loop",
  duck: "duck",
  silent: "silent"
};

export const SEAM = {
  cut: "cut",
  blend: "blend"
};

export const START = {
  auto: "auto",
  trigger: "trigger"
};

export const ENDED = {
  restart: "restart",
  last: "last",
  first: "first",
  hidden: "hidden",
  goto: "goto"
};

export const IDLE = {
  frame: "frame",
  hidden: "hidden"
};

export const VIDEO_EXTENSIONS = ["webm", "mp4", "m4v"];

export const CATALOG_FILE = "catalog.json";
export const SHEET_DIR = "sheets";

export const ANALYSIS_EDGE = 32;

export const DEFAULT_FPS = 30;

// wider than this fails to upload on weaker GPUs
export const MAX_SHEET_EDGE = 4096;

export const DEFAULTS = {
  bakeMaxFrames: 96,
  bakeMaxEdge: 512,
  minLoopFrames: 4,
  blendFrames: 6,
  transitionMs: 400,
  crossfadeMs: 20,
  rate: 1,
  desync: 0
};

export const RATE = { min: 0.25, max: 4 };

export function localize(key, data) {
  const full = `${MODULE_ID}.${key}`;
  return data ? game.i18n.format(full, data) : game.i18n.localize(full);
}

export function moduleLog(...args) {
  console.log(`${MODULE_ID} |`, ...args);
}

export function moduleWarn(...args) {
  console.warn(`${MODULE_ID} |`, ...args);
}

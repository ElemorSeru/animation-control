import { MODULE_ID, localize } from "./constants.js";

// v12 has it as a global but not on globalThis
export function filePicker() {
  return foundry.applications?.apps?.FilePicker?.implementation
    ?? foundry.applications?.apps?.FilePicker
    ?? (typeof FilePicker !== "undefined" ? FilePicker : null);
}

function requireFilePicker() {
  const FP = filePicker();
  if ( !FP ) throw new Error(`${MODULE_ID} | no file picker on this version`);
  return FP;
}

// v12 only has the global, v13+ deprecates it
export function loadCanvasTexture(src) {
  const load = foundry.canvas?.loadTexture ?? globalThis.loadTexture;
  return load ? load(src) : Promise.resolve(null);
}

export function appV2() {
  return foundry.applications.api.ApplicationV2;
}

export function handlebarsMixin() {
  return foundry.applications.api.HandlebarsApplicationMixin;
}

export function dialogV2() {
  return foundry.applications.api.DialogV2;
}

export async function loadTemplateFiles(paths) {
  const loader = foundry.applications?.handlebars?.loadTemplates ?? globalThis.loadTemplates;
  return loader(paths);
}

export function escapeHtml(value) {
  const s = String(value ?? "");
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// v12 passes jQuery, v13+ an element
export function rootElement(html) {
  if ( !html ) return null;
  if ( html instanceof HTMLElement ) return html;
  if ( html[0] instanceof HTMLElement ) return html[0];
  return null;
}

export async function confirmDialog({ title, content, yesLabel, noLabel }) {
  const DialogV2 = dialogV2();
  const result = await DialogV2.wait({
    window: { title },
    content,
    rejectClose: false,
    buttons: [
      {
        action: "yes",
        label: yesLabel ?? localize("Common.Confirm"),
        default: true,
        callback: () => true
      },
      {
        action: "no",
        label: noLabel ?? localize("Common.Cancel"),
        callback: () => false
      }
    ]
  });
  return result === true;
}

// uploadPersistent needs the folders to exist in data first
export function storagePath(subPath = "") {
  const clean = String(subPath).split("/").filter(s => s.length).join("/");
  const root = `modules/${MODULE_ID}/storage`;
  return clean ? `${root}/${clean}` : root;
}

async function dirExists(FP, target) {
  try {
    await FP.browse("data", target);
    return true;
  } catch {
    return false;
  }
}

async function ensureDir(FP, target) {
  try {
    await FP.createDirectory("data", target, {});
  } catch (err) {
    // createDirectory throws if the folder already exists
    if ( await dirExists(FP, target) ) return;
    throw err;
  }
}

export async function ensureStorageDir(subPath = "") {
  const FP = requireFilePicker();
  const segments = String(subPath).split("/").filter(s => s.length);

  await ensureDir(FP, storagePath());
  let built = "";
  for ( const segment of segments ) {
    built = built ? `${built}/${segment}` : segment;
    await ensureDir(FP, storagePath(built));
  }
  return subPath;
}

export async function uploadPersistent(dir, file) {
  const FP = requireFilePicker();
  return FP.uploadPersistent(MODULE_ID, dir, file, {}, { notify: false });
}

export async function browseStorage(dir = "") {
  try {
    return await requireFilePicker().browse("data", storagePath(dir));
  } catch {
    return { files: [], dirs: [] };
  }
}

export async function browseSource(source, target) {
  const FP = requireFilePicker();
  return FP.browse(source, target);
}

// v14 levels, earlier versions show everything
export function inViewedLevel(doc) {
  const level = canvas?.level;
  if ( !level || (typeof doc?.includedInLevel !== "function") ) return true;
  return doc.includedInLevel(level);
}

export function onSceneConfigRender(handler) {
  Hooks.on("renderSceneConfig", (app, html) => handler(app, rootElement(html)));
}

// v14 only
export function onLevelConfigRender(handler) {
  Hooks.on("renderLevelConfig", (app, html) => handler(app, rootElement(html)));
}

export function onTileConfigRender(handler) {
  Hooks.on("renderTileConfig", (app, html) => handler(app, rootElement(html)));
}

export function onTokenConfigRender(handler) {
  Hooks.on("renderTokenConfig", (app, html) => handler(app, rootElement(html)));
  Hooks.on("renderPrototypeTokenConfig", (app, html) => handler(app, rootElement(html)));
}

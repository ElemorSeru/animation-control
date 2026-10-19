import { MODULE_ID, FLAGS, STATUS, localize, moduleWarn } from "./constants.js";
import {
  onTileConfigRender, onTokenConfigRender, onSceneConfigRender, onLevelConfigRender, escapeHtml
} from "./compat.js";
import { SceneSurface, SURFACE_KINDS } from "./scene-surface.js";
import { getAsset, isBakeStale } from "./profiles.js";
import { prepareAsset } from "./bake.js";
import { getEntry, statusOf } from "./catalog.js";
import { kindForSource } from "./decode/index.js";
import { EditorApp } from "./apps/editor-app.js";

const VIDEO_SELECTORS = ["[name='video.loop']", "[name='video.autoplay']"];

function findPlacement(root) {
  for ( const selector of VIDEO_SELECTORS ) {
    const input = root.querySelector(selector);
    if ( !input ) continue;
    const fieldset = input.closest("fieldset");
    if ( fieldset ) return { node: fieldset, mode: "after" };
    // v12 gives video a tab with no fieldset
    const tab = input.closest(".tab");
    if ( tab ) return { node: tab, mode: "append" };
    const group = input.closest(".form-group");
    if ( group ) return { node: group, mode: "after" };
  }
  const src = root.querySelector("[name='texture.src']");
  const tab = src?.closest(".tab");
  if ( tab ) return { node: tab, mode: "append" };

  const fallback = src?.closest("fieldset") ?? src?.closest(".form-group");
  return fallback ? { node: fallback, mode: "after" } : null;
}

function sectionState(src, configured) {
  const asset = src ? getAsset(src) : null;
  const entry = src ? getEntry(src) : null;
  const status = entry ? statusOf(entry) : null;
  const stale = isBakeStale(asset, entry);
  const prepared = !!asset?.baked && !stale;

  let stateKey = "Config.StateNone";
  if ( stale ) stateKey = "Config.StateStale";
  else if ( prepared && configured ) stateKey = "Config.StatePrepared";
  else if ( prepared ) stateKey = "Config.StateReady";
  else if ( status === STATUS.indexed ) stateKey = "Config.StateIndexed";

  const canEdit = !!src && !!kindForSource(src);
  return {
    stateKey,
    stale,
    canEdit,
    canPrepare: canEdit && !!game.user?.isGM && (!asset?.baked || stale),
    summary: (prepared && configured)
      ? localize("Config.SummaryPrepared", { frames: asset.baked.count })
      : localize(stateKey)
  };
}

function buildSection(doc, src) {
  const disabled = !!doc.getFlag(MODULE_ID, FLAGS.disabled);
  const behavior = doc.getFlag(MODULE_ID, FLAGS.profile);
  const configured = !!behavior && (typeof behavior === "object");
  const { stateKey, stale, canEdit, canPrepare, summary } = sectionState(src, configured);

  const section = document.createElement("fieldset");
  section.className = "ac-config-section";

  section.innerHTML = `
    <legend>${escapeHtml(localize("Config.Legend"))}</legend>
    <p class="hint">${escapeHtml(localize("Config.SectionHint"))}</p>
    <div class="form-group">
      <label>${escapeHtml(localize("Config.Status"))}</label>
      <div class="form-fields">
        <span class="ac-config-state" data-state="${escapeHtml(stateKey)}">${escapeHtml(summary)}</span>
      </div>
    </div>
    <div class="form-group">
      <label for="ac-config-disabled">${escapeHtml(localize("Config.Disable"))}</label>
      <div class="form-fields">
        <input type="checkbox" id="ac-config-disabled" name="flags.${MODULE_ID}.${FLAGS.disabled}" ${disabled ? "checked" : ""}>
      </div>
      <p class="hint">${escapeHtml(localize("Config.DisableHint"))}</p>
    </div>
    <div class="ac-config-actions">
      ${canPrepare ? `
        <button type="button" class="ac-config-prepare" data-ac-prepare>
          <i class="fa-solid fa-wand-magic-sparkles"></i>
          <span data-ac-prepare-label>${escapeHtml(localize(stale ? "Config.PrepareAgain" : "Config.Prepare"))}</span>
        </button>
      ` : ""}
      <button type="button" class="ac-config-edit" data-ac-edit ${canEdit ? "" : "disabled"}>
        <i class="fa-solid fa-sliders"></i> ${escapeHtml(localize("Config.Configure"))}
      </button>
    </div>
  `;

  return { section, canEdit, canPrepare, src };
}

function markNativeControls(root, active) {
  if ( !active ) return;
  for ( const selector of ["[name='video.loop']", "[name='video.autoplay']"] ) {
    const group = root.querySelector(selector)?.closest(".form-group");
    if ( !group || group.classList.contains("ac-overridden") ) continue;
    group.classList.add("ac-overridden");
    const note = document.createElement("p");
    note.className = "hint";
    note.textContent = localize("Config.NativeOverridden");
    group.appendChild(note);
  }
}

function injectInto(app, root) {
  if ( !root || root.querySelector(".ac-config-section") ) return;
  const doc = app?.document ?? app?.token ?? app?.object;
  if ( !doc ) return;

  const src = doc?.texture?.src ?? null;
  const { section, canEdit, canPrepare } = buildSection(doc, src);

  const placement = findPlacement(root);
  if ( placement?.mode === "append" ) placement.node.appendChild(section);
  else if ( placement?.node?.parentElement ) {
    placement.node.parentElement.insertBefore(section, placement.node.nextSibling);
  }
  else {
    const form = root.querySelector("form") ?? root;
    const footer = form.querySelector("footer, .form-footer, .sheet-footer");
    if ( footer ) form.insertBefore(section, footer);
    else form.appendChild(section);
  }

  // core styles fieldsets only inside a standard-form
  if ( !section.closest(".standard-form") ) section.classList.add("ac-plain-section");

  const configured = !!doc.getFlag(MODULE_ID, FLAGS.profile);
  markNativeControls(root, configured && !doc.getFlag(MODULE_ID, FLAGS.disabled));

  if ( canEdit ) {
    section.querySelector("[data-ac-edit]")?.addEventListener("click", () => {
      EditorApp.open(doc);
    });
  }

  if ( canPrepare ) {
    section.querySelector("[data-ac-prepare]")?.addEventListener("click", event => {
      // v12 and v13 tile previews write the document itself
      if ( unsavedPick(root, "[name='texture.src']", src) ) return;
      runPrepare(src, event.currentTarget, () => {
        root.querySelector(".ac-config-section")?.remove();
        injectInto(app, root);
      });
    });
  }
}

function progressLabel(info) {
  if ( info?.phase === "decode" ) {
    return localize("Config.PrepareDecoding", { done: (Number(info.index) || 0) + 1, total: Number(info.total) || 0 });
  }
  if ( info?.phase === "encode" ) return localize("Config.PreparePacking");
  if ( info?.phase === "upload" ) return localize("Config.PrepareSaving");
  return localize("Config.Preparing");
}

function unsavedPick(root, selector, saved) {
  const field = root.querySelector(selector);
  if ( !field || ((field.value || null) === (saved || null)) ) return false;
  ui.notifications.warn(localize("Config.PrepareSaveFirst"));
  return true;
}

async function runPrepare(src, button, rebuild) {
  if ( !src || button.disabled ) return;

  const label = button.querySelector("[data-ac-prepare-label]");
  const original = label?.textContent ?? "";
  button.disabled = true;

  try {
    await prepareAsset(src, {
      onProgress: info => {
        if ( label ) label.textContent = progressLabel(info);
      }
    });
    ui.notifications.info(localize("Config.PrepareDone"));
    rebuild();
  } catch (err) {
    moduleWarn("prepare failed", err);
    ui.notifications.error(err?.message || localize("Errors.PrepareFailed"));
    if ( label ) label.textContent = original;
    button.disabled = false;
  }
}

function buildSurfaceSection(surface) {
  const src = surface.src;
  const { stateKey, stale, canEdit, canPrepare, summary } = sectionState(src, !!surface.behavior);

  const section = document.createElement("fieldset");
  section.className = "ac-config-section";
  section.dataset.acKind = surface.kind;

  const field = `flags.${MODULE_ID}.${FLAGS.sceneProfile}.disabled.${surface.kind}`;
  const box = `ac-config-disabled-${surface.kind}`;

  section.innerHTML = `
    <legend>${escapeHtml(localize("Config.Legend"))}: ${escapeHtml(surface.label)}</legend>
    <p class="hint">${escapeHtml(localize("Scene.SectionHint"))}</p>
    <div class="form-group">
      <label>${escapeHtml(localize("Config.Status"))}</label>
      <div class="form-fields">
        <span class="ac-config-state" data-state="${escapeHtml(stateKey)}">${escapeHtml(summary)}</span>
      </div>
    </div>
    <div class="form-group">
      <label for="${box}">${escapeHtml(localize("Config.Disable"))}</label>
      <div class="form-fields">
        <input type="checkbox" id="${box}" name="${field}" ${surface.disabled ? "checked" : ""}>
      </div>
      <p class="hint">${escapeHtml(localize("Config.DisableHint"))}</p>
    </div>
    <div class="ac-config-actions">
      ${canPrepare ? `
        <button type="button" class="ac-config-prepare" data-ac-prepare>
          <i class="fa-solid fa-wand-magic-sparkles"></i>
          <span data-ac-prepare-label>${escapeHtml(localize(stale ? "Config.PrepareAgain" : "Config.Prepare"))}</span>
        </button>
      ` : ""}
      <button type="button" class="ac-config-edit" data-ac-edit ${canEdit ? "" : "disabled"}>
        <i class="fa-solid fa-sliders"></i> ${escapeHtml(localize("Config.Configure"))}
      </button>
    </div>
  `;

  return { section, canEdit, canPrepare };
}

function surfacePlacement(root) {
  for ( const selector of ["[name='background.src']", "[name='foreground.src']", "[name='foreground']"] ) {
    const input = root.querySelector(selector);
    const tab = input?.closest(".tab");
    if ( tab ) return { node: tab, mode: "append" };
    const fieldset = input?.closest("fieldset");
    if ( fieldset ) return { node: fieldset, mode: "after" };
  }
  return null;
}

function injectSurfaces(app, root) {
  // v14 scene config edits the level's images instead of the scene's
  const doc = app?.defaultLevel ?? app?.document ?? app?.object;
  if ( !root || !doc ) return;

  const placement = surfacePlacement(root);
  for ( const kind of SURFACE_KINDS ) {
    if ( root.querySelector(`.ac-config-section[data-ac-kind="${kind}"]`) ) continue;
    const surface = new SceneSurface(doc, kind);
    if ( !surface.src ) continue;

    const { section, canEdit, canPrepare } = buildSurfaceSection(surface);
    if ( placement?.mode === "append" ) placement.node.appendChild(section);
    else if ( placement?.node?.parentElement ) {
      placement.node.parentElement.insertBefore(section, placement.node.nextSibling);
    }
    else {
      const form = root.querySelector("form") ?? root;
      const footer = form.querySelector("footer, .form-footer, .sheet-footer");
      if ( footer ) form.insertBefore(section, footer);
      else form.appendChild(section);
    }

    if ( !section.closest(".standard-form") ) section.classList.add("ac-plain-section");
    if ( canEdit ) section.querySelector("[data-ac-edit]")?.addEventListener("click", () => EditorApp.open(surface));
    if ( canPrepare ) {
      section.querySelector("[data-ac-prepare]")?.addEventListener("click", event => {
        // v12 and v13 name the foreground field without .src
        if ( unsavedPick(root, `[name='${surface.kind}.src'], [name='${surface.kind}']`, surface.src) ) return;
        runPrepare(surface.src, event.currentTarget, () => {
          for ( const old of root.querySelectorAll(".ac-config-section") ) old.remove();
          injectSurfaces(app, root);
        });
      });
    }
  }
}

export function registerConfigInjection() {
  onTileConfigRender((app, root) => injectInto(app, root));
  onTokenConfigRender((app, root) => injectInto(app, root));
  onSceneConfigRender((app, root) => injectSurfaces(app, root));
  onLevelConfigRender((app, root) => injectSurfaces(app, root));
}

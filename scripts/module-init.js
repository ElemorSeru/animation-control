import { MODULE_ID, SETTINGS, BUILD, moduleLog, moduleWarn } from "./constants.js";
import { loadTemplateFiles } from "./compat.js";
import { registerSettings } from "./settings.js";
import { registerConfigInjection } from "./config-inject.js";
import {
  registerPlaceableHooks, controllerFor, restart, attachTo, detachAll,
  reattachAll, issueCommand, actionsFor, goToLoop, continuePlayback, explainAttach, setTrace
} from "./placeables.js";
import { registerHudControls } from "./hud.js";
import { loadCatalog, indexFile, getEntry, flushCatalog } from "./catalog.js";
import { getAsset, deleteAsset } from "./profiles.js";
import { resolveProfile } from "./placeables.js";
import { prepareAsset } from "./bake.js";
import { checkForUpdate } from "./update-checker.js";
import { LibraryApp } from "./apps/library-app.js";
import { EditorApp } from "./apps/editor-app.js";
import { ControllerApp } from "./apps/controller-app.js";
import { kindForSource } from "./decode/index.js";

const TEMPLATES = [
  `modules/${MODULE_ID}/templates/library.hbs`,
  `modules/${MODULE_ID}/templates/editor.hbs`,
  `modules/${MODULE_ID}/templates/controller.hbs`
];

Hooks.once("init", () => {
  registerSettings();
  registerConfigInjection();
  registerPlaceableHooks();
  registerHudControls();

  game.keybindings.register(MODULE_ID, "toggleController", {
    name: `${MODULE_ID}.Keybind.ToggleController`,
    editable: [{ key: "KeyA", modifiers: ["Control", "Shift"] }],
    restricted: true,
    onDown: () => {
      ControllerApp.toggle();
      return true;
    }
  });

  game.keybindings.register(MODULE_ID, "openLibrary", {
    name: `${MODULE_ID}.Keybind.OpenLibrary`,
    editable: [{ key: "KeyL", modifiers: ["Control", "Shift"] }],
    restricted: true,
    onDown: () => {
      new LibraryApp().render(true);
      return true;
    }
  });
});

Hooks.once("setup", async () => {
  try {
    await loadTemplateFiles(TEMPLATES);
  } catch (err) {
    moduleWarn("templates failed to preload", err);
  }
});

Hooks.once("ready", async () => {
  if ( game.user.isGM ) {
    await loadCatalog().catch(err => moduleWarn("catalog load failed", err));
    checkForUpdate().catch(err => moduleWarn("update check failed", err));
  }

  game.modules.get(MODULE_ID).api = {
    getAsset,
    deleteAsset,
    profileFor: resolveProfile,
    prepareAsset,
    indexFile,
    openLibrary: () => new LibraryApp().render(true),
    openController: () => ControllerApp.open(),
    toggleController: () => ControllerApp.toggle(),
    openEditor: doc => EditorApp.open(doc),
    goToLoop,
    continuePlayback,
    restart,
    command: issueCommand,
    actionsFor,
    controllerFor,
    reattach: attachTo,
    reattachAll,
    trace: setTrace,
    diagnose,
    build: BUILD
  };

  moduleLog("ready, build " + BUILD);
});

async function diagnose(placeable) {
  const all = placeable
    ? [placeable]
    : [...(canvas?.tiles?.placeables ?? []), ...(canvas?.tokens?.placeables ?? [])];

  const targets = all.filter(t => !!resolveProfile(t) || !!controllerFor(t));
  if ( !targets.length ) {
    console.log(MODULE_ID + " | nothing on this scene is configured");
    return [];
  }

  const report = [];
  for ( const target of targets ) {
    const doc = target?.document;
    const src = doc?.texture?.src ?? null;
    const profile = resolveProfile(target);
    const controller = controllerFor(target);
    report.push({
      type: doc?.documentName,
      id: doc?.id,
      file: String(src ?? "").split("/").pop(),
      prepared: !!profile?.baked,
      controlled: !!controller,
      baked: controller?.isBaked ?? null,
      ...(controller?.debug ?? { loops: profile?.loops?.length ?? null }),
      why: controller ? "attached" : await explainAttach(target)
    });
  }

  console.table(report);
  return report;
}

function queueIndex(placeable) {
  if ( !game.user?.isGM ) return;
  if ( !game.settings.get(MODULE_ID, SETTINGS.indexOnPlacement) ) return;
  const src = placeable?.document?.texture?.src;
  if ( !src || !kindForSource(src) ) return;
  if ( getEntry(src) ) return;
  indexFile(src)
    .then(entry => { if ( entry ) ControllerApp.refresh(); })
    .catch(err => moduleWarn(`index failed for ${src}`, err));
}

Hooks.on("drawTile", queueIndex);
Hooks.on("drawToken", queueIndex);

for ( const hook of ["controlTile", "controlToken", "createTile", "createToken", "deleteTile", "deleteToken",
  "canvasReady", `${MODULE_ID}.attached`] ) {
  Hooks.on(hook, () => ControllerApp.refresh());
}

const LISTED_FIELDS = ["texture", "hidden", "name", "level", "levels"];

for ( const hook of ["updateTile", "updateToken"] ) {
  Hooks.on(hook, (doc, changed) => {
    if ( !changed?.flags?.[MODULE_ID] && !LISTED_FIELDS.some(field => field in (changed ?? {})) ) return;
    ControllerApp.refresh();
  });
}

Hooks.on("canvasTearDown", () => {
  flushCatalog().catch(err => moduleWarn("catalog flush failed", err));
});

window.addEventListener("beforeunload", () => {
  detachAll();
});

import { MODULE_ID, SETTINGS, DEFAULTS } from "./constants.js";
import { LibraryApp } from "./apps/library-app.js";
import { ControllerResetMenu } from "./apps/controller-app.js";
import { reattachAll } from "./placeables.js";

export function registerSettings() {
  game.settings.register(MODULE_ID, SETTINGS.assets, {
    scope: "world",
    config: false,
    type: Object,
    default: {},
    onChange: () => reattachAll()
  });

  game.settings.register(MODULE_ID, SETTINGS.controllerPosition, {
    scope: "client",
    config: false,
    type: Object,
    default: {}
  });

  game.settings.register(MODULE_ID, SETTINGS.controllerView, {
    scope: "client",
    config: false,
    type: Object,
    default: {}
  });

  game.settings.register(MODULE_ID, SETTINGS.roundSeconds, {
    name: `${MODULE_ID}.Settings.RoundSecondsName`,
    hint: `${MODULE_ID}.Settings.RoundSecondsHint`,
    scope: "world",
    config: true,
    type: Number,
    default: 6,
    range: { min: 1, max: 60, step: 1 }
  });

  game.settings.register(MODULE_ID, SETTINGS.updateCheckCache, {
    scope: "world",
    config: false,
    type: Object,
    default: {}
  });

  game.settings.register(MODULE_ID, SETTINGS.bakeMaxFrames, {
    name: `${MODULE_ID}.Settings.MaxFramesName`,
    hint: `${MODULE_ID}.Settings.MaxFramesHint`,
    scope: "world",
    config: true,
    type: Number,
    range: { min: 16, max: 240, step: 8 },
    default: DEFAULTS.bakeMaxFrames
  });

  game.settings.register(MODULE_ID, SETTINGS.bakeMaxEdge, {
    name: `${MODULE_ID}.Settings.MaxEdgeName`,
    hint: `${MODULE_ID}.Settings.MaxEdgeHint`,
    scope: "world",
    config: true,
    type: Number,
    choices: {
      128: "128",
      256: "256",
      384: "384",
      512: "512",
      768: "768"
    },
    default: DEFAULTS.bakeMaxEdge
  });

  game.settings.register(MODULE_ID, SETTINGS.indexOnPlacement, {
    name: `${MODULE_ID}.Settings.IndexOnPlacementName`,
    hint: `${MODULE_ID}.Settings.IndexOnPlacementHint`,
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.registerMenu(MODULE_ID, SETTINGS.controllerReset, {
    name: `${MODULE_ID}.Settings.ControllerResetName`,
    label: `${MODULE_ID}.Settings.ControllerResetLabel`,
    hint: `${MODULE_ID}.Settings.ControllerResetHint`,
    icon: "fa-solid fa-arrows-to-dot",
    type: ControllerResetMenu,
    restricted: true
  });

  game.settings.registerMenu(MODULE_ID, SETTINGS.libraryMenu, {
    name: `${MODULE_ID}.Settings.LibraryName`,
    label: `${MODULE_ID}.Settings.LibraryLabel`,
    hint: `${MODULE_ID}.Settings.LibraryHint`,
    icon: "fa-solid fa-film",
    type: LibraryApp,
    restricted: true
  });
}

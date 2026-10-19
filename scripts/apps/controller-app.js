import { MODULE_ID, SETTINGS, FLAGS, ACTION, KIND, localize, moduleWarn } from "../constants.js";
import { appV2, handlebarsMixin, inViewedLevel } from "../compat.js";
import { getAsset, behaviorOf, composeProfile } from "../profiles.js";
import { currentSurfaces } from "../scene-surface.js";
import { controllerFor, issueCommand, resolveProfile, allControllers } from "../placeables.js";
import { getEntry } from "../catalog.js";
import { kindForSource } from "../decode/index.js";
import { buttonsFor } from "../hud.js";
import { EditorApp } from "./editor-app.js";

const TEMPLATE = `modules/${MODULE_ID}/templates/controller.hbs`;

const STATE_TONE = { unprepared: "idle", unconfigured: "working", ready: "ready" };

const GROUPS = [
  { type: "scene", icon: "fa-map" },
  { type: "tile", icon: "fa-cubes", layer: "tiles" },
  { type: "token", icon: "fa-user", layer: "tokens" }
];

export function isAnimatedSource(src) {
  if ( !src ) return false;
  return (kindForSource(src) === KIND.video) || !!getEntry(src);
}

export function rowVisible(row, view) {
  if ( row.selected ) return true;
  if ( view.selectedOnly ) return false;
  return row.animated || view.stills;
}

export function sharedButtons(rows) {
  const ready = rows.filter(r => r.buttons.length);
  if ( ready.length < 2 ) return [];

  const first = ready[0].buttons.filter(b => !b.payload);
  return first.filter(spec => ready.every(row => row.buttons.some(b => b.action === spec.action)));
}

export function readView(saved) {
  const view = (saved && (typeof saved === "object")) ? saved : {};
  const types = GROUPS.map(g => g.type);
  return {
    collapsed: Array.isArray(view.collapsed) ? view.collapsed.filter(t => types.includes(t)) : [],
    selectedOnly: view.selectedOnly === true,
    stills: view.stills === true
  };
}

export class ControllerResetMenu extends appV2() {
  static DEFAULT_OPTIONS = { id: "animation-control-reset-position" };

  async render() {
    await game.settings.set(MODULE_ID, SETTINGS.controllerPosition, {});
    ControllerApp.resetPosition();
    ui.notifications.info(localize("Settings.ControllerResetDone"));
    return this;
  }
}

export class ControllerApp extends handlebarsMixin()(appV2()) {
  static DEFAULT_OPTIONS = {
    id: "animation-control-controller",
    classes: ["animation-control", "ac-controller"],
    tag: "div",
    window: {
      title: `${MODULE_ID}.Controller.Title`,
      icon: "fa-solid fa-sliders",
      resizable: true,
      minimizable: true
    },
    position: { width: 340, height: 560 },
    actions: {
      select: ControllerApp.#onSelect,
      centerOn: ControllerApp.#onCenterOn,
      applyToRest: ControllerApp.#onApplyToRest,
      configure: ControllerApp.#onConfigure,
      rowButton: ControllerApp.#onRowButton,
      sharedButton: ControllerApp.#onSharedButton,
      toggleGroup: ControllerApp.#onToggleGroup,
      groupPause: ControllerApp.#onGroupPause,
      groupResume: ControllerApp.#onGroupResume,
      foldAll: ControllerApp.#onFoldAll,
      filter: ControllerApp.#onFilter,
      stills: ControllerApp.#onStills,
      clearSelection: ControllerApp.#onClearSelection,
      goTo: ControllerApp.#onGoTo,
      pauseAll: ControllerApp.#onPauseAll,
      resumeAll: ControllerApp.#onResumeAll
    }
  };

  static PARTS = { body: { template: TEMPLATE } };

  static #instance = null;
  #rows = [];
  #allRows = [];
  #selectedRows = [];
  #shared = [];
  #view = readView();
  #scrollTop = 0;
  #scrollGoal = null;
  #thumbs = new Map();
  #saveTimer = null;
  #refreshTimer = null;

  static get instance() {
    return ControllerApp.#instance;
  }

  static async open() {
    if ( !game.user.isGM ) return null;
    ControllerApp.#instance ??= new ControllerApp();
    const app = ControllerApp.#instance;
    await app.render(true);
    app.#applySavedPosition();
    return app;
  }

  static async toggle() {
    if ( !game.user.isGM ) return null;
    const app = ControllerApp.#instance;
    if ( app?.rendered ) return app.close();
    return ControllerApp.open();
  }

  static refresh() {
    const app = ControllerApp.#instance;
    if ( !app?.rendered ) return;
    clearTimeout(app.#refreshTimer);
    app.#refreshTimer = setTimeout(() => app.render({ parts: ["body"] }), 40);
  }

  static resetPosition() {
    const app = ControllerApp.#instance;
    if ( !app?.rendered ) return;
    const { width, height } = ControllerApp.DEFAULT_OPTIONS.position;
    app.setPosition({ left: null, top: null, width, height });
  }

  #applySavedPosition() {
    const saved = game.settings.get(MODULE_ID, SETTINGS.controllerPosition);
    if ( !saved || (typeof saved !== "object") ) return;
    const left = Number(saved.left);
    const top = Number(saved.top);
    if ( !Number.isFinite(left) || !Number.isFinite(top) ) return;

    const maxLeft = Math.max(0, (window.innerWidth ?? 0) - 120);
    const maxTop = Math.max(0, (window.innerHeight ?? 0) - 60);
    const position = {
      left: Math.min(Math.max(0, left), maxLeft),
      top: Math.min(Math.max(0, top), maxTop)
    };
    const width = Number(saved.width);
    const height = Number(saved.height);
    if ( Number.isFinite(width) ) position.width = Math.min(width, window.innerWidth ?? width);
    if ( Number.isFinite(height) ) position.height = Math.min(height, window.innerHeight ?? height);
    this.setPosition(position);
  }

  setPosition(position) {
    const applied = super.setPosition(position);
    clearTimeout(this.#saveTimer);
    this.#saveTimer = setTimeout(() => {
      const { left, top, width, height } = this.position ?? {};
      if ( !Number.isFinite(left) || !Number.isFinite(top) ) return;
      const saved = { left, top };
      if ( Number.isFinite(width) ) saved.width = width;
      if ( Number.isFinite(height) ) saved.height = height;
      game.settings.set(MODULE_ID, SETTINGS.controllerPosition, saved)
        .catch(err => moduleWarn("could not remember the panel position", err));
    }, 400);
    return applied;
  }

  #layerName() {
    const name = canvas?.activeLayer?.constructor?.documentName;
    return ["Tile", "Token"].includes(name) ? name : "None";
  }

  #state(configured, src, controller) {
    const asset = src ? getAsset(src) : null;
    const state = (asset?.baked && configured) ? "ready" : (asset?.baked ? "unconfigured" : "unprepared");
    const paused = (state === "ready") && !!controller?.paused;
    return {
      state,
      tone: STATE_TONE[state] ?? "idle",
      shortLabel: localize(paused ? "Controller.Short_paused" : `Controller.Short_${state}`),
      stateLabel: localize(`Controller.State_${state}`)
    };
  }

  #describe(placeable, type) {
    const doc = placeable.document;
    const src = doc.texture?.src ?? "";
    const controller = controllerFor(placeable);
    const configured = !!doc.getFlag(MODULE_ID, FLAGS.profile);
    const file = String(src).split("/").pop() || localize("Controller.Unnamed");
    const named = (type === "token") && !!doc.name;

    return {
      key: `${type}:${doc.id}`,
      type,
      placeable,
      name: named ? doc.name : file,
      sub: named ? file : "",
      path: src,
      video: kindForSource(src) === KIND.video,
      animated: isAnimatedSource(src) || configured || !!controller,
      selected: !!placeable.controlled,
      hidden: !!doc.hidden,
      loopName: controller?.lockedLoop?.name ?? "",
      buttons: controller ? buttonsFor(controller) : [],
      ...this.#state(configured, src, controller)
    };
  }

  #describeSurface(surface) {
    const controller = controllerFor(surface);
    const configured = !!surface.behavior;
    return {
      key: `scene:${surface.id}`,
      type: "scene",
      isSurface: true,
      placeable: surface,
      name: surface.label,
      sub: String(surface.src).split("/").pop(),
      path: surface.src,
      video: kindForSource(surface.src) === KIND.video,
      animated: isAnimatedSource(surface.src) || configured || !!controller,
      selected: false,
      hidden: false,
      loopName: controller?.lockedLoop?.name ?? "",
      buttons: controller ? buttonsFor(controller) : [],
      ...this.#state(configured, surface.src, controller)
    };
  }

  #collectRows() {
    const rows = currentSurfaces().map(s => this.#describeSurface(s));
    for ( const group of GROUPS ) {
      if ( !group.layer ) continue;
      for ( const placeable of canvas?.[group.layer]?.placeables ?? [] ) {
        if ( !placeable.document?.texture?.src ) continue;
        if ( !inViewedLevel(placeable.document) ) continue;
        rows.push(this.#describe(placeable, group.type));
      }
    }
    return rows;
  }

  async _prepareContext() {
    this.#view = readView(game.settings.get(MODULE_ID, SETTINGS.controllerView));
    const view = this.#view;
    this.#allRows = this.#collectRows();
    this.#rows = this.#allRows.filter(row => rowVisible(row, view));
    this.#selectedRows = this.#allRows.filter(r => r.selected);
    this.#shared = sharedButtons(this.#selectedRows);

    const indexOf = new Map(this.#rows.map((row, index) => [row, index]));
    const readySelected = this.#selectedRows.filter(r => r.state === "ready").length;
    const groups = [];
    for ( const group of GROUPS ) {
      const rows = this.#rows.filter(r => r.type === group.type);
      if ( !rows.length ) continue;
      const mine = this.#allRows.filter(r => r.type === group.type);
      groups.push({
        type: group.type,
        icon: group.icon,
        label: localize(`Controller.Group_${group.type}`),
        count: mine.filter(r => r.animated).length,
        selectedCount: mine.filter(r => r.selected).length,
        collapsed: view.collapsed.includes(group.type),
        rows: rows.map(row => ({
          ...row,
          index: indexOf.get(row),
          still: !row.animated,
          buttons: row.buttons.map((b, button) => ({ ...b, button })),
          canApply: row.selected && (row.state === "ready") && (readySelected > 1),
          canCenter: !row.isSurface
        }))
      });
    }

    const selected = this.#selectedRows;
    const kind = selected[0]?.type ?? "token";
    const stills = this.#allRows.filter(r => !r.animated).length;
    const scene = canvas?.scene ?? null;

    return {
      sceneName: scene?.name ?? "",
      levelName: ((scene?.levels?.size ?? 0) > 1) ? (canvas.level?.name ?? "") : "",
      groups,
      hasRows: groups.length > 0,
      emptyHint: localize(view.selectedOnly ? "Controller.EmptySelected" : "Controller.EmptyScene"),
      selectedOnly: view.selectedOnly,
      stills: view.stills,
      allCollapsed: view.collapsed.length === GROUPS.length,
      hasSelection: selected.length > 0,
      selectionLabel: localize(`Controller.Selected${selected.length === 1 ? "One" : "Many"}_${kind}`, { count: selected.length }),
      chips: selected.map(row => ({
        key: row.key,
        type: row.type,
        name: row.name,
        tone: row.animated ? row.tone : "idle"
      })),
      shared: this.#shared.map((b, button) => ({ ...b, button })),
      hasShared: this.#shared.length > 0,
      animatedCount: localize("Controller.FooterAnimated", { count: this.#allRows.filter(r => r.animated).length }),
      stillCount: stills ? localize(view.stills ? "Controller.FooterStillsShown" : "Controller.FooterStillsHidden", { count: stills }) : "",
      layerLabel: localize(`Controller.Layer_${this.#layerName()}`)
    };
  }

  #thumbFor(row) {
    const key = `${row.key}|${row.path}`;
    let el = this.#thumbs.get(key);
    if ( el ) return el;
    if ( row.video ) {
      el = document.createElement("video");
      el.muted = true;
      el.loop = true;
      el.playsInline = true;
      el.preload = "metadata";
      el.addEventListener("loadedmetadata", () => {
        if ( Number.isFinite(el.duration) ) el.currentTime = el.duration / 2;
      }, { once: true });
    } else {
      el = document.createElement("img");
      el.loading = "lazy";
      el.alt = "";
    }
    el.draggable = false;
    el.src = row.path;
    this.#thumbs.set(key, el);
    return el;
  }

  async _onRender(context, options) {
    super._onRender?.(context, options);
    const root = this.element;

    const live = new Set();
    for ( const slot of root.querySelectorAll("[data-thumb]") ) {
      const row = this.#rows[Number(slot.dataset.thumb)];
      if ( !row?.path ) continue;
      const el = this.#thumbFor(row);
      live.add(el);
      slot.appendChild(el);
    }
    for ( const [key, el] of this.#thumbs ) {
      if ( live.has(el) ) continue;
      el.pause?.();
      this.#thumbs.delete(key);
    }

    for ( const rowEl of root.querySelectorAll(".ac-scene-row") ) {
      const video = rowEl.querySelector(".ac-scene-thumb video");
      if ( !video ) continue;
      if ( !rowEl.matches(":hover") ) video.pause();
      rowEl.addEventListener("pointerenter", () => video.play().catch(() => {}));
      rowEl.addEventListener("pointerleave", () => video.pause());
    }

    const body = root.querySelector(".ac-scene-body");
    if ( body ) {
      const goal = (this.#scrollGoal?.until > Date.now()) ? this.#scrollGoal.top : null;
      body.scrollTop = goal ?? this.#scrollTop;
      body.addEventListener("scroll", () => { this.#scrollTop = body.scrollTop; }, { passive: true });
    }
  }

  async #run(rows, spec) {
    for ( const row of rows ) {
      try {
        await issueCommand(row.placeable, spec.action, spec.payload ?? {});
      } catch (err) {
        moduleWarn("controller command failed", err);
      }
    }
    ControllerApp.refresh();
  }

  async #saveView(patch) {
    this.#view = { ...this.#view, ...patch };
    await game.settings.set(MODULE_ID, SETTINGS.controllerView, this.#view);
    await this.render({ parts: ["body"] });
  }

  #rowFrom(target) {
    const index = Number(target.closest("[data-index]")?.dataset.index);
    return Number.isInteger(index) ? this.#rows[index] : null;
  }

  async #groupCommand(target, action) {
    const type = target.closest("[data-group]")?.dataset.group;
    for ( const row of this.#allRows ) {
      if ( (row.type !== type) || !resolveProfile(row.placeable) ) continue;
      try {
        await issueCommand(row.placeable, action);
      } catch (err) {
        moduleWarn("group command failed", err);
      }
    }
    ControllerApp.refresh();
  }

  // Canvas only controls on its active layer
  static async #onSelect(event, target) {
    const row = this.#rowFrom(target);
    const placeable = row?.placeable;
    if ( !placeable || row.isSurface ) return;
    if ( !placeable.layer.active ) placeable.layer.activate();
    if ( event.shiftKey && placeable.controlled ) placeable.release();
    else placeable.control({ releaseOthers: !event.shiftKey });
  }

  static async #onCenterOn(event, target) {
    const row = this.#rowFrom(target);
    const placeable = row?.placeable;
    if ( !placeable ) return;
    const { x, y } = placeable.center ?? placeable.document ?? {};
    if ( !Number.isFinite(x) || !Number.isFinite(y) ) return;
    canvas.animatePan({ x, y, duration: 250 });
    // ping locally
    const style = CONFIG.Canvas?.pings?.types?.PULSE;
    if ( style !== undefined ) {
      canvas.controls?.handlePing?.(game.user, { x, y }, { scene: canvas.scene?.id, style, zoom: canvas.stage?.scale?.x ?? 1 });
    }
  }

  static async #onConfigure(event, target) {
    const row = this.#rowFrom(target);
    const placeable = row?.placeable;
    if ( !placeable ) return;
    await EditorApp.open(placeable.isSurface ? placeable : placeable.document);
  }

  static async #onRowButton(event, target) {
    const row = this.#rowFrom(target);
    const spec = row?.buttons?.[Number(target.dataset.btn)];
    if ( !spec ) return;
    await this.#run([row], spec);
  }

  static async #onSharedButton(event, target) {
    const spec = this.#shared[Number(target.dataset.btn)];
    if ( !spec ) return;
    await this.#run(this.#selectedRows.filter(r => r.buttons.length), spec);
  }

  static async #onApplyToRest(event, target) {
    const source = this.#rowFrom(target);
    if ( !source ) return;
    const behavior = source.placeable.document.getFlag(MODULE_ID, FLAGS.profile);
    if ( !behavior ) return;

    const others = this.#selectedRows.filter(r => r !== source);
    if ( !others.length ) return;

    let applied = 0;
    for ( const row of others ) {
      const doc = row.placeable.document;
      if ( !getAsset(doc.texture?.src)?.baked ) continue;
      try {
        await doc.setFlag(MODULE_ID, FLAGS.profile, behaviorOf(composeProfile(doc.texture.src, behavior)));
        applied++;
      } catch (err) {
        moduleWarn("could not apply settings", err);
      }
    }

    if ( applied ) ui.notifications.info(localize("Controller.Applied", { count: applied }));
    else ui.notifications.warn(localize("Controller.ApplyNothing"));
    ControllerApp.refresh();
  }

  static async #onToggleGroup(event, target) {
    const type = target.closest("[data-group]")?.dataset.group;
    const collapsed = new Set(this.#view.collapsed);
    if ( !collapsed.delete(type) ) collapsed.add(type);
    await this.#saveView({ collapsed: [...collapsed] });
  }

  static async #onGroupPause(event, target) {
    await this.#groupCommand(target, ACTION.pause);
  }

  static async #onGroupResume(event, target) {
    await this.#groupCommand(target, ACTION.resume);
  }

  static async #onFoldAll() {
    const allShut = this.#view.collapsed.length === GROUPS.length;
    await this.#saveView({ collapsed: allShut ? [] : GROUPS.map(g => g.type) });
  }

  static async #onFilter(event, target) {
    await this.#saveView({ selectedOnly: target.dataset.filter === "selected" });
  }

  static async #onStills() {
    await this.#saveView({ stills: !this.#view.stills });
  }

  static async #onClearSelection() {
    canvas?.tiles?.releaseAll();
    canvas?.tokens?.releaseAll();
  }

  static async #onGoTo(event, target) {
    const key = target.dataset.key;
    const row = this.#rows.find(r => r.key === key);
    if ( !row ) return;
    if ( this.#view.collapsed.includes(row.type) ) {
      await this.#saveView({ collapsed: this.#view.collapsed.filter(t => t !== row.type) });
    }
    const body = this.element.querySelector(".ac-scene-body");
    const el = body?.querySelector(`[data-key="${CSS.escape(key)}"]`);
    if ( !el ) return;
    const top = body.scrollTop + el.getBoundingClientRect().top - body.getBoundingClientRect().top - 10;
    this.#scrollGoal = { top, until: Date.now() + 1000 };
    body.scrollTo({ top, behavior: "smooth" });
    el.classList.add("ac-flash");
    el.addEventListener("animationend", () => el.classList.remove("ac-flash"), { once: true });
  }

  static async #onPauseAll() {
    await ControllerApp.#sceneWide(ACTION.pause);
  }

  static async #onResumeAll() {
    await ControllerApp.#sceneWide(ACTION.resume);
  }

  static async #sceneWide(action) {
    for ( const controller of allControllers() ) {
      const placeable = controller.placeable;
      if ( !placeable || !resolveProfile(placeable) ) continue;
      try {
        await issueCommand(placeable, action);
      } catch (err) {
        moduleWarn("scene command failed", err);
      }
    }
    ControllerApp.refresh();
  }

  async _preClose(options) {
    clearTimeout(this.#refreshTimer);
    clearTimeout(this.#saveTimer);
    for ( const el of this.#thumbs.values() ) el.pause?.();
    this.#thumbs.clear();
    return super._preClose?.(options);
  }
}

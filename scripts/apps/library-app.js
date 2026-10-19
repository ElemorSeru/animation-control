import { MODULE_ID, localize, moduleWarn } from "../constants.js";
import { appV2, handlebarsMixin, confirmDialog } from "../compat.js";
import {
  allEntries, loadCatalog, scanSources, defaultScanRoots,
  removeEntry, getEntry
} from "../catalog.js";
import { getAsset, deleteAsset, isBakeStale } from "../profiles.js";
import { prepareAsset } from "../bake.js";
import { extensionOf } from "../decode/index.js";
import { getUpdateInfo, openChangelog, injectUpdateBadge } from "../update-checker.js";
import { enhanceSelects } from "../dropdown.js";

const TEMPLATE = `modules/${MODULE_ID}/templates/library.hbs`;

// shared with the other GM Tools modules
const FOLDER_TONES = ["#3498db", "#e07856", "#a678d8", "#e8b84a", "#4a9e6f", "#4a9a8a", "#d86ba0"];

function folderTone(folder) {
  let hash = 0;
  for ( let i = 0; i < folder.length; i++ ) hash = ((hash << 5) - hash + folder.charCodeAt(i)) | 0;
  return FOLDER_TONES[Math.abs(hash) % FOLDER_TONES.length];
}

function rowState(entry, profile) {
  if ( entry.error ) return "failed";
  if ( !profile?.baked ) return "idle";
  return isBakeStale(profile, entry) ? "stale" : "ready";
}

function formatBytes(bytes) {
  if ( !bytes ) return "";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while ( value >= 1024 && unit < units.length - 1 ) {
    value /= 1024;
    unit++;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

export class LibraryApp extends handlebarsMixin()(appV2()) {
  static DEFAULT_OPTIONS = {
    id: "animation-control-library",
    classes: ["animation-control", "ac-library"],
    tag: "div",
    window: {
      title: `${MODULE_ID}.Library.Title`,
      icon: "fa-solid fa-film",
      resizable: true
    },
    position: { width: 860, height: 620 },
    actions: {
      scan: LibraryApp.#onScan,
      cancel: LibraryApp.#onCancel,
      prepareOne: LibraryApp.#onPrepareOne,
      prepareAll: LibraryApp.#onPrepareAll,
      collapseAll: LibraryApp.#onCollapseAll,
      expandAll: LibraryApp.#onExpandAll,
      forget: LibraryApp.#onForget,
      changelog: LibraryApp.#onChangelog
    }
  };

  static PARTS = {
    body: { template: TEMPLATE }
  };

  filter = { tab: "all", kind: "all", search: "" };
  job = null;
  #listScrollTop = 0;
  #collapsed = new Set();

  async _prepareContext() {
    await loadCatalog();

    const rows = allEntries().map(entry => {
      const profile = getAsset(entry.path);
      const state = rowState(entry, profile);
      const meta = [
        (extensionOf(entry.path) || entry.kind).toUpperCase(),
        (entry.width && entry.height) ? `${entry.width}x${entry.height}` : "",
        formatBytes(entry.size)
      ].filter(Boolean).join(" \u00b7 ");
      return {
        path: entry.path,
        name: entry.path.split("/").pop(),
        folder: entry.path.split("/").slice(0, -1).join("/"),
        kind: entry.kind,
        state,
        stateLabel: localize(`State.${state}`),
        meta,
        frames: profile?.baked?.count ?? entry.frames ?? 0,
        error: entry.error ?? null
      };
    });

    const filtered = rows.filter(row => {
      if ( (this.filter.tab === "ready") && (row.state !== "ready") ) return false;
      if ( (this.filter.tab === "work") && (row.state === "ready") ) return false;
      if ( this.filter.kind !== "all" && row.kind !== this.filter.kind ) return false;
      if ( this.filter.search && !row.path.toLowerCase().includes(this.filter.search.toLowerCase()) ) return false;
      return true;
    }).sort((a, b) => a.path.localeCompare(b.path));

    const byFolder = new Map();
    for ( const row of filtered ) {
      if ( !byFolder.has(row.folder) ) byFolder.set(row.folder, []);
      byFolder.get(row.folder).push(row);
    }

    const groups = [...byFolder.entries()].map(([folder, list]) => ({
      folder,
      label: folder || localize("Library.RootFolder"),
      tone: folderTone(folder),
      count: list.length,
      collapsed: this.#collapsed.has(folder),
      rows: list
    }));

    const update = getUpdateInfo();

    return {
      groups,
      rows: filtered,
      total: rows.length,
      shown: filtered.length,
      filter: this.filter,
      job: this.job,
      update,
      updateLabel: update ? localize("UpdateCheck.Available", { version: update.latest }) : "",
      tabs: [
        { value: "all", tone: "ac-tab-all", icon: "fa-film", label: localize("Filter.TabAll") },
        { value: "ready", tone: "ac-tab-ready", icon: "fa-circle-check", label: localize("Filter.TabReady") },
        { value: "work", tone: "ac-tab-work", icon: "fa-triangle-exclamation", label: localize("Filter.TabWork") }
      ].map(tab => ({ ...tab, active: tab.value === this.filter.tab })),
      kindOptions: [
        { value: "all", label: localize("Filter.AllKinds") },
        { value: "video", label: localize("Kind.video") },
        { value: "gif", label: localize("Kind.gif") },
        { value: "webp", label: localize("Kind.webp") },
        { value: "apng", label: localize("Kind.apng") }
      ].map(option => ({ ...option, selected: option.value === this.filter.kind }))
    };
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    const root = this.element;

    injectUpdateBadge(root);
    enhanceSelects(root);

    const list = root.querySelector(".ac-library-list");
    if ( list ) {
      list.scrollTop = this.#listScrollTop ?? 0;
      list.addEventListener("scroll", () => { this.#listScrollTop = list.scrollTop; });
    }

    // re-rendered part so rebind every render
    for ( const tab of root.querySelectorAll("[data-tab]") ) {
      tab.addEventListener("click", () => {
        this.filter.tab = tab.dataset.tab;
        this.render({ parts: ["body"] });
      });
    }

    for ( const header of root.querySelectorAll(".ac-group-header") ) {
      header.addEventListener("click", () => {
        const folder = header.closest("[data-folder]")?.dataset.folder ?? "";
        if ( this.#collapsed.has(folder) ) this.#collapsed.delete(folder);
        else this.#collapsed.add(folder);
        this.render({ parts: ["body"] });
      });
    }

    root.querySelector("[data-filter='kind']")?.addEventListener("change", event => {
      this.filter.kind = event.currentTarget.value;
      this.render({ parts: ["body"] });
    });

    const search = root.querySelector("[data-filter='search']");
    search?.addEventListener("input", foundry.utils.debounce(event => {
      this.filter.search = event.target.value ?? "";
      this.render({ parts: ["body"] });
    }, 250));
  }

  #setJob(job) {
    this.job = job;
    this.render({ parts: ["body"] });
  }

  static async #onScan() {
    if ( this.job ) return;
    const controller = new AbortController();
    this.#setJob({
      label: localize("Library.Scanning"),
      detail: "",
      progress: 0,
      controller
    });

    try {
      const result = await scanSources(defaultScanRoots(), {
        signal: controller.signal,
        onProgress: foundry.utils.debounce(info => {
          if ( !this.job ) return;
          this.job.detail = info.phase === "walk"
            ? localize("Library.Walking", { count: info.found })
            : localize("Library.Probing", { done: info.processed, total: info.total });
          this.job.progress = info.total ? Math.round((info.processed / info.total) * 100) : 0;
          this.render({ parts: ["body"] });
        }, 200)
      });
      ui.notifications.info(localize("Library.ScanComplete", { scanned: result.scanned, added: result.added }));
    } catch (err) {
      if ( err?.name !== "AbortError" ) {
        moduleWarn("scan failed", err);
        ui.notifications.error(localize("Errors.ScanFailed"));
      }
    } finally {
      this.job = null;
      this.render({ parts: ["body"] });
    }
  }

  static async #onCollapseAll() {
    const context = await this._prepareContext();
    for ( const group of context.groups ) this.#collapsed.add(group.folder);
    this.render({ parts: ["body"] });
  }

  static #onExpandAll() {
    this.#collapsed.clear();
    this.render({ parts: ["body"] });
  }

  static #onCancel() {
    this.job?.controller?.abort();
  }

  static async #onChangelog() {
    await openChangelog();
  }

  static async #onPrepareOne(event, target) {
    const path = target.closest("[data-path]")?.dataset.path;
    if ( !path || this.job ) return;
    await this.#runPrepare([path]);
  }

  static async #onPrepareAll() {
    if ( this.job ) return;
    const context = await this._prepareContext();
    const paths = context.rows
      .filter(row => (row.state === "idle") || (row.state === "stale"))
      .map(row => row.path);

    if ( !paths.length ) {
      ui.notifications.info(localize("Library.NothingToPrepare"));
      return;
    }

    const proceed = await confirmDialog({
      title: localize("Library.BulkTitle"),
      content: `<p>${localize("Library.BulkWarning", { count: paths.length })}</p>`,
      yesLabel: localize("Library.BulkConfirm"),
      noLabel: localize("Common.Cancel")
    });
    if ( !proceed ) return;
    await this.#runPrepare(paths);
  }

  async #runPrepare(paths) {
    const controller = new AbortController();
    this.#setJob({
      label: localize("Library.Preparing"),
      detail: "",
      progress: 0,
      controller
    });

    const started = performance.now();
    let done = 0;
    let failed = 0;

    for ( const path of paths ) {
      if ( controller.signal.aborted ) break;
      try {
        await prepareAsset(path, { signal: controller.signal });
      } catch (err) {
        if ( err?.name === "AbortError" ) break;
        failed++;
        moduleWarn(`prepare failed for ${path}`, err);
      }
      done++;

      const elapsed = performance.now() - started;
      const remaining = paths.length - done;
      const eta = done > 0 ? Math.round((elapsed / done) * remaining / 1000) : 0;
      this.job.detail = localize("Library.PrepareProgress", {
        done, total: paths.length, eta
      });
      this.job.progress = Math.round((done / paths.length) * 100);
      this.render({ parts: ["body"] });
    }

    this.job = null;
    if ( failed ) ui.notifications.warn(localize("Library.PrepareFailures", { count: failed }));
    else if ( done ) ui.notifications.info(localize("Library.PrepareComplete", { count: done }));
    this.render({ parts: ["body"] });
  }

  static async #onForget(event, target) {
    const path = target.closest("[data-path]")?.dataset.path;
    if ( !path ) return;

    const proceed = await confirmDialog({
      title: localize("Library.ForgetTitle"),
      content: `<p>${localize("Library.ForgetWarning")}</p>`,
      yesLabel: localize("Library.ForgetConfirm"),
      noLabel: localize("Common.Cancel")
    });
    if ( !proceed ) return;

    await deleteAsset(path);
    if ( !getEntry(path) ) removeEntry(path);
    this.render({ parts: ["body"] });
  }
}

import { MODULE_ID, SETTINGS, localize, moduleWarn } from "./constants.js";
import { dialogV2, escapeHtml } from "./compat.js";

const REPO = "ElemorSeru/animation-control";
const CACHE_HOURS = 12;

let updateInfo = null;

export function getUpdateInfo() {
  return updateInfo;
}

function compareVersions(a, b) {
  const pa = String(a ?? "").replace(/^v/i, "").split(".").map(n => parseInt(n, 10) || 0);
  const pb = String(b ?? "").replace(/^v/i, "").split(".").map(n => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for ( let i = 0; i < len; i++ ) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if ( x !== y ) return x > y ? 1 : -1;
  }
  return 0;
}

function markdownToHtml(md) {
  const lines = String(md ?? "").replace(/\r\n/g, "\n").split("\n");
  let html = "";
  let inList = false;
  for ( const raw of lines ) {
    const trimmed = raw.trim();
    const escaped = escapeHtml(trimmed).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
    if ( /^#{1,3}\s+/.test(trimmed) ) {
      if ( inList ) { html += "</ul>"; inList = false; }
      html += `<h4>${escaped.replace(/^#{1,3}\s+/, "")}</h4>`;
    } else if ( /^[-*]\s+/.test(trimmed) ) {
      if ( !inList ) { html += "<ul>"; inList = true; }
      html += `<li>${escaped.replace(/^[-*]\s+/, "")}</li>`;
    } else if ( trimmed === "" ) {
      if ( inList ) { html += "</ul>"; inList = false; }
    } else {
      if ( inList ) { html += "</ul>"; inList = false; }
      html += `<p>${escaped}</p>`;
    }
  }
  if ( inList ) html += "</ul>";
  return html;
}

async function fetchReleases() {
  const response = await fetch(`https://api.github.com/repos/${REPO}/releases`, {
    headers: { Accept: "application/vnd.github+json" }
  });
  if ( !response.ok ) throw new Error(`github releases request failed: ${response.status}`);
  return response.json();
}

export async function checkForUpdate() {
  const installed = game.modules.get(MODULE_ID)?.version;
  if ( !installed ) return null;

  const cached = game.settings.get(MODULE_ID, SETTINGS.updateCheckCache);
  const now = Date.now();
  const fresh = cached?.checkedAt
    && (cached.installedVersion === installed)
    && ((now - cached.checkedAt) < CACHE_HOURS * 3600 * 1000);
  if ( fresh ) {
    updateInfo = cached.result ?? null;
    return updateInfo;
  }

  let releases;
  try {
    releases = await fetchReleases();
  } catch (err) {
    moduleWarn("update check failed", err);
    updateInfo = cached?.result ?? null;
    return updateInfo;
  }

  const newer = [];
  for ( const release of Array.isArray(releases) ? releases : [] ) {
    if ( release.draft || release.prerelease ) continue;
    const tag = release.tag_name ?? release.name ?? "";
    if ( compareVersions(tag, installed) <= 0 ) continue;
    newer.push({ version: tag, date: release.published_at, body: release.body ?? "" });
  }
  newer.sort((a, b) => compareVersions(b.version, a.version));

  const result = newer.length ? { latest: newer[0].version, releases: newer } : null;
  await game.settings.set(MODULE_ID, SETTINGS.updateCheckCache, {
    checkedAt: now,
    installedVersion: installed,
    result
  });
  updateInfo = result;
  return result;
}

function buildChangelog(info) {
  let html = '<div class="ac-update-changelog">';
  for ( const release of info.releases ) {
    const dateStr = release.date
      ? new Date(release.date).toLocaleDateString(game.i18n.lang, { year: "numeric", month: "short", day: "numeric" })
      : "";
    html += `<div class="ac-update-release">
      <div class="ac-update-release-head">
        <span class="ac-update-version">${escapeHtml(release.version)}</span>
        <span class="ac-update-date">${escapeHtml(dateStr)}</span>
      </div>
      ${markdownToHtml(release.body || localize("UpdateCheck.NoNotes"))}
    </div>`;
  }
  html += `<div class="ac-update-foot">
    <a href="https://github.com/${REPO}/releases" target="_blank" rel="noopener">${escapeHtml(localize("UpdateCheck.ViewHistory"))}</a>
  </div></div>`;
  return html;
}

export async function openChangelog() {
  if ( !updateInfo ) return;
  const DialogV2 = dialogV2();
  await DialogV2.wait({
    classes: ["animation-control", "ac-update-dialog"],
    window: { title: localize("UpdateCheck.Title"), resizable: true },
    position: { width: 480, height: 520 },
    content: buildChangelog(updateInfo),
    rejectClose: false,
    buttons: [
      {
        action: "close",
        label: localize("UpdateCheck.Close"),
        default: true,
        callback: () => true
      }
    ]
  });
}

export function injectUpdateBadge(root) {
  const header = root?.closest?.(".application")?.querySelector?.(".window-header")
    ?? root?.querySelector?.(".window-header");
  if ( !header ) return;

  header.querySelector(".ac-update-badge")?.remove();
  if ( !updateInfo ) return;

  const badge = document.createElement("button");
  badge.type = "button";
  badge.className = "header-control fa-solid fa-arrows-rotate icon ac-update-badge";
  badge.dataset.tooltip = localize("UpdateCheck.Tooltip", { version: updateInfo.latest });
  badge.addEventListener("click", event => {
    event.stopPropagation();
    openChangelog();
  });

  const closeButton = header.querySelector('button[data-action="close"]');
  if ( closeButton ) closeButton.insertAdjacentElement("beforebegin", badge);
  else header.appendChild(badge);
}

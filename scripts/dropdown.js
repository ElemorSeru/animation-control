// custom list since v12's native one can't be restyled
let open = null;

export function enhanceSelects(root) {
  for ( const select of root?.querySelectorAll?.("select") ?? [] ) enhanceSelect(select);
}

export function enhanceSelect(select) {
  if ( !select || select.multiple || (select.size > 1) || select.dataset.acDropdown ) return select;
  select.dataset.acDropdown = "1";
  select.addEventListener("mousedown", event => {
    if ( event.button !== 0 ) return;
    event.preventDefault();
    if ( open?.select === select ) close();
    else show(select);
  });
  select.addEventListener("keydown", event => onKey(select, event));
  return select;
}

function show(select) {
  if ( select.disabled ) return;
  close();
  select.focus();
  const style = getComputedStyle(select);
  const list = document.createElement("div");
  list.className = "ac-dropdown";
  list.setAttribute("role", "listbox");
  list.style.fontSize = style.fontSize;
  list.style.fontFamily = style.fontFamily;
  list.style.color = style.color;
  list.style.setProperty("--ac-dd-bg", style.backgroundColor);
  list.style.setProperty("--ac-dd-border", style.borderColor);
  const accent = style.getPropertyValue("--ac-accent").trim();
  if ( accent ) list.style.setProperty("--ac-dd-accent", accent);

  const items = [];
  const addOption = (option, parent) => {
    const row = document.createElement("div");
    row.className = "ac-dropdown-option";
    row.setAttribute("role", "option");
    row.textContent = option.textContent;
    if ( option.disabled || parent?.disabled ) row.classList.add("disabled");
    if ( option.selected ) row.classList.add("selected");
    row.setAttribute("aria-selected", String(option.selected));
    const index = items.length;
    row.addEventListener("pointermove", () => activate(index, false));
    row.addEventListener("click", () => pick(index));
    items.push({ row, option, disabled: row.classList.contains("disabled") });
    list.appendChild(row);
  };
  for ( const child of select.children ) {
    if ( child.tagName === "OPTGROUP" ) {
      const head = document.createElement("div");
      head.className = "ac-dropdown-group";
      head.textContent = child.label;
      list.appendChild(head);
      for ( const option of child.children ) addOption(option, child);
    }
    else if ( child.tagName === "OPTION" ) addOption(child, null);
  }
  if ( !items.length ) return;

  document.body.appendChild(list);
  open = { select, list, items, active: -1, typed: "", typedAt: 0 };
  activate(Math.max(0, items.findIndex(i => i.option.selected)), true);
  place();
  document.addEventListener("pointerdown", onOutside, true);
  window.addEventListener("resize", close);
  const follow = () => {
    if ( open?.list !== list ) return;
    if ( !select.isConnected || !select.offsetParent ) return close();
    place();
    requestAnimationFrame(follow);
  };
  requestAnimationFrame(follow);
}

function place() {
  const { select, list } = open;
  const rect = select.getBoundingClientRect();
  const below = window.innerHeight - rect.bottom - 8;
  const above = rect.top - 8;
  const wanted = Math.min(list.scrollHeight, 320);
  const up = (below < wanted) && (above > below);
  list.style.minWidth = `${rect.width}px`;
  list.style.maxHeight = `${Math.max(80, Math.min(320, up ? above : below))}px`;
  const width = list.offsetWidth;
  list.style.left = `${Math.max(4, Math.min(rect.left, window.innerWidth - width - 4))}px`;
  list.style.top = up ? `${Math.max(4, rect.top - list.offsetHeight - 2)}px` : `${rect.bottom + 2}px`;
}

function activate(index, scroll) {
  if ( !open || (index < 0) || (index >= open.items.length) ) return;
  open.items[open.active]?.row.classList.remove("active");
  open.active = index;
  open.items[index].row.classList.add("active");
  if ( scroll ) open.items[index].row.scrollIntoView({ block: "nearest" });
}

function step(from, by) {
  const { items } = open;
  let i = from;
  for ( let n = 0; n < items.length; n++ ) {
    const next = i + by;
    if ( (next < 0) || (next >= items.length) ) return i;
    i = next;
    if ( !items[i].disabled ) return i;
  }
  return from;
}

function pick(index) {
  const item = open?.items[index];
  if ( !item || item.disabled ) return;
  const { select } = open;
  close();
  select.focus();
  if ( item.option.selected ) return;
  item.option.selected = true;
  select.dispatchEvent(new Event("input", { bubbles: true }));
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

function onKey(select, event) {
  const current = (open?.select === select) ? open : null;
  const key = event.key;
  if ( !current ) {
    if ( ["Enter", " ", "ArrowDown", "ArrowUp"].includes(key) ) {
      event.preventDefault();
      show(select);
    }
    return;
  }
  const page = 8;
  const moves = {
    ArrowDown: () => step(current.active, 1),
    ArrowUp: () => step(current.active, -1),
    PageDown: () => step(Math.min(current.items.length - 1, current.active + page - 1), 1),
    PageUp: () => step(Math.max(0, current.active - page + 1), -1),
    Home: () => step(-1, 1),
    End: () => step(current.items.length, -1)
  };
  if ( moves[key] ) {
    event.preventDefault();
    activate(moves[key](), true);
  }
  else if ( (key === "Enter") || (key === " ") ) {
    event.preventDefault();
    pick(current.active);
  }
  else if ( key === "Escape" ) {
    event.preventDefault();
    event.stopPropagation();
    close();
  }
  else if ( key === "Tab" ) close();
  else if ( (key.length === 1) && !event.ctrlKey && !event.metaKey && !event.altKey ) {
    event.preventDefault();
    const now = Date.now();
    current.typed = ((now - current.typedAt > 700) ? "" : current.typed) + key.toLowerCase();
    current.typedAt = now;
    const hit = current.items.findIndex(i => !i.disabled && i.option.textContent.trim().toLowerCase().startsWith(current.typed));
    if ( hit !== -1 ) activate(hit, true);
  }
}

function onOutside(event) {
  if ( !open || open.list.contains(event.target) || (event.target === open.select) ) return;
  close();
}

function close() {
  if ( !open ) return;
  const { list } = open;
  open = null;
  list.remove();
  document.removeEventListener("pointerdown", onOutside, true);
  window.removeEventListener("resize", close);
}

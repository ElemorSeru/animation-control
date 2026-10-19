import { ACTION, LOOP_MODE, RELEASE, ENGAGE, START, localize, moduleWarn } from "./constants.js";
import { rootElement } from "./compat.js";
import { controllerFor, issueCommand } from "./placeables.js";

function makeButton({ icon, tooltip, action, active = false }) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "control-icon ac-hud-button" + (active ? " ac-hud-active" : "");
  button.dataset.acAction = action;
  button.dataset.tooltip = tooltip;
  button.setAttribute("aria-label", tooltip);
  button.innerHTML = '<i class="fa-solid ' + icon + '" inert></i>';
  return button;
}

function releaseTooltip(controller, loop) {
  if ( loop.release === RELEASE.stop ) return localize("Hud.ContinueStop");
  if ( loop.release === RELEASE.goto ) {
    const target = controller.loops.find(l => l.id === loop.gotoId);
    if ( target?.name ) return localize("Hud.ContinueTo", { name: target.name });
  }
  return localize("Hud.Continue");
}

export function buttonsFor(controller) {
  const buttons = [];
  const loop = controller.lockedLoop;
  const running = !controller.idle;

  buttons.push({
    icon: controller.fadedOut ? "fa-eye" : "fa-eye-slash",
    tooltip: localize(controller.fadedOut ? "Hud.FadeIn" : "Hud.FadeOut"),
    action: ACTION.fadeToggle,
    active: controller.fadedOut
  });

  buttons.push(running
    ? {
      icon: "fa-rotate-left",
      tooltip: localize(controller.profile?.playOn === START.trigger ? "Hud.PlayAgain" : "Hud.Restart"),
      action: ACTION.play
    }
    : { icon: "fa-play", tooltip: localize("Hud.Play"), action: ACTION.play });

  if ( running && !controller.ended ) {
    buttons.push(controller.paused
      ? { icon: "fa-play", tooltip: localize("Hud.Resume"), action: ACTION.resume }
      : { icon: "fa-pause", tooltip: localize("Hud.Pause"), action: ACTION.pause });
  }

  if ( running && controller.isBaked && (loop?.mode !== LOOP_MODE.pingpong) ) {
    buttons.push({
      icon: "fa-backward",
      tooltip: localize("Hud.Reverse"),
      action: ACTION.reverse,
      active: controller.reversed
    });
  }

  if ( running && loop ) {
    buttons.push({
      icon: loop.release === RELEASE.stop ? "fa-stop" : "fa-forward-step",
      tooltip: releaseTooltip(controller, loop),
      action: ACTION.continue
    });
  }

  for ( const target of controller.loops ) {
    if ( target.engage !== ENGAGE.jump ) continue;
    if ( loop?.id === target.id ) continue;
    buttons.push({
      icon: "fa-diamond-turn-right",
      tooltip: localize("Hud.JumpTo", { name: target.name || localize("Hud.UnnamedLoop") }),
      action: ACTION.goto,
      payload: { loopId: target.id }
    });
  }

  return buttons;
}

function injectHud(hud, html) {
  const root = rootElement(html);
  const placeable = hud?.object;
  if ( !root || !placeable ) return;

  root.querySelector(".ac-hud-group")?.remove();

  const controller = controllerFor(placeable);
  if ( !controller ) return;

  const column = root.querySelector(".col.right") ?? root.querySelector(".col.middle");
  if ( !column ) return;

  const group = document.createElement("div");
  group.className = "ac-hud-group";

  for ( const spec of buttonsFor(controller) ) {
    const button = makeButton(spec);
    button.addEventListener("click", async event => {
      event.preventDefault();
      event.stopPropagation();
      try {
        await issueCommand(placeable, spec.action, spec.payload ?? {});
      } catch (err) {
        moduleWarn("hud command failed", err);
      }
      injectHud(hud, hud.element ?? root);
    });
    group.appendChild(button);
  }

  const loop = controller.lockedLoop;
  if ( loop?.name ) {
    const label = document.createElement("div");
    label.className = "ac-hud-segment";
    label.textContent = loop.name;
    group.appendChild(label);
  }

  column.appendChild(group);
}

export function registerHudControls() {
  Hooks.on("renderTileHUD", injectHud);
  Hooks.on("renderTokenHUD", injectHud);
}

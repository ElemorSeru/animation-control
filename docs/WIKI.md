This guide covers how to use every part of Animation Control. If something is not covered here, check the Issues tab on GitHub.

---

## Table of Contents

- [How It Works](#how-it-works)
- [Quick Start](#quick-start)
- [Supported Files](#supported-files)
  - [Indexing and Preparing](#indexing-and-preparing)
- [The Animation Library](#the-animation-library)
  - [Getting Files Into the Library](#getting-files-into-the-library)
  - [Preparing Everything Listed](#preparing-everything-listed)
  - [Forgetting a File](#forgetting-a-file)
  - [Statuses](#statuses)
- [The Editor](#the-editor)
  - [Opening It](#opening-it)
  - [The Layout](#the-layout)
  - [The Timeline](#the-timeline)
  - [Loops and Pauses](#loops-and-pauses)
  - [Hold For](#hold-for)
  - [Getting a Clean Seam](#getting-a-clean-seam)
  - [Whole Clip Settings](#whole-clip-settings)
  - [When It Ends](#when-it-ends)
  - [Speed and Direction](#speed-and-direction)
  - [Copies of This File](#copies-of-this-file)
  - [Entering and Leaving](#entering-and-leaving)
  - [Sound](#sound)
  - [Sound While Held](#sound-while-held)
  - [Files Without Sound](#files-without-sound)
  - [Play It](#play-it)
- [The Animation Panel](#the-animation-panel)
  - [Rows](#rows)
  - [Row Controls](#row-controls)
  - [Selecting From the Panel](#selecting-from-the-panel)
  - [Groups, Filters and Pausing Everything](#groups-filters-and-pausing-everything)
  - [Sizes](#sizes)
  - [Scene and Level Images](#scene-and-level-images)
  - [Position](#position)
- [HUD Controls](#hud-controls)
- [Per-Object Settings](#per-object-settings)
- [Module Settings](#module-settings)
- [Playing With a Table](#playing-with-a-table)
- [Where Things Are Saved](#where-things-are-saved)
- [API](#api)
- [Troubleshooting](#troubleshooting)
- [Compatibility Notes](#compatibility-notes)

---

## How It Works

An animated tile in Foundry either repeats from end to end forever or plays once and stops. Most animation packs pack a whole story into one clip though. A portal opens, stays open for a second and collapses, and at the table you want that middle part for as long as the scene goes.

Animation Control keeps the whole clip as it is and lets you put **markers** on it. A marker is either a **loop**, a section the playhead repeats until it's told to move on, or a **pause**, a single frame it stops on.

A campfire is one loop over the burning part that never lets go. A portal is a loop over its open state that waits until you continue it, then lets the clip finish and collapse. A rune that flares when you press a button is two loops, one for idling and one the playhead only goes to when you send it there.

You never cut the file, and you don't need a video editor.

---

## Quick Start

1. Place an animated tile. With the default settings it's added to the library on its own.
2. Open the tile's configuration sheet and press **Configure animation** in the **Animation Control** section.
3. If the file isn't prepared yet, press **Prepare and analyze** and wait for it to finish.
4. Press **Find loops** and pick a suggestion, or press **Add loop** and drag it where you want it.
5. Press **Play it** to see it run the way it will on the scene.
6. Press **Save**.

Nothing changes on the scene until an object has been configured and saved. Preparing a file only gets it ready.

---

## Supported Files

| Format | Foundry on its own | With Animation Control |
|---|---|---|
| `.webm` | Animates | Loops, pauses, seams, Entering and Leaving |
| `.mp4` | Animates | Same |
| `.gif` | **Doesn't show** | Animates, with everything above |
| `.webp` (animated) | **One still frame** | Animates, with everything above |
| `.apng` | **Doesn't show** | Animates, with everything above |
| `.png` (animated) | **One still frame** | Animates, with everything above |

Still images are skipped, so a folder of normal PNGs won't show anything in the library.

---

### Indexing and Preparing

**Indexing** reads the start of a file to learn its size, length and whether it moves, then adds it to the library. It takes a moment and happens on its own when an animated tile or token is drawn, as long as **Index files as they are used** is on.

**Preparing** decodes every frame and saves them as one image. It only happens when you ask, once per file, and it has to happen before an object using that file can be configured, since the editor builds its timeline from those frames.

You can prepare a file from:

- **Prepare this file** in the Animation Control section of a tile, token, scene or level sheet. It shows progress and updates the status when it's done. On a scene or level, save a newly picked image first.
- **Prepare and analyze** in the editor, shown in place of the timeline for a file that needs it.
- **The Animation Library**, one file or a whole folder.

If the file gets replaced after it was prepared, the sheet says so and the button turns into **Prepare again**.

Preparing is per file. Prepare `portal.webm` once and every portal you place with it is ready to configure.

---

## The Animation Library

Open it from **Game Settings, Module Settings, Animation Library**, or with **Ctrl+Shift+L**.

The library is for getting files prepared. It doesn't configure anything, since settings are saved on the objects you place.

Files are grouped by folder with their format, dimensions, size and status. Click a folder heading to fold it, or use the double chevrons to fold or open every folder. The **All files**, **Ready** and **Needs work** tabs filter by status, and the search box and **Any format** picker narrow it down further.

---

### Getting Files Into the Library

- **Place an animated tile or token** - it's indexed as it's drawn, as long as **Index files as they are used** is on
- **Scan for files** - looks through your Data folder for animated files. It only reads the start of each file but can still take a while on a big install, so it shows progress and you can cancel and keep what it found

Scanning doesn't prepare anything. A big effects pack can have thousands of files, and you pick what's worth preparing.

---

### Preparing Everything Listed

**Prepare listed** prepares whatever the list is showing right now. Use the tabs, search and format picker to choose. Searching a folder name and pressing it prepares just that folder.

It tells you how many files it's about to do and roughly how long it'll take, then shows a running estimate. You can cancel any time and keep the files it already finished.

---

### Forgetting a File

**Forget this file** clears a file's prepared frames. Objects using it stop animating until it's prepared again, but their settings are kept and the original file isn't touched.

---

### Statuses

Each row has a status label, and the edge of the row takes the same color so a long list is easy to scan.

| Status | What it means |
|---|---|
| Not prepared | Indexed, but no frames saved yet |
| Preparing | Working on it now |
| Ready | Frames are saved and it can be configured |
| Out of date | The file was replaced after it was prepared. Prepare it again |
| Failed | Something went wrong. The reason is on the row |

---

## The Editor

### Opening It

Press **Configure animation** on a tile, token, scene or level sheet, or the sliders button on a row in the animation panel.

The editor always works on one object. Two torches using the same file each get their own settings.

If the file isn't prepared, the editor shows **Prepare and analyze** instead of the timeline.

---

### The Layout

The top half has the preview and the timeline, so the frames get the full width of the window.

- **The preview** - plays the selected loop on repeat, or the whole clip when nothing is selected. Hovering a **Find loops** suggestion previews it without changing anything
- **Seam** - to the right of the preview, scores the join of the selected loop and plays just the joint, slowed down
- **Preview on** - Dark, Light or Checkerboard behind the preview, handy for effects with soft edges
- **The toolbar** - between the preview and the timeline. It has the playback controls, the **Plays** readout, **Add loop**, **Add pause**, **Find loops** and the zoom buttons

The bottom half scrolls. The **Whole clip** settings and the suggestions from **Find loops** are on the left, and the selected loop or pause is on the right. **Revert changes** and **Save** are at the bottom.

When the editor opens it starts playing the way the object will on the scene, and the playhead on the timeline follows that run.

---

### The Timeline

The timeline has four lanes:

- **Time** - seconds along the clip
- **Frames** - the prepared frames as a filmstrip
- **Loops** - your loops and pauses. Drag one to move it, or drag either edge of a loop to resize it
- **Sound** - the waveform, when the file has sound in it

Zoom in for fine work on a long clip, or press **Fit to width** to see all of it.

The handles at both ends of the timeline let you start or end the clip somewhere other than its own first and last frame. The **Plays** readout shows the range, and **Use the whole clip** puts it back. Most files don't need this.

---

### Loops and Pauses

**Add loop** puts a new loop on the timeline and **Add pause** adds a pause at the playhead. Select one on the **Loops** lane to see its settings on the right.

| Setting | Options | What it does |
|---|---|---|
| Loop or Pause | a name | Shows on the buttons in the panel and HUD, so you know what you're pressing |
| How it plays | Loop, Ping-pong | Repeats forwards, or forwards then backwards. Loops only |
| Loop seam | Hard cut, Blend | How the end of a loop joins back to its start |
| When the playhead reaches it | Hold here, Pass through | Whether the playhead stops at it on the way past |
| Hold for | see below | How long it holds |
| When released | Carry on through the clip, Jump to another marker, Stop here | What happens once the hold is over |
| Entering this loop / Leaving this loop | Fade, Grow, Shrink | A transition for this loop only, see [Entering and Leaving](#entering-and-leaving) |

**Pass through** means the playhead skips it during normal playback. It only plays when something sends the playhead there: a **Jump to** button, another marker set to **Jump to another marker**, or **When it ends** set to **Go to a marker and hold**.

A pause stops on its frame with no sound until the hold is over or someone presses **Continue**. It's handy for a map that changes in stages, where each stage waits until you move it along. While paused nothing is redrawn, and players who reload or join late see the same frame.

A loop only a few frames wide gets a warning under **How it plays**. A loop that short looks frozen even though it's animating.

---

### Hold For

| Option | When it lets go |
|---|---|
| Until continued | When someone presses **Continue** |
| A number of loops | After that many repeats. Not offered for pauses |
| A number of seconds | After that many seconds |
| A number of rounds | After that many combat rounds |

Loops are counted the way they look. A ping-pong counts there and back as one, and a blended loop counts its shorter blended length.

Rounds come from the combat running on the object's own scene, even if the tracker is showing a different one. You can go look at other scenes and the count still comes out right.

Round length comes from the game system, and dnd5e and PF2e both use six seconds. If a system doesn't set one, the **Seconds per round** setting is used. With no combat running, rounds are counted as that many seconds each, so a two round hold lasts twelve seconds. If combat ends partway through a hold, it waits one more round and then lets go.

However the hold ends, **When released** decides what's next.

---

### Getting a Clean Seam

A loop looks like it's restarting when its last frame and first frame don't match.

- **Hard cut** - jumps straight back. Fine when the two frames already match, and the lightest on the computer
- **Blend** - crossfades the end of the loop into its start, which hides the jump on something that moves the whole time
- **Ping-pong** - plays forwards then backwards, so there's no jump at all. Looks wrong on anything moving one way, since a swirling portal will swirl back the other way

The **Seam** pane scores the selected loop while you drag it, with five dots and a word from **Visible jump** to **Seamless**. Next to the score it plays just the joint slowed down, which is much easier to judge than the whole loop.

The score compares the jump back against how much the clip normally changes from one frame to the next. A good seam is one you can't tell apart from the clip just carrying on.

**Find loops** checks every frame against every other frame and lists the best places to loop, under **Suggested loops**. It leans a little toward longer loops and skips stretches where nothing moves, since a still patch matches itself and looks broken. Hover a suggestion to preview it, click it to use it for the selected loop, or press its plus to add it as a new loop.

If a loop still jumps, try another suggestion and switch the seam to **Blend**. Some clips just don't have a clean loop in them.

---

### Whole Clip Settings

These are at the top left and apply to the whole animation.

- **Before it plays** - **Play as soon as it appears**, or **Wait until I trigger it**
- **While it waits** - **Show its first frame**, or **Stay invisible**. Pair **Stay invisible** with an Entering fade to have it appear from nothing
- **When it ends**, **Speed**, **Direction**, **Copies of this file**, **Sound level** and **Sound fades** are covered below
- **Entering** and **Leaving** - fades and scaling for the whole clip

---

### When It Ends

What happens when the playhead reaches the end of the clip:

| Option | What it does |
|---|---|
| Stop on the last frame | Stops and shows the last frame. The default |
| Stop on the first frame | Goes back to the start and stops there, usually better for something decorative |
| Stop and hide | Disappears right away |
| Repeat the whole clip | Starts over from the beginning, every time |
| Go to a marker and hold | Goes back to the loop you pick in **Go to** and keeps going from there |

**Repeat the whole clip** replaces Foundry's loop checkbox, which the module has to turn off to run the animation itself. Every marker works again on each repeat, and everyone at the table stays on the same frame.

**Go to a marker and hold** gives you a clip that plays its opening once and then settles into a loop. If that loop is set to carry on instead of holding forever, it plays to the end and drops back in again, so the whole clip becomes a long cycle. If the loop you picked gets deleted, it falls back to **Stop on the last frame**.

A loop set to **Stop here** still stops, it doesn't go back.

If you want it to go away gently, use a Leaving fade instead of **Stop and hide**.

When the clip runs backwards, its end is the start of the timeline.

---

### Speed and Direction

**Speed** runs from 0.25x to 4x, and it's set per object, so two torches on the same webm can burn at different speeds.

Speed changes how long **A number of loops** takes, since a faster clip finishes its loops sooner. **A number of seconds** and **A number of rounds** last the same at any speed.

**Direction** set to **Backwards** plays the whole clip in reverse. Loops and pauses work as the playhead reaches them, and a loop plays backwards too. It's saved with the object, so it's still backwards after a reload. It needs a prepared file and does nothing until the file is prepared.

A pack that only has a door closing gives you a door opening.

---

### Copies of This File

Eight torches from one webm all pulse at the same moment, and it's obvious they're copies. **Copies of this file** spreads them out:

- **Stay in step** - all the same. The default, and right for a ring of runes that should pulse together
- **Drift slightly apart**
- **Spread over half a cycle**
- **Spread anywhere in the cycle**

Each object gets the same offset on every player's screen, and a duplicated tile gets a different one. A scene's background and foreground count as two objects.

Only the picture shifts. Holds still last the same, so spreading the torches doesn't change when any of them lets go. The editor preview always shows the unshifted version.

---

### Entering and Leaving

Both the whole clip and each loop can have an **Entering** and a **Leaving**. Entering can **Fade** and **Grow**, and Leaving can **Fade** and **Shrink**. **Over (ms)** sets how long each one takes, 400 by default.

The two work a little differently:

- **Leaving** on the whole clip happens once the last frame is reached, and the object ends where it is
- **Leaving this loop** happens when the playhead leaves that loop. The clip keeps going afterward, so it fades or shrinks out and comes straight back. Shrink here gives a quick pinch at the seam

The fade button on the HUD and panel uses the whole clip's Leaving time.

---

### Sound

The module plays a file's sound itself, through Foundry's ambient sound, so the **Ambient Volume** slider in Foundry's audio settings still works on it.

- **Sound level** - per object and starts at zero, so nothing is heard until you turn it up. Two torches on one file can be at different levels
- **Sound fades** - **Fade in** and **Fade out** use the Entering and Leaving durations. A clip that fades in over 600ms brings its sound up over the same 600ms

The sound plays along with the picture. When the clip runs backwards the sound does too, a jump moves the sound with it, and at a different speed the pitch shifts to match. A fade from the HUD takes the sound down and brings it back with the picture.

Only one object per file plays sound. Without that, eight torches on one webm would be eight copies of the same crackle.

---

### Sound While Held

A hold has no set length, but the sound does, so each loop decides what to do with it:

- **Let it keep playing** - the sound runs on underneath, good for a background crackle or hum
- **Loop the slice** - plays a chosen part of the sound over and over until the hold ends
- **Duck it** - turns the sound down to **Level while held** until the loop lets go
- **Silent** - turns it off for the hold

For **Loop the slice**, the section shows on the **Sound** lane and starts out lined up with the loop. That's a guess, and it usually sounds better on a part of the sound that repeats cleanly, so drag it until it does. **Match the loop** lines it up again. **Crossfade (ms)** smooths the join, 20 by default.

The section can reach over another loop, and the editor tells you when it does in case you didn't mean to. Sound past the end of the clip is marked on the lane and only plays if a slice reaches it.

When the hold ends, the sound lines back up with the picture.

**Duck it** and **Silent** use the loop's Entering and Leaving times to go down and come back up.

---

### Files Without Sound

The sound settings turn off when there's nothing to hear, with a message saying why:

- **This file has no sound in it** - includes a track that's completely silent
- **The sound in this file could not be read** - there might be no sound track, or the browser can't play its format, and there's no way to tell which
- **This file's sound is longer than** a set number of seconds - too long to keep in memory, so it's left alone

The settings are greyed out with a reason instead of hidden. Preparing the file again checks the sound again, which you'd want after replacing the file anyway.

---

### Play It

The editor plays the animation when it opens, the same way it plays on the scene, with the same buttons the object gets on the canvas: continue, jump, pause, reverse, fade and restart. A line next to them says what it's doing, like **Playing**, **Holding at** a loop's name, **Waiting to be triggered** or **Finished**.

The main button changes with what's going on: **Play it** when nothing is running, **Stop** while it runs, and **Play again** once it's finished. **Toggle repeat play** next to it starts a finished run over. It's off by default and does nothing on a clip that never ends.

Changing a setting while it plays updates the run straight away without jumping back to the start. **Stop** goes back to repeating the selected loop, which is the better way to judge a seam.

---

## The Animation Panel

Press **Ctrl+Shift+A** to open or close it, or call `api.toggleController()`. GMs and Assistant GMs only.

The panel lists everything animated on the scene you're viewing, grouped into **Scene**, **Tiles** and **Tokens**. You don't need to select anything first.

Files that aren't prepared or configured are listed too, with their status, so you can see what still needs setting up. A file counts as animated if it's a video, or if the library found more than one frame in it. Still images are hidden until you turn on **Stills**, and the footer counts both.

---

### Rows

Each row has a preview, the name, the status and the controls for that object. Tokens show the token's name with the file under it. Tiles don't have names in Foundry, so they show the file. Hidden tokens are marked as hidden from players.

The preview shows a frame from the middle of the clip, since a lot of effects start faded out, and plays while you hover over it.

| Status | What it means |
|---|---|
| Ready | Configured and under the module's control |
| Paused | Paused on a frame |
| Not set up | Prepared but not configured yet. Press the sliders button |
| Not prepared | The file needs preparing first |

- **Center** (crosshair) - centers the view on it and leaves your selection alone
- **Configure** (sliders) - opens the editor

---

### Row Controls

These are the same buttons the object gets on its HUD. Which ones show depends on what the object is doing:

| Button | Shows when |
|---|---|
| **Play** (play) | It's waiting to be triggered |
| **Restart** (circular arrow) | It has started. Plays it again from the beginning |
| **Pause / Resume** | It hasn't finished |
| **Continue** (step forward) | It's holding at a loop or pause. Shows a stop icon and **Finish and stop** if its **When released** is **Stop here**, and **Continue to** a name when it jumps |
| **Reverse** (backwards) | The file is prepared and it isn't in a ping-pong loop |
| **Fade out / Fade in** (eye) | Always. One button that switches between the two |
| **Jump to** a name (turn arrow) | One for each loop set to **Pass through**, except the one it's in |

---

### Selecting From the Panel

- **Click a row** and that object gets selected on the canvas. If it's on another layer, the panel switches layers for you first
- **Shift-click** to add or remove it from the selection

Whatever is selected on the canvas gets a ring in the list. A strip across the top names what's selected, like **2 tiles selected**. Click a name to scroll to it, which also opens its group if it was folded. **Clear the selection** (x) empties it.

With more than one selected, the strip shows the buttons they all have in common. If one of them has finished and can't pause, pause isn't offered. Jump buttons never show here since loop names only mean something on their own object.

**Apply these settings to the rest of the selection** (clone) on a selected row copies that object's settings to everything else selected. Objects whose file isn't prepared are skipped, and it tells you how many it changed.

The list doesn't scroll on its own. Saving, other people's commands and selection changes leave your scroll position and folded groups alone. Only clicking a name in the strip scrolls it.

---

### Groups, Filters and Pausing Everything

- **Pause / Resume** on a group header - pauses or resumes everything configured in that group
- **Pause all / Resume all** in the header - the whole scene at once
- Click a group header to fold it, or use the double chevron to fold or open all of them
- **All** (layers) - everything on the scene
- **Selected** (pointer) - only what's selected. Anything selected is listed even if it's a still image
- **Stills** (image) - show still images too

---

### Sizes

The panel arranges itself by its own width:

- **Default width** - one list, with the buttons under each name
- **Wider than about 520 pixels** - two columns, with the status moved down next to the buttons so names have room
- **Wider than about 800 pixels** - a grid of big previews, and the header buttons get labels. Good for a popped out window or a second screen

---

### Scene and Level Images

A scene's background and foreground can't be selected like tiles and tokens, but they're listed under **Scene** and work the same way.

On v12 and v13 their settings are saved on the scene. On v14 each level has its own images, so the settings are saved on the level and the panel shows the level you're looking at. The background and foreground each keep their own settings and playback.

Set them up from **Scene Configuration**, or the level's sheet on v14. Each animated image gets its own Animation Control section there, or use the sliders button on its panel row.

---

### Position

Double click the title to collapse the panel to its title bar, and again to open it.

The panel remembers its position, size, folded groups and your **Stills** and **Selected** choices, for each user. If the screen is smaller than last time it moves itself back into view. If it ever ends up somewhere you can't reach, press **Reset position** under **Animation panel position** in module settings.

---

## HUD Controls

Select a controlled object and right click it, and its HUD gets the same buttons as its panel row. See [Row Controls](#row-controls) for which show when.

**Reverse** only shows for prepared files, because Foundry can't play a video backwards.

---

## Per-Object Settings

Tile, token and prototype token sheets, scene sheets, and level sheets on v14 get an **Animation Control** section next to Foundry's video options. It shows the status and has **Configure animation** and **Ignore for this one**, which leaves that object on Foundry's own playback.

| Status | What it means |
|---|---|
| Not indexed yet | The library hasn't seen this file |
| Not prepared yet | Indexed, press **Prepare this file** |
| Prepared, not configured | Press **Configure animation** to set it up |
| Configured and prepared | Under the module's control, with its frame count |
| The file changed since it was prepared | Press **Prepare again** |

**Settings are saved on the object, not the file.** Two tiles using the same webm can be set up completely differently and only share the prepared frames. Duplicate a configured tile and its settings come along, which works like a preset.

An object you've never configured keeps Foundry's own playback, even if its file is prepared and other objects use it.

While the module controls an object, Foundry's **Loop Video** and **Autoplay Video** boxes are greyed out and say **Set by Animation Control**. Their values are left as they were, so nothing changes if you turn the module off later.

---

## Module Settings

| Setting | Scope | Default | What it does |
|---|---|---|---|
| Animation panel position | Client | | **Reset position** puts the panel back in view |
| Animation Library | | | **Open Library** brings up the Animation Library |
| Seconds per round | World | 6 | Round length when the system doesn't set one, or when no combat is running |
| Maximum frames per file | World | 96 | Most frames saved per file. More is smoother and takes more disk and memory |
| Prepared frame size | World | 512 | Longest side of each saved frame, 128 to 768 pixels |
| Index files as they are used | World | On | Indexes animated tiles and tokens as they're drawn |

| Keybinding | Default |
|---|---|
| Show or hide the animation panel | Ctrl+Shift+A |
| Open the Animation Library | Ctrl+Shift+L |

Both can be changed in **Configure Controls**.

If a prepared animation looks blurry on a big tile, raise **Prepared frame size** and prepare it again. If a long clip looks choppy, raise **Maximum frames per file**. Going above the file's own resolution doesn't add detail.

---

## Playing With a Table

Playback runs off the server's clock, so everyone sees the same frame at the same time no matter when their scene loaded.

A button pressed by the GM takes effect on their screen straight away and on everyone else's right after, so when you close a portal, it closes for everyone together. Pausing stops the clock for everyone, and resuming starts them all from the same frame.

Players who join late or reload pick up where everyone else is. Browsers won't play sound until you've clicked something on the page, so a late player might see the right frame with no sound until they click.

Only a GM can prepare files.

---

## Where Things Are Saved

- **Object settings** - your loops, pauses, holds, Entering and Leaving, speed and sound level, saved as a flag on the tile or token. A scene's images keep theirs on the scene, or on the level on v14
- **Prepared file records** - where each file's frames are and their sizes and timing, saved in a world setting
- **The frames** - one image per prepared file in the module's own storage, which is kept through module updates
- **The library list** - a file in the module's storage. If it's ever damaged it's thrown out and a scan rebuilds it

The module only reads your animation files and never changes them.

Preparing the same file again replaces its old frames instead of making another copy. A file only counts as prepared once its frames are fully saved, so closing Foundry partway through a big batch loses the file it was on and nothing else. Canceling works the same way.

Disabling or uninstalling the module puts every object back on normal Foundry playback. The settings stay on each object and the frames stay in storage, so nothing is lost if you turn it back on later.

---

## API

```js
const api = game.modules.get("animation-control").api;

api.openLibrary();
api.openController();
api.toggleController();
api.openEditor(tile.document);            // takes a document, not a placeable
await api.prepareAsset("modules/my-pack/portal.webm");
await api.indexFile("modules/my-pack/portal.webm");

api.restart(tile);              // back to the beginning
api.goToLoop(tile, loopId);     // send the playhead to a marker
api.continuePlayback(tile);     // same as pressing continue

// commands, mirrored to every client
await api.command(tile, "pause");
await api.command(tile, "resume");
await api.command(tile, "reverse");
await api.command(tile, "fadeToggle");

api.profileFor(tile);   // the object's settings composed with its file's frames, or null
api.actionsFor(tile);   // what that object can do right now, or null if uncontrolled
api.controllerFor(tile);
api.reattachAll();      // reapply settings to the current scene
api.diagnose();         // print a table explaining what is and is not controlled
api.trace(true);        // verbose logging while chasing something

api.getAsset(src);      // the prepared file record
await api.deleteAsset(src);
api.build;              // build stamp, for confirming what is loaded
```

The playback functions take a Tile or Token from the canvas, not a document, and return `false` if the module isn't controlling that object.

---

## Troubleshooting

**I placed a tile and nothing changed.** Nothing changes until the object is configured. Open its sheet and press **Configure animation**. Preparing a file in the library only gets it ready.

**The library is empty.** Place an animated tile or token, or press **Scan for files**. Only animated files show up, so a folder of normal images stays empty.

**A GIF or APNG doesn't show, or a tile has a warning triangle.** Foundry can't show those formats on the canvas. Prepare the file from the Animation Library or the tile's sheet and it'll show up and move.

**Ping-pong, Blend or Reverse don't do anything.** All three need the file prepared.

**A loop moves but looks frozen.** It's probably only a few frames wide. The editor warns you under **How it plays**. Make it wider on the timeline.

**The animation looks blurry.** Raise **Prepared frame size** and prepare it again.

**The loop still jumps.** Try a different **Find loops** suggestion and set the seam to **Blend**. If it moves in one direction and still jumps, the clip might not have a clean loop, and ping-pong won't look right on it either.

**A file says "Out of date".** It was replaced after it was prepared. Prepare it again.

**"This browser cannot decode that format".** Preparing an animated WebP or APNG needs Chromium, so a GM on Firefox or Safari should prepare it from the desktop Foundry app. GIF and video files work in any browser.

**The animation panel won't open.** It's for GMs and Assistant GMs only. If you're a GM and still can't see it, press **Reset position** under **Animation panel position** in module settings.

**An animated GIF, WebP or PNG isn't in the panel.** Those can be animated or still, so the panel only lists one as animated after the library has found more than one frame in it. With **Index files as they are used** on, that happens the first time it's drawn. Otherwise prepare it from the Animation Library. Until then it's listed under **Stills**.

**A change didn't show up after updating.** Hard refresh with Ctrl+F5. To check what's loaded, run `game.modules.get("animation-control").api.build` in the console.

**Something else is wrong.** Run `game.modules.get("animation-control").api.diagnose()` in the console. It prints every animated tile and token with whether it's indexed, configured, prepared and controlled, which usually points right at the problem.

---

## Compatibility Notes

Works on Foundry v12.328 through v14 and with any game system. The only thing it reads from the system is round length, and the **Seconds per round** setting covers systems that don't have one. It's been checked with the token sheets dnd5e and PF2e use.

Preparing files needs the GM to have upload permission, which GMs have by default.

After updating, hard refresh with Ctrl+F5, since Foundry doesn't refresh the module's other script files on a normal reload.

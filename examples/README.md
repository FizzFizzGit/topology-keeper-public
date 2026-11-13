# Portable Window prototype

English | [日本語](README.ja.md)

Open `portable-window.html` directly in a browser. No installation, build, Obsidian,
framework, network access or storage service is required.
Use the language links or `?lang=en` / `?lang=ja` to switch the demo UI language.

Copy `src/windows/portable-window.js`, `src/windows/portable-window.css` and the root `LICENSE` to
another project. The JavaScript supports a browser script (`PortableWindow`) and
CommonJS (`require`). This is an experimental library API, not a published package.

`createWindow({ mount, title, closeLabel, position, onPosition, onClose })` returns
`{ element, head, body, show, hide, destroy }`. Append your own DOM to `body`.
`mount` defaults to the document body; the shell uses viewport-fixed positioning.
Theme with `--pw-background`, `--pw-text`, and `--pw-border` CSS variables.
`applyAppearance(element, { fontScale: 120, maxHeightPercent: 70, widthPx: 480, minHeightPx: 160, minWidthPx: 200 })`
applies 120% text, a 70vh height cap, 480px maximum width, 200px minimum width and 160px minimum height through CSS variables.
Omitted values restore 100% text and the stylesheet's original height/width. Set minHeightPx to 0 to remove the minimum; height remains automatic within these bounds.
Width grows to fit content within its minimum and maximum, constrained to the viewport by CSS. Hosts save these options.
Pass a translated `closeLabel` for the close button; the default is English.

For existing shells use `attachDrag(element, handle, { onPosition })`; its return
value disposes listeners, including an active drag. Rebinding the same element
cleans up its previous binding. `detachDrag(element)` also cleans it up.
`constrain(element)` fits the position within its owner document's viewport.
Interactive header controls do not initiate dragging. The host owns persistence;
the demo optionally saves coordinates to localStorage. The library does not.

`registerWindow(element)` joins the document's shared stacking group and returns
`{ bringToFront, dispose }`. Pointer presses anywhere inside the window and keyboard
focus raise it without intercepting controls. `createWindow` registers automatically.
Use `createWindowStack({ baseZIndex })` for a separate group. The host keeps popovers
and modal dialogs in higher layers; z-indices do not increase on each click.

`createFrame(element, { headClass, bodyClass })` adds an empty header and body to
an existing shell and returns `{ head, body }`. It does not clear existing content
or register interactions. This is also the frame builder used by `createWindow`.
Hosts can choose their own CSS classes without depending on the demo stylesheet.

Topology Keeper uses this frame builder, drag controller and viewport constraints
for its main, analysis and isolation windows, retaining styling and saved settings. Analysis
rendering, Obsidian APIs, translations, graph rendering and info popovers remain
in the plugin. Resize handles, touch dragging and dockable panels are not part of
this first extraction. Reuse in another web app is demonstrated by the standalone
page rather than by claiming the entire plugin UI is portable.

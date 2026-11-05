# Chumi.edit

A free photo editor that runs entirely in your browser. Layers, selections, brushes, type, color adjustments and filters, with nothing uploaded and no account.

- **Landing page:** `index.html`
- **Editor:** `editor.html` (open a sample straight away with `editor.html?sample=golden-lake`)

## What the editor does

- **Layers:** raster, text and shape layers; drag to reorder, rename, hide, lock; 16 blend modes and opacity per layer
- **Selections:** marquee, lasso and magic wand, with feather, grow, shrink and invert
- **Paint:** brush, eraser, clone stamp, bucket and gradient
- **Type:** 16 fonts, weight, size, color, spacing and alignment, editable at any time
- **Color:** exposure, contrast, saturation, hue, warmth, tint, black and white, sepia and invert per layer, a histogram, and ready-made looks
- **Filters:** 14 filters with a live preview (blur, motion blur, sharpen, noise, pixelate, vignette, glow, RGB split, emboss, find edges, posterize, threshold, invert, black and white)
- **History:** up to 70 undo steps, click any step to jump back
- **Command palette:** `Ctrl/Cmd + K` searches every command with its shortcut
- **Files:** opens PNG, JPG, WebP, GIF, BMP, AVIF and SVG; exports PNG, JPG and WebP; saves projects as `.chumi.json` (all layers kept); autosaves to the browser's own storage
- Works on phones and tablets (panels fold into a drawer). Photoshop PSD files are not supported.

Pictures never leave the device: everything is read, edited and exported inside the tab.

## Run it locally

It is plain HTML, CSS and JavaScript with no build step. Serve the folder with any static server, because the editor reads pixels from canvases and browsers block that for `file://` pages:

```bash
python3 -m http.server 8000
# then open http://localhost:8000/
```

## Publish it

Any static host works (GitHub Pages, Netlify, and so on). For GitHub Pages, serve the `main` branch from the repository root.

## Layout

```
index.html        landing page
editor.html       the editor
css/boot.css      page loader (shared)
css/landing.css   landing page styles
css/editor.css    editor styles
js/boot.js        page loader controller (shared)
js/landing.js     landing page: live picture, scroll scenes (GSAP + ScrollTrigger from cdnjs)
js/adjust.js      color adjustment engine (shared by the editor and the landing page)
js/engine.js      documents, layers, history, selection, import and export
js/tools.js       every tool on the left rail
js/filters.js     filters
js/ui-core.js     dialogs, menus, command palette, keyboard
js/ui-panels.js   toolbar, options bar, side panels, welcome screen
js/samples.js     the sample pictures
assets/           logo mark, favicon, sample pictures and editor screenshots
```

The landing page loads GSAP 3.12.5 and ScrollTrigger from cdnjs and Bricolage Grotesque and Geist from Google Fonts. If GSAP cannot load, or the visitor prefers reduced motion, every section still shows in place without animation.

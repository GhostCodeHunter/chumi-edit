# Chumi.edit

A free photo editor that runs in your browser. Layers, selections, brushes, type, color adjustments, filters and smart tools such as remove background and generative fill, with no account. Pictures stay on your device unless you choose to send them (see [Privacy](#privacy)).

- **Landing page:** `index.html`
- **Editor:** `editor.html` (open a sample straight away with `editor.html?sample=golden-lake`)

## What the editor does

- **Layers:** raster, text and shape layers; drag to reorder, rename, hide, lock; 16 blend modes and opacity per layer
- **Selections:** marquee, lasso and magic wand, with feather, grow, shrink and invert
- **Paint:** brush, eraser, clone stamp, bucket and gradient
- **Smart tools** (AI menu): remove background, select subject, blur background, content-aware fill, the remove brush (`J`) and generative fill
- **Type:** 16 fonts, weight, size, color, spacing and alignment, editable at any time
- **Color:** exposure, contrast, saturation, hue, warmth, tint, black and white, sepia and invert per layer, a histogram, and ready-made looks
- **Filters:** 14 filters with a live preview (blur, motion blur, sharpen, noise, pixelate, vignette, glow, RGB split, emboss, find edges, posterize, threshold, invert, black and white)
- **History:** up to 70 undo steps, click any step to jump back
- **Command palette:** `Ctrl/Cmd + K` searches every command with its shortcut
- **Files:** opens PNG, JPG, WebP, GIF, BMP, AVIF and SVG; exports PNG, JPG and WebP; saves projects as `.chumi.json` (all layers kept); autosaves to the browser's own storage
- Works on phones and tablets (panels fold into a drawer). Photoshop PSD files are not supported.

## Privacy

Pictures stay on the device by default: files are read, edited and exported inside the tab, and autosave uses the browser's own storage.

- **Remove background, select subject and blur background** run a small model (`assets/models/u2netp.onnx`, 4.6 MB) on the device with [ONNX Runtime Web](https://onnxruntime.ai/). The runtime is fetched from a public CDN (jsDelivr, then unpkg, then cdnjs) the first time it is used. No picture data is sent. If the runtime cannot load, a simpler color-based cut-out is used and the editor says so.
- **Content-aware fill and the remove brush** run on the device.
- **Generative fill with a description** is the only tool that sends anything out. After an explicit confirmation it sends a crop of the area around the selection, plus the description, to the service chosen in the dialog: the free [AI Horde](https://aihorde.net) community (volunteer-run, so other people could see what is sent) or any OpenAI-compatible `/images/edits` endpoint with your own key. With no description, the selection is filled on the device instead. Nothing is sent until the confirmation is ticked.

## Credits

- **Background removal model:** `u2netp` from [U²-Net](https://github.com/xuebinqin/U-2-Net) (Qin et al., "U²-Net: Going Deeper with Nested U-Structure for Salient Object Detection", Pattern Recognition 2020). The code is Apache-2.0; the author states the weights were trained on the DUTS dataset, so check its terms before using this project commercially. The ONNX file is the copy distributed by [rembg](https://github.com/danielgatis/rembg).
- **Runtime:** [ONNX Runtime Web](https://onnxruntime.ai/) (MIT), loaded from a public CDN.
- **Free generative fill:** the community-run [AI Horde](https://aihorde.net).

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

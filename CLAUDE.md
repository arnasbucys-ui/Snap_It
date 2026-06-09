# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm start        # launch the Electron app (also: npm run dev)
```

There are no tests or linting configured.

## Architecture

Snap-It is an **Electron desktop app** with a single-window design. The Electron main process (`main.js`) opens `index.html` with `nodeIntegration: true` and `contextIsolation: false`, which means the renderer process (the web page) can call Node.js APIs (`require('fs')`, etc.) directly.

### Module system

There is no bundler. All source files are plain `<script>` tags loaded at the bottom of `index.html`. Each module wraps itself in an IIFE and attaches to `window`, so the **script load order matters**:

```
cameraStub.js → cameraModule.js → library.js → audioEngine.js → ui.js
```

`ui.js` calls `ui.init()` at the end of the file, which bootstraps everything.

### Key modules and responsibilities

| File | Responsibility |
|---|---|
| `src/cameraModule.js` | Webcam access via `getUserMedia`; runs COCO-SSD for live bounding-box overlay and on-demand scan |
| `src/cameraStub.js` | Thin event bus: the scan button calls `cameraStub.simulateScan(type)` → fires the handler registered by `ui.js` via `cameraStub.onObjectScanned(handler)` |
| `src/library.js` | Source of truth for what the player owns; persists to `localStorage` under key `snapit.library.v1`; reads `data/objectSampleMap.json` on load |
| `src/audioEngine.js` | Loads all WAV samples as `Tone.Player` instances; owns the 16-step sequencer state; drives `Tone.Transport`; handles export via `Tone.Recorder` (writes `.webm` to `~/Downloads`) |
| `src/ui.js` | All DOM rendering and event wiring; the only file that touches the page |
| `data/objectSampleMap.json` | **Single source of truth** mapping object keys → `{ sampleFile, displayName }`. Adding a new scannable object means adding an entry here and dropping the WAV in `/samples/` |

### Third-party library loading quirk

Tone.js and TensorFlow.js/COCO-SSD ship as UMD bundles. Because Electron's `nodeIntegration` makes `module` and `exports` globals available in the renderer, those bundles would bind to `module.exports` instead of `window`. `index.html` temporarily sets `window.module = undefined` and `window.exports = undefined` around each `<script>` tag to force the browser branch, then restores them. Don't change this pattern.

### Scan flow

1. `cameraModule.scan()` runs COCO-SSD on the current video frame, filters by `CONFIDENCE_THRESHOLD` (0.60) and the `COCO_TO_SAMPLE` mapping (COCO class names → internal keys), and returns `{ type, confidence }` or `null`.
2. `ui.js` calls `cameraStub.simulateScan(type)` with the result.
3. `cameraStub` fires the registered handler → `library.unlock(type)` → `audioEngine` / `renderLibrary()`.

### Adding a new scannable object

1. Add the COCO-SSD class name → internal key entry to `COCO_TO_SAMPLE` in `src/cameraModule.js`.
2. Add the internal key → `{ sampleFile, displayName }` entry to `data/objectSampleMap.json`.
3. Drop the WAV one-shot into `/samples/` with the matching filename.

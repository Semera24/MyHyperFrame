# HyperFrames Custom Studio & ProductionStudio — Phase 4 Workflow & Layer System Specification

## Overview

We are upgrading **HyperFrames Custom Studio** (`/Users/yonassayfu/Projects/HyperFrames_Custom_Studio/hyperframes`) and adding non-destructive workflow utilities in `/Users/yonassayfu/Projects/ProductionStudio/shared/tools/` specifically tailored to the **Turning Point Stories** documentary production pipeline (`1920x1080 @ 30fps`, Lawrence narration, editorial cartoon style).

---

## Part A: Custom Studio Upgrades (`packages/studio` & `packages/studio-server`)

### D1. Unified `+ Add Layer ▾` Menu, Group Layer Creation (`Cmd+G`), & Turning Point Stories Presets

Currently, `TimelineToolbar.tsx` has basic `+ Text` and `+ Image` buttons, and `Unbundle` breaks containers apart. We need a complete layer creation & grouping system:

1. **Unified `+ Add Layer ▾` Dropdown Menu in `TimelineToolbar.tsx` (and Right-Click `CanvasContextMenu.tsx`):**
   - **Text Layer (`+ Text`):** Free `position: absolute` editable text layer at playhead.
   - **Image / Cutout / Map Layer (`+ Image from Project` & `Upload from Mac...`):**
     - Pick any existing image/SVG from `Sources/assets/` OR upload a new `.png`/`.svg`/`.jpg` from Finder (which saves to `Sources/assets/` and inserts at playhead).
   - **Empty Group Layer (`+ Group Container`):**
     - Inserts `<div id="group-<uid>" data-hf-id="hf-<uid>" data-hf-group="Group" data-start="<playhead>" data-duration="5" style="position:absolute; left:240px; top:180px; width:600px; height:400px; z-index:40;"></div>` so the user can drag or nest items inside a group.
   - **Turning Point Stories Documentary Presets (`+ Channel Preset ▸`):**
     - **Editorial Callout Card:** Navy `#142838` background (`rgba(20,40,56,0.94)`), Ochre `#C49A44` 6px left border, Ivory `#F5F0E6` kicker + bold white headline (`position: absolute`, editable text).
     - **Map Label Badge:** Compact pill/badge (`#142838` bg, Muted Teal `#357F83` or Ochre `#C49A44` accent border, bold uppercase label) for anchoring onto SVG maps.
     - **Historical Stat / Citation Card:** Large figure + date/source citation subtitle (`≥28px` body, safe-margin compliant).
     - **Subscribe CTA Block:** Mounts the channel's red/energetic subscribe component (`shared/components/subscribe-cta`).
2. **Group Selected Layers on Canvas & Timeline (`Group` Button + `Cmd+G`):**
   - When 1 or more elements are selected on the canvas (or timeline), clicking **Group (`Cmd+G`)** in `TimelineToolbar.tsx` or `CanvasContextMenu.tsx` (via a new `POST /api/projects/:id/file-mutations/group-elements/*` route in `studio-server`):
     - Computes the union bounding box (`left`, `top`, `width`, `height`) of the selected elements in `1920x1080` coordinates.
     - Creates a parent `<div id="group-<uid>" data-hf-id="hf-<uid>" data-hf-group="Group" style="position:absolute; left:<box.left>px; top:<box.top>px; width:<box.width>px; height:<box.height>px; z-index:<maxZ>;">` at their earliest `data-start` and spanning their max end time.
     - Moves the selected elements inside the group wrapper with their `left`/`top` converted to group-relative coordinates (`childLeft - box.left`, `childTop - box.top`), so dragging the group moves all its children together as one unit, and clicking **Unbundle** later can unbundle them back!

### D2. Prominent Episode Identity, Scene Path & Audio Lock Banner (`StudioHeader.tsx`)

- In `StudioHeader.tsx`, display a clear status pill showing:
  - **Episode ID:** e.g. `EP04_Suez_Hormuz_Waterways`
  - **Active Composition File:** e.g. `compositions/s01.html` (or `index.html`)
  - **Duration & Frame Count:** e.g. `250.20s (7,506f @ 30fps)`
  - **Authoritative Path Tooltip / Warning:** Fetch project metadata from `/api/projects` and show a green `AUTHORITATIVE` badge when inside `/Users/yonassayfu/Projects/ProductionStudio/channels/.../Sources` (or an amber warning if inside `/tmp` or a disposable folder).

### D3. Safe-Margin (`90px × 70px`) & Cutout Halo Backdrop Toggle (`TimelineToolbar.tsx` / `PreviewOverlays.tsx`)

- Add a **Safe Zone (`90×70`)** toggle button in `TimelineToolbar.tsx` that draws a dashed `90px` horizontal / `70px` vertical safe-margin guide overlay (`left: 90px; right: 90px; top: 70px; bottom: 70px`) over the 1920×1080 preview canvas so cropped map labels or edge-bleeding text are immediately visible.
- Add a **Backdrop Check** cycle button (`Default` → `Light Ivory #F5F0E6` → `Dark Navy #142838` → `Checkerboard`) to inspect transparent PNG character/prop cutouts for white halos or fake transparency right on the canvas.

### D4. Pinned Revision Notes Synced to `QC/<EP_ID>_Revision_Notes.md`

- Add a **`+ Pin Note`** button in `TimelineToolbar.tsx` (and right-click menu) + backend endpoint `GET/POST /api/projects/:id/revision-notes`:
  - Captures: current timestamp (`seconds` + exact `30fps frame`), active scene (`s01`..`s09`), selected element ID (`#s01-q-card` or `hf-p8kc`), and the owner's revision comment text.
  - Appends/updates a structured Markdown table row in `../QC/<EP_ID>_Revision_Notes.md` (relative to `Sources/`) with status `OPEN` / `RESOLVED` so owner review notes made while watching the moving preview are saved directly in the episode's authoritative `QC/` folder for batch fixing!

---

## Part B: Non-Destructive Workflow Utilities in `/Users/yonassayfu/Projects/ProductionStudio/shared/tools/`

Create 4 clean, standalone Python 3 CLI scripts in `/Users/yonassayfu/Projects/ProductionStudio/shared/tools/` (read/write only when explicitly invoked, zero external pip dependencies required beyond standard library + local `ffprobe`):

1. **`episode-init.py`**:
   - Usage: `python3 shared/tools/episode-init.py <Channel_Name> <EP_ID>`
   - Scaffolds a new episode from `shared/templates/Video_Project_Template` (or validates an existing episode), ensures `Sources/index.html`, `Sources/hyperframes.json`, and `Sources/.agents/skills.json` exist and are valid, links the episode into Custom Studio's `data/projects/`, and prints the exact Studio URL (`http://127.0.0.1:5190/?project=<EP_ID>`).
2. **`episode-status.py`**:
   - Usage: `python3 shared/tools/episode-status.py <EP_ID_or_Path> [--write-handoff]`
   - Inspects `Brief/`, `Audio/`, `Images/`, `Timing/Timing_Map.json`, `Sources/index.html`, and `QC/` and outputs a unified cross-agent status report (exact audio duration in seconds + 30fps frames via `ffprobe`, timing status `ESTIMATED` vs `MEASURED`, scene count, asset manifest completion count, and open revision notes).
3. **`asset-intake.py`**:
   - Usage: `python3 shared/tools/asset-intake.py <EP_ID_or_Path> [--zip <path.zip>] [--sync-to-sources]`
   - Bounded check of `Images/` against `Brief/<EP_ID>_Asset_Manifest.json`: verifies file existence, PNG dimensions, true alpha channel (for cutouts/props) vs opaque backgrounds, flags white edge halos on transparent PNGs, and optionally copies verified assets into `Sources/assets/`. Never searches outside the episode folder or specified zip.
4. **`quick-qc.py`**:
   - Usage: `python3 shared/tools/quick-qc.py <EP_ID_or_Path> [--scene s01]`
   - Runs fast, proportionate validation (safe-margin check, broken asset link check, duration/seam alignment check, and elapsed time breakdown) in <5 seconds without triggering a full-episode render loop.

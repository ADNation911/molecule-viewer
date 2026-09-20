# Molecule3D

A browser workspace for exploring molecular structures. Part 1 adds a sample library, validated local imports, molecular representations, reversible display settings, camera controls, and a responsive inspector.

## Run locally

Requires Node.js 22.12 or later.

```sh
npm ci
npm run dev
```

Open http://127.0.0.1:5173. On Windows PowerShell, use `npm.cmd` if script execution policy blocks `npm.ps1`.

```sh
npm test
npm run build
npm run preview
```

Stop the dev server before starting preview: both use port 5173. Preview serves the production build from `dist/`. Use the build workflow; directly opening `index.html` no longer runs the module-based app.

## What works

- Local PDB, mmCIF (`.cif` / `.mmcif`), SDF, MOL, XYZ and PQR imports; first model/record only.
- Bundled GAL4–DNA, human myoglobin and illustrative ethanol samples.
- Cartoon, genuine ribbon, sticks, ball-and-stick, spheres and van der Waals surfaces.
- Chain/element/residue-spectrum coloring, water/residue-type visibility and up to 20 residue labels.
- Undo/redo for display settings. A new file resets history; camera movements are independent.
- Drag rotation, right-drag pan, scroll/button zoom, fit, opt-in auto-rotation, keyboard shortcuts.
- Resizable/collapsible inspector, light/dark theme, helpful empty/error states and session activity log.

Files are read locally; the app does not send structure contents to a server or call a model provider. The assistant is visibly unavailable until the later RAG release. The chosen direction is a free, open-source model, with hardware and hosting requirements to be determined later.

## Limits

One structure at a time, up to 10 MB and 75,000 atoms. Surface generation is limited to 15,000 atoms. Only the first model/SDF record is displayed. Cartoon and ribbon are unavailable without a supported backbone. Missing residue/chain annotations are shown as zero rather than invented. Chemistry, measurements, saving sessions and AI answers are future parts, not current capabilities.

3Dmol.js is pinned to 2.5.5 and Vite to 8.3.0, with a committed lockfile. The production build currently reports upstream 3Dmol warnings for its embedded-viewer callback `eval` and its 574 kB renderer bundle; the application does not use that callback path or evaluate user code. Browser UI checks must accompany build/test success.

## Layout

- `src/main.js`: application UI, events and import workflow.
- `src/viewer.js`: 3Dmol adapter and molecular rendering.
- `src/structures.js`: import validation, metadata and visibility selection.
- `src/history.js`: bounded, immutable display history.
- `src/samples.js`, `public/samples/`: bundled sample catalog/data.
- `tests/`: import and history regression checks.

## Deployment

The `dist/` folder is the deployable static site. Relative asset URLs support a GitHub Pages repository subpath. The existing repository's publishing configuration must be inspected before the first push; do not publish raw Vite source as a working site. GitHub updates occur after the user's Part 1 frontend review.

See [ROADMAP.md](ROADMAP.md), [PROGRESS.md](PROGRESS.md), [the RAG guide](docs/RAG_DESIGN.md), and [sample provenance](public/samples/README.md).

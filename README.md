# Molecule3D

A browser workspace for exploring molecular structures. It supports multiple independently styled objects, trajectories, density maps, saved camera scenes, geometric analysis, reusable workspace files, RCSB PDB fetching, and a source-grounded biotech assistant.

## Run locally

Requires Node.js 22.12 or later.

```sh
npm ci
npm run dev
```

Open http://127.0.0.1:5173. On Windows PowerShell, use `npm.cmd` if script execution policy blocks `npm.ps1`.

```sh
python -m pip install -r backend/requirements.txt
npm run check
npm run preview
```

The Python dependencies are only needed for the backend checks and assistant. `npm run check` runs the frontend unit tests, backend unit and API-contract tests, and the production build. Stop the dev server before starting preview: both use port 5173. Preview serves the production build from `dist/`. Use the build workflow; directly opening `index.html` no longer runs the module-based app.

## What works

- Add several local PDB, mmCIF (`.cif` / `.mmcif`), SDF, MOL, XYZ and PQR objects. Multi-model files become playable trajectories.
- Fetch a structure by four-character RCSB PDB ID.
- Bundled GAL4–DNA, human myoglobin and illustrative ethanol samples.
- Object-scoped cartoon, genuine ribbon, sticks, ball-and-stick, spheres and van der Waals surfaces.
- Independent object color, opacity, visibility, water, ligand, residue-type and label controls.
- Chain sequences; chain, residue, ligand and atom selections; ligand isolation; 4 Å ligand neighborhoods; reusable named selections.
- Persistent distance, angle and dihedral measurements across atoms and objects, with calculated values and 3D annotations.
- Sequence-matched Cα/P backbone alignment between objects, iterative 2 Å outlier rejection, RMSD reporting and original-coordinate restore.
- Trajectory scrubbing and 2/4/8 fps playback for multi-model PDB, SDF and XYZ files.
- Signed Gaussian Cube and OpenDX density overlays with contour, opacity, color and mesh controls.
- Named camera scenes with animated tours, plus a strict molecular-workspace command palette.
- Local workspace save/restore, lossless PNG figures and browser-generated APNG trajectory or turntable animations.
- Undo/redo for the active object's display settings. Camera movements are independent.
- Drag rotation, right-drag pan, scroll/button zoom, fit, opt-in auto-rotation, keyboard shortcuts.
- Resizable/collapsible inspector, light/dark theme, helpful empty/error states and session activity log.
- Molecular-science assistant restricted to biotechnology and chemistry, with Europe PMC retrieval, local or hosted open-weight inference, active-structure metadata, validated viewer highlights, inline citations, source cards and downloadable reports.

Files are read locally and structure contents and coordinates are not sent to the assistant. When enabled, the assistant receives bounded metadata for the active object, its frame, and selection so deictic questions and validated highlights can refer to the viewer. Assistant questions go to the Python backend and literature searches go to Europe PMC. Local development uses Qwen3 and Nomic embeddings through Ollama with no API key. Public deployment can use Llama 3.1 and BGE through Cloudflare Workers AI, with its token kept only on the server. Follow [the RAG setup](docs/RAG_SETUP.md) for local use or [the Render deployment guide](docs/DEPLOY_RENDER.md) for a public site.

## Limits

Each structure file may be up to 10 MB and 75,000 atoms; the combined workspace limit is 120,000 atoms. Trajectories are limited to 500 frames and require a consistent atom count. Text Cube/OpenDX maps may be up to 20 MB and 2,000,000 voxels. Workspace files may be up to 80 MB. Animation exports sample at most 40 trajectory frames. Surface generation is limited to 15,000 atoms per object. Cartoon and ribbon are unavailable without a supported backbone. Missing residue/chain annotations are shown as zero rather than invented. Neighbor lists are geometric proximity results, not claims about chemical bonds. Alignment uses identical residues from a global sequence alignment and one Cα or phosphate anchor per residue; its RMSD is a geometric comparison, not a claim of biological equivalence. The assistant depends on the retrieved literature and may abstain when evidence is missing. It does not provide diagnoses or personalized treatment.

3Dmol.js is pinned to 2.5.5 and Vite to 8.3.0, with a committed lockfile. The production build currently reports upstream 3Dmol warnings for its embedded-viewer callback `eval` and its 574 kB renderer bundle; the application does not use that callback path or evaluate user code. Browser UI checks must accompany build/test success.

## Layout

- `src/main.js`: application UI, events and import workflow.
- `src/viewer.js`: 3Dmol adapter and molecular rendering.
- `src/structures.js`: import validation, metadata and visibility selection.
- `src/pdb.js`: PDB ID validation and RCSB fetch behavior.
- `src/analysis.js`: measurement geometry, sequence correspondence and rigid-body superposition.
- `src/advanced.js`: density/trajectory limits and the allowlisted command parser.
- `src/advanced-ui.js`: density-map and camera-scene controls.
- `src/session.js`: versioned workspace serialization and validation.
- `src/assistant.js`: assistant connection, chat state and cited source rendering.
- `src/assistant-context.js`: bounded viewer context, stable action targets and cited report generation.
- `src/workspace-utils.js`: shared workspace identifiers, filenames and browser downloads.
- `src/history.js`: bounded, immutable display history.
- `backend/`: scoped retrieval, Europe PMC evidence search, local embeddings and cited answer API.
- `src/samples.js`, `public/samples/`: bundled sample catalog/data.
- `tests/`: import and history regression checks.

## Deployment

The `dist/` folder is the deployable static site. Relative asset URLs support the GitHub Pages repository subpath. The Pages workflow runs tests and a production build before deploying. `Dockerfile` and `render.yaml` package the frontend and API as one Render web service.

See [the local RAG setup](docs/RAG_SETUP.md), [public deployment instructions](docs/DEPLOY_RENDER.md), and [sample provenance](public/samples/README.md).

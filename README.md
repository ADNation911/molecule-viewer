# Molecule3D

A browser workspace for exploring molecular structures. The current local development release supports multiple independently styled objects, sequence and ligand exploration, geometric measurements, backbone alignment, validated local imports, RCSB PDB fetching, and a source-grounded local biotech assistant.

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

- Add several local PDB, mmCIF (`.cif` / `.mmcif`), SDF, MOL, XYZ and PQR objects; first model/record from each file.
- Fetch a structure by four-character RCSB PDB ID.
- Bundled GAL4–DNA, human myoglobin and illustrative ethanol samples.
- Object-scoped cartoon, genuine ribbon, sticks, ball-and-stick, spheres and van der Waals surfaces.
- Independent object color, opacity, visibility, water, ligand, residue-type and label controls.
- Chain sequences; chain, residue, ligand and atom selections; ligand isolation; 4 Å ligand neighborhoods; reusable named selections.
- Persistent distance, angle and dihedral measurements across atoms and objects, with calculated values and 3D annotations.
- Sequence-matched Cα/P backbone alignment between objects, iterative 2 Å outlier rejection, RMSD reporting and original-coordinate restore.
- Undo/redo for the active object's display settings. Camera movements are independent.
- Drag rotation, right-drag pan, scroll/button zoom, fit, opt-in auto-rotation, keyboard shortcuts.
- Resizable/collapsible inspector, light/dark theme, helpful empty/error states and session activity log.
- Local Qwen3 assistant restricted to molecular science and biotechnology, with Europe PMC retrieval, Nomic embeddings, inline citations, and inspectable source cards.

Files are read locally and structure contents are not sent to the assistant. When enabled, assistant questions are sent to the local Python backend, literature searches go to Europe PMC, and generation and embedding run through the local Ollama service. No model-provider API key or paid subscription is required. Follow [the local RAG setup](docs/RAG_SETUP.md) to enable it.

## Limits

Each file may be up to 10 MB and 75,000 atoms; the combined workspace limit is 120,000 atoms. Surface generation is limited to 15,000 atoms per object. Only the first model/SDF record from each file is displayed. Cartoon and ribbon are unavailable without a supported backbone. Missing residue/chain annotations are shown as zero rather than invented. Neighbor lists are geometric proximity results, not claims about chemical bonds. Alignment uses identical residues from a global sequence alignment and one Cα or phosphate anchor per residue; its RMSD is a geometric comparison, not a claim of biological equivalence. The assistant depends on the retrieved literature and may abstain when evidence is missing. It does not provide diagnoses or personalized treatment. Saving sessions and passing the active 3D selection into the assistant are future capabilities.

3Dmol.js is pinned to 2.5.5 and Vite to 8.3.0, with a committed lockfile. The production build currently reports upstream 3Dmol warnings for its embedded-viewer callback `eval` and its 574 kB renderer bundle; the application does not use that callback path or evaluate user code. Browser UI checks must accompany build/test success.

## Layout

- `src/main.js`: application UI, events and import workflow.
- `src/viewer.js`: 3Dmol adapter and molecular rendering.
- `src/structures.js`: import validation, metadata and visibility selection.
- `src/pdb.js`: PDB ID validation and RCSB fetch behavior.
- `src/analysis.js`: measurement geometry, sequence correspondence and rigid-body superposition.
- `src/assistant.js`: assistant connection, chat state and cited source rendering.
- `src/history.js`: bounded, immutable display history.
- `backend/`: scoped retrieval, Europe PMC evidence search, local embeddings and cited answer API.
- `src/samples.js`, `public/samples/`: bundled sample catalog/data.
- `tests/`: import and history regression checks.

## Deployment

The `dist/` folder is the deployable static site. Relative asset URLs support the GitHub Pages repository subpath. The Pages workflow runs tests and a production build before deploying.

See [the RAG guide](docs/RAG_DESIGN.md) and [sample provenance](public/samples/README.md).

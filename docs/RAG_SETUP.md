# Run the local biotech assistant

Molecule3D's local assistant uses two models through Ollama:

- `qwen3:4b` generates answers. It is an Apache-2.0 model and the Ollama download is about 2.5 GB.
- `nomic-embed-text` ranks biomedical evidence locally. Its Ollama download is about 274 MB.

The backend searches Europe PMC for relevant publications, embeds their titles and abstracts, selects the strongest evidence, and asks Qwen3 to answer only from that evidence. Every successful answer must cite at least one retrieved source. Clear off-topic prompts are rejected before retrieval; ambiguous prompts receive a second local scope check.

## One-time setup

Install [Ollama](https://ollama.com/download), then run these commands from the repository root:

```powershell
ollama pull qwen3:4b
ollama pull nomic-embed-text
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
```

The models have no per-request fee. They use your computer's RAM/CPU/GPU, and Europe PMC retrieval requires an internet connection.

## Start the app

Open two PowerShell terminals in the repository root.

Terminal 1 — local RAG API:

```powershell
.\.venv\Scripts\python.exe -m uvicorn backend.app:app --host 127.0.0.1 --port 8000
```

Terminal 2 — web app:

```powershell
npm.cmd run dev
```

Open `http://127.0.0.1:5173`, choose **Assistant**, and wait for the status to read `qwen3:4b · local and ready`.

Try an in-scope question:

> How does the guide repeat clasp motif influence Cas9 fidelity?

Then verify the boundary:

> Who won the cricket match?

The first response should contain inline `[S#]` citations and source cards. The second should be declined without searching literature or invoking answer generation.

## Configuration

The local defaults can be changed with environment variables before starting Uvicorn:

```powershell
$env:MOLECULE3D_CHAT_MODEL = "qwen3:4b"
$env:MOLECULE3D_EMBED_MODEL = "nomic-embed-text"
$env:OLLAMA_HOST = "http://127.0.0.1:11434"
```

The frontend stores only the selected backend URL in browser storage. Conversation context is held in backend memory and disappears when the server stops. Questions are limited to 1,200 characters and the default rate limit is 10 requests per minute per client.

## Public deployment

GitHub Pages cannot run the Python API or an Ollama process. The included Render deployment runs the built frontend and FastAPI together, and calls open-weight models through Cloudflare Workers AI. Follow [Deploy Molecule3D publicly](DEPLOY_RENDER.md).

Do not commit API keys. The local Ollama stack does not require one, and the public Cloudflare token belongs only in Render's secret environment.

## Verification

```powershell
npm.cmd test
npm.cmd run test:rag
npm.cmd run build
```

The RAG unit tests do not call Ollama or Europe PMC. Use the two sample prompts above for the end-to-end check.

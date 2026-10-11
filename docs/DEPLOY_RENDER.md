# Deploy Molecule3D publicly

The public deployment uses one Render web service for the viewer and FastAPI backend. The backend retrieves papers from Europe PMC and sends only the question plus retrieved text to Cloudflare Workers AI. Llama 3.1 generates the cited response and BGE ranks the evidence. Molecular structure files remain in the visitor's browser.

## Why the model is hosted separately

Render's free web service has 512 MB of RAM, which is not enough for the local 4B Qwen model. The included deployment therefore keeps Render lightweight and uses Cloudflare's hosted open-weight models. Local development continues to use Ollama and needs no cloud credentials.

Cloudflare Workers AI currently includes a daily free allocation. Render free services sleep after a period without traffic and can take about a minute to wake. These limits make this setup suitable for a portfolio or demonstration site; check each provider's current limits before relying on it for production traffic.

## 1. Create the Cloudflare Workers AI credentials

1. Create or sign in to a [Cloudflare account](https://dash.cloudflare.com/).
2. Open **Workers AI**, choose **Use REST API**, and create a Workers AI API token.
3. Copy the **Account ID** and API token. A manually configured token needs **Workers AI Read** and **Workers AI Edit** permissions.
4. Keep both values private. Do not put them in a Vite variable, browser code, GitHub Actions variable, or committed `.env` file.

Cloudflare's official [REST API guide](https://developers.cloudflare.com/workers-ai/get-started/rest-api/) shows the same token and Account ID flow.

## 2. Deploy the repository on Render

After the reviewed changes are pushed to GitHub:

1. Sign in to [Render](https://dashboard.render.com/) with GitHub.
2. Choose **New → Blueprint** and connect `ADNation911/molecule-viewer`.
3. Render detects the repository's `render.yaml` and creates the `molecule3d` free web service from the `Dockerfile`.
4. When prompted for secret environment variables, enter:
   - `CLOUDFLARE_ACCOUNT_ID`: the Account ID from Cloudflare.
   - `CLOUDFLARE_API_TOKEN`: the Workers AI token.
5. Apply the Blueprint and wait for the Docker build and health check to complete.
6. Open the assigned `https://...onrender.com` URL. The viewer and assistant share this address, so no frontend API URL is needed.
7. Open **Assistant**. Its status should show `@cf/meta/llama-3.1-8b-instruct · Cloudflare Workers AI`.

Confirm these two prompts:

> How does myoglobin bind oxygen?

> Who won the cricket match?

The molecular question should return a cited answer and source cards. The sports question should be declined.

## 3. Optional: keep the GitHub Pages address

The Render URL can replace GitHub Pages completely. To keep `https://adnation911.github.io/molecule-viewer/` as a second frontend:

1. Copy the Render service URL without a trailing slash.
2. In the GitHub repository, open **Settings → Secrets and variables → Actions → Variables**.
3. Create a repository variable named `RAG_API_URL` with the Render URL as its value.
4. Run the **Deploy to GitHub Pages** workflow again.

The URL is public configuration, so it belongs in a repository variable. The Cloudflare token must remain only in Render. The backend already permits the `https://adnation911.github.io` origin.

## Operations and limits

- `/api/health` reports the inference provider, selected models, and whether required server configuration exists. It does not spend an inference request.
- The API accepts questions up to 1,200 characters and defaults to 10 requests per minute per client.
- Render's filesystem and the app's conversation/source cache are temporary. No user chat history is persisted.
- Free quotas can stop responses until they reset. Do not add billing without also adding authentication and a durable distributed rate limiter.
- Change allowed browser origins with `MOLECULE3D_ALLOWED_ORIGINS`, using a comma-separated list of full origins.

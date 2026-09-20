# Biotech and molecule assistant: implementation walkthrough

Status: design for Parts 4 and 6; not implemented.

## What we are building

RAG means retrieving relevant evidence and giving it to a language model before it answers. The initial project needs a retrieval pipeline, not training a new foundation model. Aim for broad biotechnology and molecular coverage with explicit limits: no system can truthfully guarantee a correct answer to every question.

The current code supplies a truncated structure file to Gemini. Replace that with evidence retrieval and parsed structure facts. Scientific measurements come from calculation tools, not from language-model guesses.

## Proposed flow

```text
Question + conversation reference + selected structure/atom IDs
                           |
                  Server-side topic routing
                /            |              \
      Outside scope     Needs clarification    In scope
       brief decline       ask a question          |
                                           Retrieve evidence
                                           + compute facts
                                                  |
                                    Check evidence sufficiency
                                       /                  \
                                  insufficient          sufficient
                                    abstain        generate cited answer
                                                         |
                                         Validate citations and actions
                                                         |
                                      Answer + sources + viewer actions
```

## Step 1: Define domain behavior and test questions

Allow biotechnology, molecular biology, biochemistry, molecular structures, relevant chemistry, and use of this molecular app. Decline unrelated requests. Route ambiguous questions to clarification, and handle mixed-topic questions explicitly. Keep the scope decision on the backend; a sentence in a browser prompt is not sufficient enforcement.

Create a fixed initial evaluation set before tuning: approximately 60 questions spanning supported facts, multi-turn follow-ups, unrelated questions, missing evidence, misleading premises, and instruction-injection attempts. Include legitimate interdisciplinary questions so the filter does not reject useful biotech work. Expand with a held-out set in Part 6.

## Step 2: Build a small, traceable knowledge library

Start with roughly 25-50 deliberately chosen sources covering core concepts and a few example molecules. Expand coverage after retrieval is working. For each source store title, URL, accession/DOI where available, version/date, section, permitted-use information and import timestamp.

Use [RCSB PDB metadata](https://data.rcsb.org/) for structure identity and provenance. Plan adapters for UniProt protein records and PubChem compound records after verifying their current API contracts. Add licensed learning material and selected papers; the [PMC Open Access Subset](https://pmc.ncbi.nlm.nih.gov/tools/openftlist/) contains reusable material under varying terms, which must be checked per source. A paper being readable online does not automatically make it reusable.

Keep private user uploads separate from the shared library. A new upload must not silently become evidence visible to every user.

## Step 3: Clean, split and index documents

Extract readable sections, preserve captions/table context and remove duplicate boilerplate. Assign stable document and chunk IDs. As an initial tunable setting, try chunks of about 500-800 tokens with modest overlap; evaluate retrieval before changing the size.

Maintain an ingestion manifest with source hashes. Re-import changed sources, skip identical content and support removal. Preserve exact identifiers and aliases: gene symbols, residue names and accession numbers can need exact matching as well as semantic similarity.

## Step 4: Add an open-source model and retrieval API

The selected direction is a free, open-source stack. Build a small Python backend with a local or self-hosted answer model, open-source embeddings, and a self-managed index. Start with one deployment path so the first RAG release remains testable and maintainable.

The initial candidates to benchmark in Part 4 are a compact instruction model served through Ollama or llama.cpp, a sentence-transformers embedding model suited to scientific text, and FAISS or Qdrant for hybrid retrieval. Select exact models only after measuring answer quality, memory use, latency, license terms, and the hardware available for hosting. “Free model” removes per-request model fees but does not remove compute or hosting requirements.

Suggested backend contracts:

- `POST /api/chat`: question, conversation ID, structure ID and selection IDs; returns answer, disposition, source IDs and optional validated actions.
- `POST /api/structures`: validate an explicitly submitted structure and return an immutable ID plus parsed metadata.
- `POST /api/knowledge/ingest`: owner-only ingestion, never an unrestricted public upload endpoint.
- `GET /api/sources/{id}`: citation metadata and the permitted evidence excerpt.
- `GET /api/health`: service readiness without secret values.

Keep keys in server environment variables. A variable compiled into browser JavaScript is public even if it originally came from an `.env` file. Configure upload/body limits, request timeouts, rate limits and an application-enforced spending allowance before exposing model access publicly.

## Step 5: Retrieve evidence and calculate structure facts

Retrieve a bounded set of relevant passages using meaning, exact identifiers and metadata filters. Tune ranking and evidence thresholds on the evaluation set; search scores are not probabilities that an answer is true.

Parse structure identity, chains, residues, ligands and available metadata. For a request such as “which residues lie within 4 angstroms of this ligand,” calculate coordinates against stable atom IDs and return the method, units, structure version and frame. Do not embed raw coordinate text and expect text search to perform geometry.

Maintain a strict association between a conversation and its current structure/selection. When the user changes molecules, invalidate stale context or clearly switch the conversation context.

## Step 6: Generate and validate grounded answers

Give the model the approved topic, relevant conversation context, selected evidence and verified tool results. Require citations for factual claims; separate literature statements from computed observations. Retrieved documents are evidence, never instructions overriding application rules.

Validate that citation IDs exist in the retrieved evidence and that action targets exist in the active structure. Check support for claims, not merely the presence of a citation. If evidence is insufficient, answer that the available library cannot establish the claim. Do not hide that limitation with an uncited general-model answer.

Use an explicit output schema such as `answer`, `disposition`, `citations`, `structure_facts`, and `actions`. Keep arbitrary code, shell commands and raw model-authored viewer scripts out of the action interface.

## Step 7: Connect it to the frontend

Part 4 delivers question entry, conversation history, readable answers, clickable source cards, evidence excerpts and clear loading/failure states. Part 6 adds structure-aware questions and a small allowlist of actions such as highlighting a residue selection or zooming to a ligand.

Example review sequence: load a sample protein; ask a source-backed question about its function; open the cited passage; ask about a selected ligand; highlight a valid cited selection; request an unrelated sports result and see a brief scope decline; ask an unsupported question and see an evidence limitation.

## Step 8: Evaluate and deploy

Measure retrieval recall on labelled examples, claim support, citation validity, off-topic handling, mistaken refusals, stale-structure errors, latency and cost per question. Proposed release targets: all citations resolve; all deterministic geometry fixtures pass; at least 95% correct scope routing and at least 90% supported factual answers on the held-out evaluation set. Report the sample size and actual results; these targets are not guarantees outside the set.

Run unit/evaluation checks alongside browser workflows. Exercise unavailable models, empty retrieval, malformed files and network failures. Keep the viewer usable when AI is unavailable.

Host the API on a machine or service that can run the selected model and persistent index; connect its URL to the static frontend. GitHub Pages cannot run the Python API or model. Local development can use Ollama or llama.cpp, while a public release will need an always-on host with enough RAM or GPU memory for the chosen model.

## Decisions before Part 4

Choose the exact open-source answer model, embedding model, index, public-library scope and API hosting after the Part 4 benchmark. These are deferred engineering choices. We will walk through installing the runtime, ingesting sources, evaluating answers, and connecting the frontend during that phase.

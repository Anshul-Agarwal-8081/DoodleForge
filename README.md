# DoodleForge

DoodleForge turns sketches, typed instructions, and short voice clips into editable graph patches, then compiles those graphs into reviewed outputs. The app includes separate pages for backlog/storyboard, ERD, cloud, software, workflow, theme, circuit, voice, evaluation, and model setup.

## Run locally

Requirements: Node.js 22.12+ and pnpm 11.25+. The offline demo does not need a Gemini key.

1. Open the extracted project folder in Antigravity and run this once from its terminal:

   ```sh
   pnpm install
   ```

2. Start the API in Terminal 1:

   ```sh
   pnpm dev:api
   ```

3. Start the web app in Terminal 2:

   ```sh
   pnpm dev
   ```

4. Open the Vite URL printed in Terminal 2 (normally <http://127.0.0.1:5173>). Click **Simulate Gemini 4 sketch scan** in the left rail to load local presentation data without calling Gemini.

To use live Gemini features, copy `.env.example` to `.env` and set `GEMINI_API_KEY`, or enter a key on the app's **Model setup** page. Never commit `.env`. The API reads `API_PORT` (the example uses `4174`), and Vite proxies `/api` to that port.

### Open and run the ZIP in Antigravity

1. Extract `DoodleForge.zip` to a folder and open the extracted `DoodleForge` folder in Antigravity.
2. Open Antigravity's integrated terminal at the project root and run:

   ```sh
   pnpm install
   cp .env.example .env
   ```

3. If needed, open **Model setup** in the running app and save a Google AI Studio key. It is written to the local ignored `.env`; it is not part of the ZIP.
4. Start the API in the first terminal:

   ```sh
   pnpm dev:api
   ```

5. Open a second terminal at the same project root and start the web app:

   ```sh
   pnpm dev
   ```

6. Open the local address printed by Vite (normally `http://127.0.0.1:5173`). The Software page has an offline calculator demo even before a model key is configured.

## Model setup and credentials

The API uses the official `@google/genai` SDK and `ai.models.generateContent` with `gemini-3.8-flash`. Google lists this stable model with text, image, and audio inputs and structured output support in its [model documentation](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash). There is no OpenAI-compatible base URL setting or browser-side model call.

Open **Model setup** in the app and enter a Google AI Studio key, or set `GEMINI_API_KEY` in the ignored local `.env` before starting the API. The key is read by the server, never returned by settings, and is not in the source tree or deliverable archive. Rotate any key previously pasted into a chat if it is still active.

Every request uses a Zod-derived JSON schema when supported, then full Zod and graph-invariant validation. The patch pass uses a compact provider schema to avoid Google's constrained-decoding schema limits; the complete local Zod contract remains authoritative. The adapter omits unsupported sampling and thinking fields, maps thinking to the SDK's enum, accepts image/audio inline data, exposes native tool calls, and supports fixture replay, record mode, and response caching.

Temporary model overloads and gateway errors (`408`, `429`, `500`, `502`, `503`, `504`, and common network failures) receive up to two automatic retries with backoff. Exhausted `429` errors are labeled as Google rate limits; `503` errors are labeled as temporary provider overloads. Feature pages show a retry action and keep an offline demo available. A client cannot remove Google-side capacity or quota errors, so live service availability still depends on Google.

## Feature behavior

- **Canvas and backlog:** upload a sketch or type a request. Model responses become validated, undoable graph patches. Rule findings link graph ids to source regions; node/edge boxes remain on the graph, never on diagnostics.
- **ERD:** page-specific image/text intake builds entities and relationships. A deterministic PostgreSQL emitter writes the DDL, and the workbench executes it in PGlite and shows tables, columns, and rows before displaying a verified result.
- **Software:** page-specific wireframe/text intake supports screen and UI component nodes. A deterministic template compiler produces runnable React source files and a sandboxed interactive preview; calculator controls use safe arithmetic without `eval`. OpenAPI and API mocks are also available.
- **Voice:** push-to-talk captures up to 30 seconds, converts the browser recording to compact mono WAV, and sends it to the native Gemini adapter. The transcript is shown and sent through the text-to-graph patch pipeline. Raw audio is not persisted. A local no-microphone demo is available in fixture mode.
- **Cloud:** fixed templates emit AWS Terraform for review. Terraform verification runs `fmt` and `validate` when the CLI is installed. The app has no apply operation.
- **Other workbenches:** storyboard, workflow, theme, circuit, and evaluation each have their own inputs and feature-specific outputs; fixture paths remain available without model access.
- **Actions:** GitHub and Jira proposals show an approval card before execution. Allowlist, idempotency, sanitization, dry-run, and action caps are enforced server-side.

## Architecture

- `packages/ir`: Zod IR/patch/domain schemas, graph invariants, atomic patch application and undo.
- `packages/gemma`: official Google SDK adapter plus fixture/record/cache support and structured validation.
- `packages/vision`: image cleanup, OpenCV marker analysis, normalized boxes, and fallback handling.
- `packages/packs/erd`: ERD validation, deterministic DDL, rules, and PGlite verification.
- `packages/packs/software`: OpenAPI compiler, mocks, strict UI contract, runnable React source, and sandbox preview HTML.
- `packages/packs/cloud`: cloud rules, deterministic Terraform templates, and CLI verification.
- `apps/api`: Fastify JSON/SSE endpoints for image, text, voice, model settings, verification, and approval-gated actions.
- `apps/web`: feature-specific pages, React Flow canvas, page-local input and output components, and server event handling.

## Commands

```sh
pnpm test                 # unit and API tests
pnpm lint                 # TypeScript check
pnpm build                # production web build
pnpm test:e2e             # Playwright path; requires the browser binary
pnpm mini-eval            # recorded fixture graph comparison
pnpm schemas:export       # export contract JSON Schemas
pnpm spike                # offline model adapter replay
```

## Verification status

| Area | Status |
|---|---|
| Native SDK/model id, strict JSON request mapping, image/audio encoding and tool declarations | Type-checked and adapter-tested; a live SDK connection check succeeded. One structured generation later hit Google's 504 deadline |
| ERD DDL and PGlite execution | Implemented; test and browser verification status is recorded in `docs/DECISIONS.md` |
| Software calculator preview | Deterministic generator, offline graph input, and isolated iframe implemented; generated-script checks passed. Live model generation timed out once |
| Voice capture and live transcription | Browser/API path implemented; device permissions, live audio quality, and latency remain environment-dependent |
| Terraform `fmt` and `validate` | Runs only when Terraform CLI is installed; no infrastructure is applied |
| Real GitHub/Jira action | Approval-gated; real credentials and external writes require a deliberate user approval |
| Full image/model quality and 1.5-second voice target | Unverified until measured on representative inputs and the configured service |

For current commands and measured results, see [docs/DECISIONS.md](docs/DECISIONS.md).

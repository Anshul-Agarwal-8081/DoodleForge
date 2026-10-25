# DoodleForge decisions

## Phase 0 decisions

| Decision | Choice | Verification |
|---|---|---|
| Package manager and language | pnpm workspace, TypeScript ESM, Node.js 22.12 or newer | Verified locally with Node 24.22.1 and pnpm 11.25.0 |
| License | MIT | Implemented in `LICENSE` |
| Schema library | Zod 4; export IR, patch, and domain-pack schemas to JSON Schema | Verified by `pnpm schemas:export` |
| Graph geometry | Integer `[ymin, xmin, ymax, xmax]` boxes, each coordinate 0–1000; geometry belongs on nodes and edges | Verified by schema tests |
| Patch staleness | Rebase only additive operations with unique ids; reject stale updates/removals and any conflicting operation | Verified by patch-engine tests |
| Undo | Append a compensating patch and advance graph version; preserve all prior graph content exactly | Verified by undo and append-only journal tests |
| First sketch import | `replace_all` is allowed only as the single operation on an empty version-0 graph | Implemented; tests pending |
| Model adapter | OpenAI-compatible streaming chat endpoint plus an offline fixture backend, behind one adapter | Fixture replay, record/replay, cache, repair, and mocked streaming endpoint tests pass. No live model endpoint is configured. |
| Model sampling defaults | temperature 1.0, top_p 0.95, top_k 64 | Adapter defaults and spike runner use these values |
| Gemma model selection | Live mode defaults to Google's OpenAI-compatible endpoint and `gemma-4-26b-a4b-it`; `GEMMA_BASE_URL` and model env variables can override these defaults. `gemma-4-31b-it` is available as the large model | Adapter config test confirms default URL/model. Hosted authentication and generation remain **unverified** until a replacement key is configured server-side |
| Endpoint diagnostics | Model settings page calls a server status route and server-side test route; only sanitized URL, model ID, and key-present status reach the browser | Tests confirm missing-key guidance, mocked test success, and no API-key disclosure. The currently configured local key remains blank |
| Feature navigation | Canvas, backlog, ERD, cloud, software, storyboard, workflow, theme, circuit, voice, evaluation, and model setup are direct SPA routes | Vite fallback and production build verified. App state stays in the SPA while routes change |

## Phase 1 decisions and gate

| Decision | Choice | Verification |
|---|---|---|
| Layout | ELK layered, left-to-right; user drag positions override computed positions by node id | Unit test and connected-browser rendering passed |
| Rule trust | All deterministic pack and core rule findings use `verified`; model observations remain a separate `advisory` trust level | Rule fixtures and source/canvas UI verified |
| Sample group identity | Group ids are globally unique from node ids, even when the group represents an epic | Corrected `fixtures/board1.ir.json`; patch interaction passed |
| No-model Phase 1 UI | The fixture app has no model/API call path and labels itself `Fixture mode · zero model calls` | Source inspection and connected-browser interaction; no adapter is imported by the web app |

Gate 1 behavior was manually verified in the connected browser against a fresh Vite server: all three graph nodes and the edge rendered; the missing-acceptance-criteria finding was shown as verified; adding criteria removed it; undo restored it; redo removed it again. Vitest reported 5 files and 29 tests passed, `pnpm lint` passed, and `pnpm build` passed. `pnpm test:e2e` was attempted twice but Chromium could not launch in this desktop sandbox (`bootstrap_check_in ... Permission denied (1100)`); the test is committed for execution in a normal Playwright environment. The build emits a large-bundle warning due to ELK/React Flow. 

## Phase 2 decisions and gate

| Decision | Choice | Verification |
|---|---|---|
| Image intake | JPEG, PNG, HEIC and HEIF up to 15 MB; strip JPEG APP1 and PNG eXIf metadata; keep a ~2048 px working copy | Unit tests cover byte limits, EXIF stripping, dimensions/box conversion, and the no-CV fallback |
| Geometry | OpenCV markers are integer 0–1000 `[ymin,xmin,ymax,xmax]` boxes from the corrected working image; conversion lives in `packages/vision` | Geometry tests pass; live-camera marker hit rate **unverified** |
| Image model input | Send the cleaned, corrected, numbered working image to Pass 0/A, with CV marker boxes supplied separately | Prompt contract and image ordering tests; live model interpretation **unverified** |
| API execution | Fastify SSE job route; validated Pass 0/A/B outputs; repair through the Gemma adapter; fixture replay and typed-story parsing work offline | API health/SSE and pipeline tests pass; connected-browser fixture and text flows were exercised |
| CV server fallback | Attempt OpenCV.js decode and analysis on the API host; if the installed build has no encoded-image decoder, report fallback and let Pass A make low-confidence box guesses | Fallback returns an explicit `imdecode is not a function` result with the installed OpenCV.js release. Native server decode is **unverified** |
| Ten-case mini-eval | Ten generated board fixtures with recorded Pass 0/A/B responses and graph-level node/edge F1 scorer | `pnpm mini-eval` reports 100% for both metrics because recorded expected and replay outputs match. This is a deterministic replay check, not CV or model accuracy |
| Hosted configuration | `.env.example` names `GEMMA_BASE_URL`, `GEMMA_API_KEY`, and model overrides; token remains blank and server-only | A live upload reached the API but stopped with `GEMMA_BASE_URL is required`; no credential or authenticated request was used |

The Phase 2 app/API fixture route and typed-story route work without a model. `pnpm test` reported 9 files and 41 tests passed; `pnpm lint` passed after the mini-eval imports were corrected; `pnpm build` passed with large OpenCV.js, HEIC, and ELK chunk warnings. Playwright remains unverified because Chromium cannot launch in this desktop sandbox. The uploaded-image UI reached the API but could not be interpreted live because server model configuration is absent. The ten-case report is an offline fixture reconstruction measure only.

## Phase 3 decisions and gate

| Decision | Choice | Verification |
|---|---|---|
| User-story pack | Strict story and Given/When/Then schemas, two validated few-shot graphs, editable note-color mapping, sticky-note/header/arrow classification, mark/quadrant priority mapping, `US-01` identifier allocation, near-duplicate candidate scoring, and dependency-first order | Pack unit tests pass. Only fixture output is exercised by the UI; CV cue quality remains **unverified** |
| Backlog output readiness | A story is verified only if its node props and exported record pass Zod and it has no user-story rule finding. Missing criteria and dependency-cycle findings keep the story visible as a draft | Tests cover complete and incomplete story records; connected browser shows one draft and one verified story |
| GitHub Pass E | Live mode requests one `create_github_issue` native tool call for one selected verified story. Fixture mode builds one deterministic tool call. The server validates story identity and repository against its allowlist before creating a pending preview | Fixture proposal path and API tests pass; hosted native tool calling is **unverified** |
| Approval safeguards | Dry-run defaults on; server-side repository allowlist; 25-item batch cap; idempotency key is SHA-256 of diagram id, selected item id, and graph version; raw HTML is stripped and `@` mentions escaped; executor retries up to three times | Unit tests cover allowlist rejection, wrong item, injection text, cap, sanitization, dry-run, idempotency and retry. The connected browser approved only a dry-run |
| Credentials | `GITHUB_TOKEN` and `GEMMA_API_KEY` are read only by the API process; `.env.example` contains empty placeholders | Neither key was written to the worktree, tool logs, browser bundle, or ZIP. No live model or GitHub request was made |

Phase 3 verification: `pnpm test` reported 12 files and 56 tests passed; `pnpm lint` passed. Connected-browser flow: interpret member fixture, open Outputs, see incomplete story remain a draft, see the completed story as verified, prepare an issue preview for the allowlisted `octo/demo` test repo, and approve the dry-run. The action returned “Dry run recorded; no issue was sent.” The board edit control was also exercised and wrote a user patch. No real GitHub issue was created. `pnpm test:e2e` remains blocked because the Playwright Chromium executable is absent; the new Phase 3 test is committed for environments with Playwright installed.

## Phase 4 decisions and gate

| Decision | Choice | Verification |
|---|---|---|
| ERD relation orientation | `one_to_many` means the edge's `from` entity is the parent and the `to` entity receives the foreign key; `many_to_many` emits a join table | PGlite test checks tables and foreign-key count |
| Common PostgreSQL types | `*_id`/`id` → UUID; email → text/unique; `*_at` → timestamptz; `is_*`/`has_*` → boolean; amount/price/cost/total → numeric(12,2); count/quantity/rank/age → integer; metadata/payload/settings → jsonb; other attributes → text | Inference table unit tests; uncertain fields remain visible in the assumptions list |
| Missing entity primary key | DDL preview adds `id UUID PRIMARY KEY` and records that choice as an assumption. A missing-column high-severity rule offers a compensating, versioned patch that is rechecked after each change | Unit test confirms one patch advances the graph and resolves the finding |
| DDL verification | Execute emitted DDL in a fresh PGlite database and compare created table names plus every foreign-key source column and target table/key before showing a verified status | Node PGlite and connected-browser check both pass |
| Browser SQL engine | Load PGlite only after the user asks to verify; DDL workbench runs locally in the browser | Production build code-splits verifier; local browser execution passed. WASM and data assets add about 16 MB uncompressed |

Phase 4 verification: `pnpm test` reported 13 files and 62 tests passed; `pnpm lint` and `pnpm build` passed. The browser ERD tab reported “VERIFIED · PGlite DDL execution” for 4 tables and 3 foreign keys. Build warnings remain for large OpenCV, HEIC, ELK, and PGlite assets. No SQL is sent to a remote database.

## Phase 5 decisions and gate

| Decision | Choice | Verification |
|---|---|---|
| Text intent | Deterministic local rules classify create, modify, explain, constrain, and command. Six named patterns produce graph patches; explicit constraints merge through `set_constraints` patches | Text tests cover each category, patterns, and constraints |
| Modify-only | Only an exact-label rename is applied by the local compiler. Unknown or duplicate labels and unsupported modifications return a visible message without changing graph state | Tests prove one matching node changes while unmentioned nodes stay the same |
| Cloud output | AWS resources come from fixed HCL templates; external strings are normalized or quoted. Public buckets, world-open ingress, and disabled encryption are verified findings. Output mode is plan-only | Unit tests cover rule findings and HCL injection text; no apply route or executor exists |
| Terraform gate | Write generated HCL to a private temporary directory; run `fmt -check`, initialize without a backend, then `validate`; remove the directory even on failure | Missing CLI returns `unavailable`. Real Terraform `fmt` and `validate` are **unverified** because the CLI is not installed |
| Jira | Fixture/live proposal is limited to selected, verified stories and allowlisted project keys. Live calls require a fixed HTTPS base URL whose hostname is separately allowlisted. Dry-run needs no credentials. A user must approve the exact summary and description | API test proposes and approves a dry-run with no Jira network request; tool tests cover host/project restrictions, allowlist, sanitization, and idempotency |
| Text safety and actions | Sketch and story content remain data. Jira and GitHub operations share the 25-item cap. No external action happens while proposing | API tests verify proposal is pending until approval; real GitHub/Jira calls remain unverified |

Phase 5 verification: offline text/cloud/Jira unit tests and API route tests passed; `pnpm lint` and `pnpm build` passed. The Cloud workbench is visible in the app and displays deterministic Terraform preview. The environment has no Terraform executable, so the UI/API reports unavailable. Jira/GitHub live credentials are blank; no external issue was created. Manual browser checks exercised the text modify-only patch path and cloud Terraform-unavailable state. API and unit gates cover Jira dry-run behavior.

## Phase 0 spike results

Gate 0 passed: `pnpm test` reported 3 test files and 19 tests passed; `pnpm lint` completed without errors; `pnpm schemas:export` exported three schemas; and `pnpm spike` replayed the recorded fixture. The Ollama-compatible endpoint at `http://localhost:11434/v1/models` returned `ECONNREFUSED`, and no model endpoint environment variable was configured.

The fixture replay succeeds as an offline plumbing check. It is not evidence about model quality. The spike runner supports a live OpenAI-compatible endpoint and ten reviewed image cases, but the committed case list contains placeholders because no real sketches or model endpoint were available.

| Measurement | Result | Status |
|---|---|---|
| Region box format and scale returned by Gemma | Not measured | **Unverified** |
| Valid-JSON rate for Pass A, 50 constrained and 50 unconstrained calls | Not measured | **Unverified** |
| Valid-JSON rate for Pass B, 50 constrained and 50 unconstrained calls | Not measured | **Unverified** |
| Pass B quality at temperatures 1.0, 0.7, and 0.4 | Not measured | **Unverified** |
| Gemma 4 context sizes, image budgets, audio limit, and thinking-token behavior | Not checked against a real serving stack or hardware | **Unverified** |

Run `pnpm spike` for the offline fixture replay. To run live measurements, replace the ten entries in `eval/spikes/cases.json` with image paths, reviewed transcriptions, and expected structures, set the `GEMMA_*` environment variables, and run `pnpm exec tsx eval/spikes/run-spikes.ts --mode live`. Live calls bypass the response cache so repeated trials are real requests.



## Phases 6–8 decisions and gate

| Area | Implementation | Verification / limit |
|---|---|---|
| Software | Typed API operation contract; OpenAPI 3.1 emitter and validator; API operations added through graph patches; deterministic route mock; generated stub previews; handwritten-file conflict detection; injectable TypeScript export gate | Type check and production build pass. Export is a preview and generated projects are not executed. |
| Storyboard and theme | Graph dependency ordering, player controls, speaker notes, coverage check, Markdown export, and browser-local palette extraction from a reference image | Type check and production build pass. Story text is derived deterministically; live model-authored narration is not connected. |
| Workflow | Strict named-step schema, HTTPS host allowlist, approval status, dry-run only; no request executor | Unit coverage; external workflows are disabled. |
| Circuit | Pure Boolean input/AND/OR/NOT/XOR/output evaluator with closed-path detection | Unit coverage; conceptual logic only, no SPICE. |
| Voice | 30-second constraint and recorded transcript fixture with explicit no-storage result | Helper coverage; no audio capture or live Gemma audio request. |
| Careful/eval | Overlapping tile planner, majority vote/tie reporting, render-back mismatch helper | Helper coverage only; full 30-sketch CI regression corpus remains unverified. |

Phase 6–8 focused tests: 11 passed. Full offline suite after model diagnostics and route changes: `./node_modules/.bin/vitest run` reported 18 files and 93 tests passed. Full type check: `./node_modules/.bin/tsc --noEmit` passed. Production build: `./node_modules/.bin/vite build apps/web --config apps/web/vite.config.ts` passed. Initial package-manager resolution was blocked by unavailable registry metadata, so dependencies were not refreshed; all needed local packages were already present.

Current feature pass: ERD and Cloud workbenches compile domain nodes from the shared graph when present and provide graph-patch controls to add an ERD entity/relationship or a safe cloud starter. Backlog, Storyboard, ERD, Cloud, Software, Workflow, and Circuit now each expose image intake that targets its corresponding graph domain; Storyboard targets user stories and renders the resulting nodes as frames. Theme keeps its direct local palette extraction, while Voice remains fixture-based. A target-domain image skips Pass 0 classification, runs transcription plus structure, and returns to the feature page after the shared graph updates. Image node regions are attached from matching transcription markers, never from model-supplied coordinates. Canvas and Model setup accept a replacement API key and write it only to ignored local `.env` with restrictive permissions; the API returns only status, not the credential. The key previously shared in chat must be revoked and replaced if it has not already been rotated.

## Google Gemma request compatibility (2026-10-25)

The Google OpenAI-compatible endpoint rejected top-level `top_k` and `thinking`. The adapter now omits those fields for Google and carries Gemma 4 thinking configuration through Google's `extra_body.google.thinking_config` extension. The full nested Pass A and Pass B schemas caused HTTP 400 responses because they exceeded the endpoint's constrained-decoding limits. Those passes now send compact provider schemas for transcription boxes and common patch operations; the complete Zod schemas remain authoritative. Graph-invariant failures during patch application are fed back to the model and retried up to the existing limit.

Verification: `./node_modules/.bin/tsc --noEmit` passed; `./node_modules/.bin/vitest run apps/api/src/pipeline.test.ts packages/gemma/src/adapter.test.ts` passed 14 tests. A live typed-story job completed through Pass B. One live synthetic PNG board completed image transcription and structure on Google Gemma with two story nodes containing complete “As a… I want… so that…” text. Subsequent requests returned intermittent HTTP 500s. The harness now retries missing/incomplete story text with the exact validator error, rejects headers converted to stories, and fills a missing image region only when a single unmatched note and story remain; the mocked pipeline fixture covers edge repair and this unambiguous region match. This verifies one end-to-end synthetic image run and local guardrails; handwriting accuracy on real photographs, provider reliability, and the 10-image quality/temperature benchmark remain unverified. Google's OpenAI compatibility guide documents `extra_body` for Gemini-specific fields, and its structured-output guide notes that complex schemas can return HTTP 400; see [OpenAI compatibility](https://ai.google.dev/gemini-api/docs/openai) and [structured outputs](https://ai.google.dev/gemini-api/docs/structured-output).

## Feature-targeted image intake

Backlog and Storyboard uploads target the `userstory` graph domain; ERD, Cloud, Software, Workflow, and Circuit uploads target their respective domains. The user-selected target skips model classification so a Storyboard image cannot be silently classified as an ERD. Pass A still reads the image and marker boxes, Pass B emits patches, and the selected workbench reads the updated shared graph. Text labels are matched against transcription tags to attach CV-supplied regions when Pass B omits them. Model-provided region coordinates are discarded when there is no matching marker. Theme has a separate deterministic image-to-palette flow; Voice remains an offline fixture because live Gemma audio input is not connected.

## Native Gemini SDK and page-level feature implementation (2026-10-25)

This section supersedes earlier OpenAI-compatible endpoint and Phase 0-only notes above. The current user explicitly requested the native Google SDK and full feature work. Keep `GEMINI_API_KEY` on the API server; the existing `GEMMA_API_KEY` is accepted only as a server-side migration alias for an existing local setup. No compatibility base URL or OpenAI client remains in runtime source. The fixed model is `gemini-3.8-flash`; Google documents the stable model, audio/image input, and structured outputs [here](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash).

`packages/gemma` now calls `GoogleGenAI.models.generateContent`, uses SDK enums for thinking and native function declarations, sends image/audio as inline data, and omits sampling fields that this model does not use. Zod validates every response locally. The structure-pass provider schema is intentionally compact to avoid Google's constrained-output size rejection; strict complete Zod contracts and graph invariants remain the final acceptance gate. The credential page tests through the same SDK adapter and does not return the secret.

ERD output remains deterministic and is executed in PGlite before showing verified status; the result now includes table, column, and row previews. Software UI nodes have a fixed strict contract and deterministic React project emitter; the app can run in an isolated `sandbox="allow-scripts"` preview iframe and its calculator uses explicit arithmetic without `eval`. Voice now captures browser audio up to 30 seconds, converts it to mono 16 kHz WAV, sends it to `/api/voice/jobs`, requests a strict transcript/domain response, and feeds the transcript into the ordinary patch pipeline with `via: "voice"`. Audio bytes are not persisted. The page also has typed and offline demo paths. Diagnostic evaluation now selects ERD/Cloud/User Story rules by graph domain, and edge-targeted findings receive red source overlays.

Verification for this implementation pass: `./node_modules/.bin/tsc --noEmit --pretty false` passed; `./node_modules/.bin/vitest run` passed 18 files / 102 tests; and `./node_modules/.bin/vite build apps/web --config apps/web/vite.config.ts` passed. The production build still reports large image/PGlite/layout bundles and upstream PGlite `eval` warnings. A live `/api/model/test` call through the SDK succeeded for `gemini-3.8-flash`. One live structured software request passed the earlier 400 schema-validation response after large `maxItems` limits were removed, but Google's generation service then returned `504 DEADLINE_EXCEEDED` after about 89 seconds. The matching offline software job completed and returned one screen, 19 UI components, and 19 containment edges. A live audio request, browser microphone capture, and the 1.5-second target remain **unverified**. Terraform CLI is not installed in this environment, so generated HCL's `fmt`/`validate` gate remains **unverified**. Terraform output is plan-only; no apply route exists.

## Transient model availability errors (2026-10-25)

The native SDK adapter retries temporary HTTP 408/429/500/502/503/504 and common network errors up to two times, with 700 ms and 1600 ms delays. Exhaustion produces a feature-appropriate message; image, sketch, voice, and model-setup UIs expose retry actions, and image/text workbenches retain deterministic offline demos. Retry success and exhausted 503 behavior are mock-tested. A Google-side 503 cannot be eliminated by client code; live service availability remains external. Verification for this fix: `./node_modules/.bin/vitest run` passed 18 files / 109 tests; `./node_modules/.bin/tsc --noEmit --pretty false` passed; `./node_modules/.bin/vite build apps/web --config apps/web/vite.config.ts` passed. Build reports existing large-asset and upstream PGlite eval warnings. The package-manager command was unavailable (`pnpm` absent; Corepack could not write its cache), so local installed binaries were invoked directly.

## Structure patch operation payloads (2026-10-25)

The compact Google constrained-output schema now requires the operation payload matching each discriminator (for example `add_node` requires `node`, `add_edge` requires `edge`). Other patch operation payloads are similarly required, while the full local Zod contract remains authoritative. This prevents malformed structure responses from reaching graph application; the existing repair loop can still feed the exact validator error back for any remaining malformed output. Regression tests cover provider schema requirements and recovery from missing node/edge payloads. Verification after this fix: 18 test files / 111 tests pass; `tsc --noEmit` passes; production Vite build passes with the existing large-asset and PGlite eval warnings.

## Gemini image transcription schema (2026-10-25)

Pass A now uses a compact Gemini provider schema rather than the full generated Zod schema. It avoids fixed-length tuple (`prefixItems`) and array-bound keywords that can be rejected by the provider's constrained-output subset. The schema still describes tags, arrows, and boxes; local `TranscriptionSchema` enforces exact four-integer boxes, confidence bounds, and array limits before any graph patch is created. Regression tests inspect the provider schema. Verification: 18 test files / 112 tests pass; TypeScript and production build pass. A live Storyboard photo request remains unverified; the API server has been restarted with the updated schema.

## Feature checks after rate-limit report (2026-10-25)

HTTP 429 is now labeled explicitly as a Google rate limit and the message reports total attempts versus retries accurately. The service must still clear its own quota/capacity limit; use the page's offline demo while waiting. Ran offline graph generation checks for stories, ERD, Cloud, software, workflow, and circuits. All generated graphs pass graph invariants; assertions verify story text, ERD relation, private/encrypted bucket and resource links, calculator controls/containment edges, workflow step order/edges, and circuit connectivity. This uncovered and fixed workflow text parsing that left stray trigger/conjunction words as steps. The storyboard helper, theme palette, circuit simulator, software emitter, PGlite ERD verifier, Terraform unavailable handling, and action dry-run are also covered by the existing pack/API tests. Latest verification: 18 test files / 114 tests pass; TypeScript and production build pass. Live model availability, Terraform CLI verification, and real external actions remain environment/provider-dependent.

## Rate-limit protection for connection checks (2026-10-25)

Repeated immediate 429 retries do not resolve a provider rate limit and can create extra failed requests. The adapter now treats 429 as non-retryable, opens a shared 60-second per-process cooldown across all model features, and fails subsequent model calls fast with an explicit cooldown message. `/api/model/test` returns HTTP 429 with `retryAfterSeconds`; Model setup disables its test buttons and shows a countdown. A 429 is not presented as evidence that the API key is invalid. Regression tests confirm one provider call on 429 and no further SDK call during cooldown. Latest verification: 18 test files / 114 tests pass, `tsc --noEmit` and web production build pass. The API server has been restarted; external Google capacity/quota remains outside the app's control.

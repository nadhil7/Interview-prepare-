# AI Interview Prep Kit

Full-stack app that turns a job description + company URL + days-until-interview into a
structured interview prep kit (company brief, role breakdown, question bank, flashcards,
day-by-day schedule).

**Status:** Phases 1-6 (scaffold/data model, retrieval, generation, coverage+schedule, backend
orchestration, CLI batch tool) complete. See commit history for progress. Full architecture/setup
docs will be filled in during Phase 8.

## Design notes

### Why the coverage loop is capped at 2 passes
`pipeline/src/coverage/coverage-loop.ts` runs one initial question-generation pass, checks which
requirements ended up with zero covering questions, and — if any did — runs exactly one more
gap-fill pass scoped to just those requirements, then stops regardless of outcome. Two reasons:
- **Diminishing returns.** The first pass covers the overwhelming majority of requirements by
  construction (every category call is explicitly asked to cover the requirements it's given); a
  gap after that is usually a genuine edge case (an odd category/kind mapping, a very short JD),
  and a second targeted pass reliably closes it. A third pass would be re-asking the same model
  the same scoped question with no new information — unlikely to change the outcome.
- **Free-tier token/rate budget.** Every additional pass is another round of Gemini calls charged
  against the same free-tier limits the rest of the pipeline shares (see the call-count note
  below). Uncapped retries here would trade a rare residual gap for a much larger, harder-to-bound
  request budget per kit.
- If a gap somehow survives both passes, it's recorded honestly in `coverage.uncovered_requirement_ids`
  rather than silently dropped or papered over — in practice this is rare because the deterministic
  heuristic fallback (see below) always succeeds at producing a covering question when given at
  least one requirement, so a gap only survives if Gemini fails validation in a way the heuristic
  also can't fill, which shouldn't happen given the fallback's design.

### Gemini call volume per kit and rate limiting
Worst case per kit: 1 (requirement extraction) + 1 (company brief) + 4 (one per question category)
+ up to 4 more (second coverage pass, scoped per category with a gap) + 1 (flashcards) = up to 11
Gemini calls. `pipeline/src/generation/gemini-rate-limit.ts`'s `createLimitedFetch` wraps `fetch`
itself with a `createConcurrencyLimiter` (reused from `retrieval/rate-limit.ts`, not a second
implementation), so every pipeline call sharing that fetchImpl — a kit's 4-category fan-out, and
every concurrently-running kit/case — is throttled together rather than each burst stacking
independently. `gemini-client.ts`'s own backoff still only reacts *after* a 429; the limiter is
what prevents the burst in the first place. The backend (`gemini-config.ts`) and the CLI
(`cli/src/index.ts`) each create their own instance of this helper for their own process — a
limiter can't be shared across process boundaries, and doesn't need to be, since each process is
managing its own share of the free-tier budget.

### CLI batch concurrency and the 15-minute/5-case target
`cli/src/index.ts` bounds two independent things: how many *cases* run concurrently
(`createConcurrencyLimiter`, default 3 — plain practicality, so 5 cases don't all crawl/generate
at once and blow past memory/network limits) and how many *Gemini requests* are in flight at once
process-wide (`createLimitedFetch`, default 2 — the free-tier-respecting cap from the section
above). Because the Gemini limiter is shared across every case, raising case concurrency doesn't
multiply Gemini load — it only lets more crawling/non-LLM work overlap while LLM calls queue
behind the same cap. A real end-to-end run against a local fixture server (see
`cli/src/__tests__/evaluate.test.ts` and the manual smoke test run during Phase 6) completed a
single case in ~1s with no Gemini key configured (heuristic fallback path); with a real key,
Gemini flash latency (~2-5s/call) times ~11 worst-case calls at concurrency 2 puts a single kit at
roughly 30-60s, comfortably inside 15 minutes for 5 cases even with some retries.

### Job crash/restart recovery
A kit's `job.status` is a state machine (`pending -> researching -> generating -> checking ->
ready|failed`) persisted on every stage transition. If the backend process dies or restarts while
a job is mid-run, the doc would otherwise sit stuck at that status forever, and — since duplicate-
submission handling matches on `requestHash` regardless of job status — resubmitting the same
input would just return the stuck kit again with no way to retry it. `sweepStaleJobs()` in
`generate-kit.ts` handles this: any kit in a non-terminal status whose `updatedAt` (Mongoose's
built-in timestamp, bumped on every stage-transition write) is older than `STALE_JOB_TIMEOUT_MS`
(5 minutes — generous relative to the ~60-90s a healthy run takes) is marked `failed` with a
`STALE_JOB` error. This runs once at server startup (recovers jobs orphaned by the crash that just
happened) and on a 1-minute interval (catches a job that hangs without the process dying).
`findOrCreateKitJob` also checks staleness directly on resubmission, resetting a stuck kit to
`pending` and restarting its job rather than waiting for the next sweep tick. Nothing here attempts
to *resume* a partially-completed run (resume mid-crawl or mid-generation isn't something the
pipeline is built for) — failing cleanly and letting the user resubmit is the safe behavior.

### Section regeneration doesn't self-heal coverage gaps
`regenerateSection`'s category regen makes one `generateQuestionsForCategory` call, then rechecks
coverage with the pure `findUncoveredRequirementIds` — it does not re-run `runCoverageLoop`'s
gap-fill pass. If that single call happens to leave a must-requirement in that category uncovered,
`validateKit`'s cross-field check fails the whole regeneration and nothing is persisted — the
stored kit is untouched, and the user can just click regenerate again. This is a deliberate
reject-and-retry choice over self-healing: it's simple, it can never corrupt a previously-valid
kit, and duplicating the pass-cap/rate-limit reasoning from the initial generation for a single-
category regeneration (where a full gap is far less likely, since it's one call against requirements
that already generated successfully once) wasn't worth the extra complexity.

### One shared orchestration function, two callers
`pipeline/src/orchestrator/generate-kit.ts`'s `generateKit()` is the entire crawl -> extract ->
generate -> coverage -> schedule -> validate sequence, callable with no Express/Mongoose/CLI
dependency. The backend's `runGenerationJob` calls it and layers job-state persistence (progress
callbacks -> `job.status`/`job.progress` writes) and duplicate-submission/stale-job handling on
top; the CLI's `evaluate()` calls the exact same function per case with no progress callback and
writes the result straight to the batch output file. Neither reimplements the sequence — this was
a deliberate refactor at the start of Phase 6 (it originally lived inline in
`backend/src/orchestration/generate-kit.ts`) specifically so the CLI wouldn't have to duplicate it,
per the brief's "no parallel implementation" requirement.

## Workspace layout
- `pipeline/` — shared retrieval/extraction/generation/coverage/schedule/orchestration logic + the
  Zod kit schema. `orchestrator/generate-kit.ts` is the single generation entry point both the
  backend and CLI call.
- `backend/` — Express API (auth, kit CRUD, job orchestration)
- `frontend/` — Next.js UI
- `cli/` — batch evaluation entry point (`npm run evaluate -- --input cases.json --output kits.json`)

## Local setup
```
cp .env.example .env   # fill in MONGODB_URI, JWT_SECRET, GEMINI_API_KEY
npm install
npm run build
npm test
npm run dev:backend
npm run dev:frontend
```

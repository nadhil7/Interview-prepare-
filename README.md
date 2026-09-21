# AI Interview Prep Kit

Full-stack app that turns a job description + company URL + days-until-interview into a
structured interview prep kit (company brief, role breakdown, question bank, flashcards,
day-by-day schedule).

**Status:** Phases 1-5 (scaffold/data model, retrieval, generation, coverage+schedule, backend
orchestration) complete. See commit history for progress. Full architecture/setup docs will be
filled in during Phase 8.

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
Gemini calls. As of Phase 5, `backend/src/orchestration/gemini-config.ts` wraps `fetch` itself with
a single process-wide `createConcurrencyLimiter` (reused from `retrieval/rate-limit.ts`, not a
second implementation) so every pipeline call sharing that config — a kit's 4-category fan-out,
and every concurrently-running kit's job — is throttled together rather than each burst stacking
independently. `gemini-client.ts`'s own backoff still only reacts *after* a 429; the limiter is
what prevents the burst in the first place. Phase 6's CLI will need its own instance of the same
pattern for cross-case concurrency within its own process (a separate Node process, so it can't
share the backend's in-memory limiter — see the note in that phase once written).

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

## Workspace layout
- `pipeline/` — shared retrieval/extraction/generation/coverage/schedule logic + the Zod kit schema
- `backend/` — Express API (auth, kit CRUD, job orchestration)
- `frontend/` — Next.js UI
- `cli/` — batch evaluation entry point (`npm run evaluate`)

## Local setup
```
cp .env.example .env   # fill in MONGODB_URI, JWT_SECRET, GEMINI_API_KEY
npm install
npm run build
npm test
npm run dev:backend
npm run dev:frontend
```

# AI Interview Prep Kit

Full-stack app that turns a job description + company URL + days-until-interview into a
structured interview prep kit (company brief, role breakdown, question bank, flashcards,
day-by-day schedule).

**Status:** Phases 1-4 (scaffold/data model, retrieval, generation, coverage+schedule) complete.
See commit history for progress. Full architecture/setup docs will be filled in during Phase 8.

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

### Gemini call volume per kit and rate limiting (known gap, deferred to Phase 5/6)
Worst case per kit: 1 (requirement extraction) + 1 (company brief) + 4 (one per question category)
+ up to 4 more (second coverage pass, scoped per category with a gap) + 1 (flashcards) = up to 11
Gemini calls. Today, nothing caps how many of these run concurrently — `generateQuestionBank`
fires its 4 category calls via a bare `Promise.all`, and `gemini-client.ts` only backs off *after*
a 429 already happened (reusing `retrieval/rate-limit.ts`'s `backoffDelayMs`), it doesn't prevent
bursts. `retrieval/rate-limit.ts`'s `createConcurrencyLimiter` is wired up for page-fetch
concurrency in the crawler but not for Gemini calls. This needs a single shared limiter instance
once Phase 5 (backend job orchestration) and Phase 6 (CLI batch concurrency) exist, so a kit's
internal fan-out and cross-kit/cross-case concurrency don't stack multiplicatively against the
same free-tier rate limit. Deliberately not fixed in isolation before those callers exist.

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

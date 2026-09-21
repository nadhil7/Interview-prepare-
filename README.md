# AI Interview Prep Kit

Full-stack app that turns a job description + company URL + days-until-interview into a
structured interview prep kit (company brief, role breakdown, question bank, flashcards,
day-by-day schedule).

**Status:** Phase 1 (scaffold, data model, auth) complete. See commit history for progress.
Full architecture/setup docs will be filled in during Phase 8.

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

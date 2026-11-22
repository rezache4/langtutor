# LangTutor: onboarding

Personal Italian learning PWA (Android-first, works on desktop). Built to fix pain points of Reverso's flashcards:
random example per card, rich "details" panel, lemma "master pages" (every conjugated form redirects to its verb),
a real audio setting, and visible spaced repetition (FSRS). Offline-first; optional Google sign-in + Supabase sync.

## Layout
- `app/`: Vite + React + TypeScript PWA. Dexie (IndexedDB) for local data, `ts-fsrs` for scheduling, vite-plugin-pwa.
  - `src/db/schema.ts` Dexie schema (versioned; v3 current). Local caches: `lemmas`, `formIndex`, `examples`, `entryPool` (not synced).
    User-owned (synced): `cards`, `reviewLog`, `settings`, `userEntries`, `userExamples`, `userGlosses`. Every user row has `updatedAt` and soft delete.
  - `src/data/loader.ts` loads `/data/core.json` (lemmas + forms; the app opens once it is imported) and then `/data/examples.json` in the background (`useExamplesStatus`). Chunked import, version/ETag check; examples are cleared and reloaded whenever the core changes (ids are build-local).
  - `src/lib/` `lookup.ts` (search, autocomplete, "did you mean"), `cards.ts` (all card writes), `queue.ts` (review queue),
    `fsrs.ts`, `tts.ts` (audio mode off/tap/auto), `tags.ts` (grammar labels), `reverso.ts` (CSV import),
    `sync.ts` / `syncCore.ts` / `auth.ts` (Supabase sync, injectable core, last-write-wins).
  - `src/pages/` Search, Word, Entry (phrases/unknown words), Review, Stats, Settings (+ AccountCard).
  - Tests: `npm test` (vitest, sync engine with fake remote). `npm run build` also type-checks.
- `pipeline/`: Python stdlib build of the offline dictionary `out/bundle.json` (~34 MB, ~6 MB gzipped) from
  Tatoeba (sentences, CC BY 2.0 FR) + Wiktionary via kaikki.org (CC BY-SA 4.0). See `pipeline/README.md`.
  Run: `.venv/Scripts/python -I build.py [download|build|split|all]` (writes `bundle.json` plus the split `core.json` / `examples.json`; `split` re-splits an existing bundle), then `cd ../app && npm run data:sync`.
  Optional local-only `pipeline/keep_lemmas.txt` (gitignored) forces extra lemmas into the bundle.
- `supabase/migrations/0001_init.sql`: generic `user_docs` table + RLS + `upsert_docs` / `pull_docs` RPCs.
- `docs/SETUP.md`: one-time Supabase + Google OAuth setup. `.github/workflows/supabase-keepalive.yml`: daily ping against the free-tier 7-day pause.

## Run it
```
cd app
npm install
cp .env.example .env        # VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY (optional; without them sync is off)
npm run data:sync           # needs pipeline/out/core.json + examples.json; falls back to a tiny sample.json otherwise
npm run dev                 # or: npm run build && npx vite preview --host --port 4173
```
The dictionary files are not in git (`app/public/data/*.json` except `sample.json` are ignored): build it with the pipeline (needs ~800 MB download once).

## Design decisions (settled)
- PWA, not native. Local-first; the app must work fully offline and fully signed out.
- Supabase free tier is enough (user data is a few MB/year/user); dictionary data never goes in Supabase.
- Auth: Google sign-in (most convenient for non-technical users). Sync = push/pull rows by `updated_at` LWW, pull cursor on server time.
- FSRS scheduling; next-review time must always be visible. Audio only plays if setting is `auto`; `off` truly silent.
- Master pages per lemma; ambiguous forms go to the most frequent lemma with a dynamic "Did you mean ...?" computed from the searched form only.
- Convenience for end users wins every setup/design tie.

## Gotchas
- Dev machine is Windows; the Bash tool is Git Bash: use forward slashes in paths (`cd C:/Users/...`).
- Lemma ids in the bundle are sequential ints and change whenever the pipeline output changes; user data must never store them. Cards, user glosses and user examples refer to a lemma by its stable `key` (`lemma|pos`, derived in the loader; card id `l:<key>`), so data survives bundle rebuilds and syncs between devices.
- ts-fsrs v6 has no `elapsed_days`. Settings keys `bundleVersion`, `bundleSig`, `coreSig`, `examplesVersion`, `deviceId` are device-local (not synced).
- Never commit `.env`, the dictionary bundle, or personal word lists. Commit as the project identity configured in repo-local git config.
- Data credits (Tatoeba, Wiktionary/kaikki) must stay visible in Settings > About; the bundle is CC BY-SA.

See `docs/BACKLOG.md` for what to do next.

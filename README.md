# LangTutor

An offline-first Italian learning app (installable PWA, Android-first, works on desktop).

- **Search any form, land on the lemma.** Type `cercherebbe`, get the page for *cercare* with every form, grammar labels, glosses and real example sentences. Autocomplete as you type, "did you mean" for ambiguous forms.
- **Spaced repetition with FSRS.** A random example sentence per card, an "I know it" skip, a details panel, and the next review time is always visible.
- **Bring your own words.** Import a Reverso favorites CSV (words and phrases, with your examples).
- **Works fully offline and signed out.** Optional Google sign-in turns on sync, so your cards follow you between devices.
- **Your data stays yours.** See the [privacy policy](app/public/privacy.html).

## Run it locally

```
cd app
npm install
cp .env.example .env      # optional: Supabase URL + publishable key; without them sync is off
npm run data:sync         # copies pipeline/out/bundle.json; falls back to a tiny sample dictionary
npm run dev
```

Build the dictionary yourself with the [pipeline](pipeline/README.md). Architecture and design decisions are in [docs/ONBOARDING.md](docs/ONBOARDING.md), open work in [docs/BACKLOG.md](docs/BACKLOG.md), hosting in [docs/DEPLOY.md](docs/DEPLOY.md).

## Tech

Vite, React, TypeScript, Dexie (IndexedDB), ts-fsrs, vite-plugin-pwa; Supabase (auth + a single synced table with row-level security) for optional sync. The Python pipeline uses only the standard library.

## License and data credits

The code is released under the [MIT license](LICENSE). The dictionary bundle the app downloads is derived from:

- **Wiktionary**, extracted by [kaikki.org](https://kaikki.org) (wiktextract): [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). The bundle is therefore shared under CC BY-SA 4.0.
- **Tatoeba** example sentences: [CC BY 2.0 FR](https://creativecommons.org/licenses/by/2.0/fr/), with thanks to the Tatoeba contributors.
- Word frequency information is computed from the same sentence corpus.

LangTutor is not affiliated with Reverso, Wiktionary, Tatoeba or Google.

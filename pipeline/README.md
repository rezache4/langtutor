# LangTutor data pipeline

Builds `out/bundle.json` (offline Italian learning bundle) from Tatoeba and Wiktionary data.

## Run

```bash
cd pipeline
python -m venv .venv                  # stdlib only, no packages to install
.venv/Scripts/python -I build.py      # download (skips files present in raw/) -> parse -> match -> write
.venv/Scripts/python -I build.py download   # or just one step: download | build
```

Raw downloads go to `raw/` (untrusted data; the script only reads it with `json`/`bz2`).
Tunables via env: `MAX_EX` (examples per lemma, default 25, spec cap 40), `PRUNE_NO_EXAMPLES=0`
(keep lemmas that never occur in Tatoeba; bundle grows to roughly 90 MB with MAX_EX=25).

## Output format

```json
{"version": "<date>-<hash>",
 "lemmas":   [{"id": 1, "lemma": "cercare", "pos": "verb", "glosses": ["to look for"]}],
 "forms":    [{"form": "cerco", "lemmaId": 1, "tags": "ind pres 1 sg"}],
 "examples": [{"id": 1, "lemmaId": 1, "form": "cerca", "it": "...", "en": "..."}]}
```

A form may appear several times with different `lemmaId`s (ambiguity, e.g. `era`).
`tags` are canonical codes (`ind.pres.1s`, `cond.3s`, `sub.impf.2p`, `imp.2s`, `ptcp.past`, `ger`, `inf`, `f.pl`),
up to 3 alternatives separated by ` | `. Qualifiers (alt, apocopic...) are dropped; forms that are only
archaic/obsolete/regional are removed.
`examples[].form` is the surface token that matched.

## What the build does

1. Sources: Tatoeba ita/eng sentences + ita-eng links; kaikki.org Italian JSONL (stream-parsed).
2. Lemmas: single-word, lowercase entries; proper nouns (`name`, capitalised), affixes, phrases,
   proverbs, abbreviations skipped. Max 8 glosses (first gloss of each sense, trimmed to 100 chars; "inflection of"/"form of" notes dropped).
   Pure form-of entries are not lemmas.
3. Forms: the `forms` tables of each lemma, plus every `form-of` / `alt-of` sense (so `vado` ->
   `andare` even when it is not in the table) and clitic compounds (`amarlo` -> `amare`).
   Wiktionary stress marks are removed (`vàdo` -> `vado`, `và` -> `va`); orthographic accents kept.
   Multiword forms and the verb `auxiliary` entries are skipped; unattested archaic/obsolete/
   poetic/etc. forms are dropped.
4. Matching: lowercase tokenisation, elisions split (`l'acqua` -> `l'`, `acqua`; the clitic is
   ignored). Every token is looked up in the form map; the sentence is attached to every lemma
   the token may belong to. Up to `MAX_EX` examples per lemma, sentences of 4-15 words preferred,
   allocated across forms proportionally to Tatoeba form frequency (D'Hondt; min 1 for the top 6 forms, max 40% per form). Duplicate Italian sentences removed.
5. Size control: lemmas that never appear in a Tatoeba sentence are dropped with their forms.

## Sources and licenses

- **Tatoeba** sentences and links, <https://tatoeba.org>, per-language exports from
  <https://downloads.tatoeba.org/exports/>. License **CC BY 2.0 FR**. Attribution: "Sentences from
  Tatoeba.org contributors, CC BY 2.0 FR". Sentence authors are not included in the bundle; the app
  must credit Tatoeba (with a link) in its About/credits screen.
- **Wiktionary** data via **kaikki.org** (wiktextract extraction of the English Wiktionary),
  <https://kaikki.org/dictionary/Italian/>. License **CC BY-SA 4.0** (plus GFDL). Attribution:
  "Dictionary data from Wiktionary contributors via kaikki.org (wiktextract by Tatu Ylonen),
  CC BY-SA 4.0". Lemma, form and gloss data in the bundle is derived from it, so the derived
  dataset must be shared under CC BY-SA 4.0 as well.
- The kaikki.org "postprocessed" download used here is marked deprecated by its maintainer;
  if the URL disappears, switch `SOURCES["kaikki-italian.jsonl"]` to the raw wiktextract data
  (<https://kaikki.org/dictionary/rawdata.html>), whose structure is nearly identical.

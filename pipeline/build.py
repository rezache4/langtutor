#!/usr/bin/env python3
"""Italian learning bundle builder (stdlib only).

Steps: download (skip if present) -> parse -> match -> write.

    .venv/Scripts/python -I build.py [download|build|all]

Output: out/bundle.json (+ out/bundle.json.gz for size reference).
"""
import bz2
import gzip
import hashlib
import heapq
import json
import os
import re
import sys
import time
import unicodedata
import urllib.request
from collections import defaultdict
from datetime import date

ROOT = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(ROOT, "raw")
OUT = os.path.join(ROOT, "out")

SOURCES = {
    "ita_sentences.tsv.bz2": "https://downloads.tatoeba.org/exports/per_language/ita/ita_sentences.tsv.bz2",
    "eng_sentences.tsv.bz2": "https://downloads.tatoeba.org/exports/per_language/eng/eng_sentences.tsv.bz2",
    "ita-eng_links.tsv.bz2": "https://downloads.tatoeba.org/exports/per_language/ita/ita-eng_links.tsv.bz2",
    "kaikki-italian.jsonl": "https://kaikki.org/dictionary/Italian/kaikki.org-dictionary-Italian.jsonl",
}

MAX_EX = int(os.environ.get("MAX_EX", 25))   # examples per lemma (spec cap 40; 25 keeps bundle <50 MB)
MAX_GLOSSES = 8
MAX_GLOSS_LEN = 100
MIN_W, MAX_W = 4, 15                          # preferred sentence length (words)
HARD_MAX_W = 25
# Size control: lemmas that never occur in the Tatoeba corpus (obscure words, ~80% of the
# dictionary) are dropped together with their forms unless PRUNE_NO_EXAMPLES=0.
PRUNE_NO_EXAMPLES = os.environ.get("PRUNE_NO_EXAMPLES", "1") != "0"
KEEP_FILE = os.path.join(ROOT, "keep_lemmas.txt")   # optional: lemmas kept even with zero examples
POOL_PER_FORM = 80                            # candidate sentences kept per surface form
MAX_TAGSETS = 3

# POS classes we do not keep as lemmas (proper nouns, multiword/affixes, symbols)
SKIP_POS = {"name", "proverb", "phrase", "prep_phrase", "character", "symbol",
            "punct", "affix", "prefix", "suffix", "infix", "circumfix",
            "interfix", "combining_form", "root", "abbrev", "initialism"}
# form tags that are table metadata or not forms of this lemma
SKIP_FORM_TAGS = {"table-tags", "inflection-template", "class", "romanization",
                  "source", "auxiliary", "canonical"}
# monosyllables whose final accent is real orthography (others are Wiktionary stress marks)
REAL_ACCENT_MONO = {"è", "dà", "dì", "là", "lì", "né", "sì", "tè", "già", "più", "può",
                    "ciò", "giù", "ché", "scià", "diè", "piè", "ciò", "fé", "ahimè"}


def load_keep():
    """Optional keep_lemmas.txt: one lemma per line ('#' comments). Missing file -> empty set."""
    if not os.path.exists(KEEP_FILE):
        return set()
    with open(KEEP_FILE, encoding="utf-8") as f:
        return {norm_form(l.split("#")[0]) for l in f if l.split("#")[0].strip()}


def log(*a):
    print(f"[{time.strftime('%H:%M:%S')}]", *a, flush=True)


RARE_TAGS = {"archaic", "obsolete", "poetic", "dialectal", "regional", "Tuscany", "dated",
             "misspelling", "proscribed", "nonstandard", "error-unknown-tag", "error-lua-exec"}
LEMMA_RARE = {"archaic", "obsolete", "dated", "poetic", "dialectal"}   # lemma-level: every sense has one
MOODS = {"indicative": "ind", "subjunctive": "sub", "imperative": "imp", "conditional": "cond"}
TENSES = {"present": "pres", "imperfect": "impf", "historic": "hist", "future": "fut"}
PERSONS = {"first-person": "1", "second-person": "2", "third-person": "3"}
NUMBERS = {"singular": "s", "plural": "p"}
GENDERS = {"masculine": "m", "feminine": "f"}
MODS = {"diminutive": "dim", "superlative": "sup", "augmentative": "aug"}
MOOD_PRIO = ["inf", "ger", "ptcp", "ind", "cond", "sub", "imp"]
GLOSS_NOTE_RE = re.compile(
    r"^(inflection of|.{0,40}form of|.{0,60}(participle|plural|singular|person|tense|"
    r"gerund|infinitive).{0,60}of)", re.I)


def canon_tags(tags):
    """Wiktionary tag set -> compact code ('ind.pres.1s', 'cond.3s', 'ptcp.past', 'ger', 'inf',
    'f.pl'), or '' if nothing recognisable. Qualifiers (alt, apocopic, abbreviation...) ignored."""
    t = set(tags)
    if "infinitive" in t:
        return "inf"
    if "gerund" in t:
        return "ger"
    gn = [GENDERS[x] for x in t if x in GENDERS]
    nm = [NUMBERS[x] for x in t if x in NUMBERS]
    if "participle" in t:
        tense = "pres" if "present" in t and "past" not in t else "past"
        return ".".join(["ptcp", tense] + (gn if len(gn) == 1 else []) + (nm if len(nm) == 1 else []))
    mood = next((MOODS[x] for x in MOODS if x in t), None)
    tense = next((TENSES[x] for x in ("historic", "imperfect", "future", "present") if x in t), None)
    if "past" in t and tense is None and mood in (None, "ind"):
        tense = "hist"
    pers = sorted(PERSONS[x] for x in t if x in PERSONS)
    if mood is None and tense and pers:
        mood = "ind"
    if mood:
        if mood == "imp":
            parts = ["imp"]
        elif mood == "cond":
            parts = ["cond"]
        else:
            parts = [mood] + ([tense] if tense else [])
        if pers and nm:
            parts.append(pers[-1] + nm[0] if "formal" not in t else "3" + nm[0])
        return ".".join(parts)
    parts = sorted(gn) + sorted(nm) + [MODS[x] for x in MODS if x in t]
    return ".".join(parts)


def best_tags(sets):
    """sets: iterable of frozensets. Returns (drop, code string). Drop if every set is rare-only."""
    sets = [s for s in sets if s]
    if not sets:
        return False, ""
    if all(s & RARE_TAGS for s in sets):
        return True, ""
    sets = [s for s in sets if not (s & RARE_TAGS)]
    if len(sets) > 1:   # negative-imperative rows only repeat other forms
        sets = [s for s in sets if "negative" not in s] or sets
    codes = {canon_tags(s) for s in sets} - {""}

    def key(c):
        h = c.split(".")[0]
        return (MOOD_PRIO.index(h) if h in MOOD_PRIO else 99, len(c), c)
    return False, " | ".join(sorted(codes, key=key)[:MAX_TAGSETS])


# ------------------------------------------------------------------ download
def download():
    os.makedirs(RAW, exist_ok=True)
    for name, url in SOURCES.items():
        dest = os.path.join(RAW, name)
        if os.path.exists(dest) and os.path.getsize(dest) > 0:
            log("skip (present)", name)
            continue
        log("downloading", url)
        req = urllib.request.Request(url, headers={"User-Agent": "LangTutor-pipeline/1.0"})
        with urllib.request.urlopen(req) as r, open(dest + ".part", "wb") as f:
            while chunk := r.read(1 << 20):
                f.write(chunk)
        os.replace(dest + ".part", dest)
        log("  done", name, os.path.getsize(dest) // 1024, "KiB")


# ------------------------------------------------------------------ text helpers
TOKEN_RE = re.compile(r"[^\W\d_]+(?:['’][^\W\d_]+)*")
WORD_RE = re.compile(r"[^\W\d_]+")
INFINITIVE_RE = re.compile(r"(are|ere|ire|rre)$")
VOWEL_GROUP = re.compile(r"[aeiouàèéìíòóùú]+")
ACCENTED = "àèéìíîòóùúû"


def strip_accent(ch):
    return unicodedata.normalize("NFD", ch)[0]


def norm_form(w):
    """Lowercase NFC; strip Wiktionary stress marks (interior accents, and final accents on
    non-orthographic monosyllables such as và/stà/fà/dò)."""
    w = unicodedata.normalize("NFC", w.strip().lower())
    if len(w) > 1:
        body = "".join(strip_accent(c) if c in ACCENTED else c for c in w[:-1])
        last = w[-1]
        if last in ACCENTED and w not in REAL_ACCENT_MONO and len(VOWEL_GROUP.findall(body)) == 0:
            last = strip_accent(last)
        w = body + last
    return w


def tokenize(text):
    """Lowercased word tokens. Elisions split: l'acqua -> ["l'", "acqua"]; the
    elided clitic (ending with an apostrophe) is returned with the apostrophe."""
    toks = []
    for m in TOKEN_RE.finditer(unicodedata.normalize("NFC", text.lower())):
        w = m.group(0).replace("’", "'")
        if "'" in w:
            parts = w.split("'")
            toks.extend(p + "'" for p in parts[:-1])
            toks.append(parts[-1])
        else:
            toks.append(w)
    return toks


# ------------------------------------------------------------------ kaikki
def short_gloss(g):
    g = re.sub(r"\s+", " ", g).strip()
    if len(g) > MAX_GLOSS_LEN:
        g = re.sub(r"\s*[\[(].*$", "", g).strip() or g   # drop trailing bracketed notes
    if len(g) > MAX_GLOSS_LEN:
        g = g[:MAX_GLOSS_LEN - 1].rstrip() + "…"
    return g


def parse_kaikki(path):
    """Stream-parse the JSONL. Returns (entries, form_of).
    entries[(word,pos)] = {"glosses": [...], "forms": {form: set(tagstr)}}
    form_of = [(inflected, lemma_word, pos, tagstr)] from 'form-of' senses."""
    entries, form_of = {}, []
    n = 0
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            n += 1
            try:
                e = json.loads(line)
            except ValueError:
                continue
            word, pos = e.get("word"), e.get("pos")
            if not word or not pos or pos in SKIP_POS:
                continue
            if not WORD_RE.fullmatch(word) or word != word.lower():
                continue          # multiword, hyphenated, or capitalised (proper noun)
            lw = norm_form(word)
            glosses = []
            rare_flags = []
            for s in e.get("senses") or []:
                tags = set(s.get("tags") or [])
                targets = s.get("form_of") or s.get("alt_of")
                if "compound-of" in tags:
                    # clitic compounds (amati = ama + ti): not lemmas; map to the verb in the links
                    cands = [norm_form(l[0]) for l in (s.get("links") or [])
                             if l and WORD_RE.fullmatch(l[0]) and INFINITIVE_RE.search(l[0])]
                    if cands:
                        form_of.append((lw, cands, pos, "clitic"))
                    continue
                if tags & {"form-of", "alt-of"} or targets:
                    for fo in targets or []:
                        w = fo.get("word") if isinstance(fo, dict) else None
                        if w and WORD_RE.fullmatch(w):
                            form_of.append((lw, [norm_form(w)], pos,
                                            " ".join(sorted(tags - {"form-of", "alt-of"}))))
                    continue
                if tags & {"obsolete", "archaic", "dated", "rare"} and len(e["senses"]) > 1:
                    continue
                gl = s.get("glosses") or []
                if gl:
                    g = short_gloss(gl[0])
                    if g and not GLOSS_NOTE_RE.match(g) and g not in glosses:
                        glosses.append(g)
                        rare_flags.append(bool(tags & LEMMA_RARE))
            if not glosses:
                continue
            ent = entries.setdefault((lw, pos), {"glosses": [], "forms": defaultdict(set), "rare": True})
            ent["rare"] = ent["rare"] and all(rare_flags)
            for g in glosses:
                if g not in ent["glosses"] and len(ent["glosses"]) < MAX_GLOSSES:
                    ent["glosses"].append(g)
            for fm in e.get("forms") or []:
                ftags = set(fm.get("tags") or [])
                if ftags & SKIP_FORM_TAGS:
                    continue
                ft = fm.get("form")
                if not ft or not WORD_RE.fullmatch(ft):
                    continue
                ent["forms"][norm_form(ft)].add(" ".join(sorted(ftags)))
            ent["forms"][lw].add("")
    log(f"kaikki: {n} lines -> {len(entries)} lemma entries, {len(form_of)} form-of senses")
    return entries, form_of


# ------------------------------------------------------------------ tatoeba
def read_tsv(name):
    with bz2.open(os.path.join(RAW, name), "rt", encoding="utf-8") as f:
        for line in f:
            yield line.rstrip("\n").split("\t")


def load_pairs():
    ita = {int(p[0]): p[2] for p in read_tsv("ita_sentences.tsv.bz2") if len(p) >= 3}
    eng = {int(p[0]): p[2] for p in read_tsv("eng_sentences.tsv.bz2") if len(p) >= 3}
    pairs, seen_text = {}, set()
    for p in read_tsv("ita-eng_links.tsv.bz2"):
        if len(p) < 2:
            continue
        a, b = int(p[0]), int(p[1])
        if a in ita and b in eng and a not in pairs:
            key = ita[a].lower()
            if key in seen_text:
                continue
            seen_text.add(key)
            pairs[a] = b
    out = [(ita[a], eng[pairs[a]]) for a in sorted(pairs)]
    log(f"tatoeba: {len(ita)} ita, {len(eng)} eng -> {len(out)} unique ita/eng pairs")
    return out


# ------------------------------------------------------------------ build
def build():
    t0 = time.time()
    entries, form_of = parse_kaikki(os.path.join(RAW, "kaikki-italian.jsonl"))
    log(f"kaikki parsed in {time.time() - t0:.0f}s")

    keys = sorted(entries)
    lemma_id = {k: i + 1 for i, k in enumerate(keys)}
    by_word = defaultdict(list)
    for k in keys:
        by_word[k[0]].append(k)

    # form -> {lemmaId: set(tagstr)}
    form_map = defaultdict(lambda: defaultdict(set))
    for k, ent in entries.items():
        lid = lemma_id[k]
        for form, tags in ent["forms"].items():
            form_map[form][lid].update(tags)
    for inflected, lemma_ws, pos, tags in form_of:
        for lemma_w in lemma_ws:
            cands = [k for k in by_word.get(lemma_w, []) if k[1] == pos] or by_word.get(lemma_w, [])
            for k in cands:
                form_map[inflected][lemma_id[k]].add(tags)
            if cands and tags == "clitic":
                break           # compound: first infinitive found in links is the verb
    log(f"form map: {len(form_map)} distinct forms")

    # ---- sentences: per surface token keep best POOL_PER_FORM sentences
    pairs = load_pairs()
    tok_sents = defaultdict(list)       # token -> [sentence idx]
    freq = defaultdict(int)             # surface form -> number of Tatoeba sentences containing it
    tokcount = defaultdict(int)         # surface form -> total token occurrences in Tatoeba
    sent_rank = []                       # idx -> (lens, nwords)
    for si, (it, _en) in enumerate(pairs):
        words = [t for t in tokenize(it) if not t.endswith("'")]
        nw = len(words)
        for t in words:
            if t in form_map:
                tokcount[t] += 1
        for t in set(words):
            if t in form_map:
                freq[t] += 1
        if nw < 2 or nw > HARD_MAX_W:
            sent_rank.append(None)
            continue
        lens = 0 if MIN_W <= nw <= MAX_W else (MIN_W - nw if nw < MIN_W else nw - MAX_W)
        sent_rank.append((lens, nw))
        for t in set(words):
            if t in form_map:
                tok_sents[t].append(si)
    pool = {}
    for t, lst in tok_sents.items():
        pool[t] = heapq.nsmallest(POOL_PER_FORM, lst, key=lambda i: (sent_rank[i], i))
    del tok_sents
    log(f"sentence index built: {len(pool)} matched surface forms ({time.time() - t0:.0f}s)")

    # ---- per-lemma selection: frequency-weighted (D'Hondt) across forms; every one of the top
    # MIN_TOP forms gets at least one example; no form may take more than MAX_SHARE of the total.
    lemma_forms = defaultdict(list)
    for form, lm in form_map.items():
        if form in pool:
            for lid in lm:
                lemma_forms[lid].append(form)
    # lemma freq = total Tatoeba token count of all its forms. Tokens of a form shared by several
    # lemmas (va = andare/gire, gente = noun/gire...) are split between them in proportion to
    # their own freq (a few EM rounds; lemmas whose senses are all archaic/obsolete/poetic count 50x less), so a lemma cannot win just because it borrows another's forms.
    lemma_word = {lid: k[0] for k, lid in lemma_id.items()}
    weight = {lid: (0.02 if entries[k]["rare"] else 1.0) for k, lid in lemma_id.items()}
    counted = [(tokcount[f], list(form_map[f])) for f in tokcount if f in form_map]
    eff = defaultdict(float)
    for c, lm in counted:
        for lid in lm:
            eff[lid] += c
    for _ in range(5):
        nxt = defaultdict(float)
        for c, lm in counted:
            if len(lm) == 1:
                nxt[lm[0]] += c
                continue
            tot = sum(eff[l] * weight[l] for l in lm) or 1.0
            for l in lm:
                nxt[l] += c * eff[l] * weight[l] / tot
        eff = nxt
    lemma_freq = {lid: int(round(v)) for lid, v in eff.items()}
    top_word = {}                        # ambiguous form -> headword of the most frequent lemma
    for form, lm in form_map.items():
        words = {lemma_word[l] for l in lm}
        if len(words) > 1:
            best = max(lm, key=lambda l: (eff.get(l, 0.0) * weight[l], lemma_word[l] == form, -l))
            top_word[form] = lemma_word[best]
    unamb = defaultdict(set)             # lemma id -> its forms that no lemma with another headword has
    for lid, fl in lemma_forms.items():
        unamb[lid] = {f for f in fl if f not in top_word}
    tok_cache = {}

    def allowed(lid, form, si):
        """A sentence matched through an ambiguous form only goes to the most frequent lemma,
        unless the sentence also contains an unambiguous form of this lemma."""
        if top_word.get(form, lemma_word[lid]) == lemma_word[lid]:
            return True
        toks = tok_cache.get(si)
        if toks is None:
            toks = tok_cache[si] = set(tokenize(pairs[si][0]))
        return bool(toks & unamb[lid])

    MIN_TOP, MAX_SHARE = 6, 0.4
    cap = max(1, int(MAX_EX * MAX_SHARE))
    chosen = {}
    for lid, fl in lemma_forms.items():
        fl.sort(key=lambda f: (-freq[f], f))
        ptr = dict.fromkeys(fl, 0)
        quota = dict.fromkeys(fl, 0)
        used, picked = set(), []

        def take(f):
            p, i = pool[f], ptr[f]
            while i < len(p) and (p[i] in used or not allowed(lid, f, p[i])):
                i += 1
            ptr[f] = i
            if i >= len(p):
                return False
            used.add(p[i]); picked.append((p[i], f)); ptr[f] = i + 1; quota[f] += 1
            return True
        for f in fl[:MIN_TOP]:
            if len(picked) < MAX_EX:
                take(f)
        while len(picked) < MAX_EX:
            for f in sorted((f for f in fl if quota[f] < cap), key=lambda f: (-freq[f] / (quota[f] + 1), f)):
                if take(f):
                    break
            else:
                break
        chosen[lid] = picked
    log(f"selected examples for {len(chosen)} lemmas")

    # ---- assemble (every lemma in entries has glosses; keep only those)
    keep_words = load_keep()
    if keep_words:
        log(f"keep_lemmas.txt: {len(keep_words)} lemmas kept even without examples")
    lemmas, kept = [], set()
    for k in keys:
        ent = entries[k]
        if ent["glosses"] and (lemma_id[k] in chosen or not PRUNE_NO_EXAMPLES or k[0] in keep_words):
            lid = lemma_id[k]
            lemmas.append({"id": lid, "lemma": k[0], "pos": k[1], "glosses": ent["glosses"],
                           "freq": lemma_freq.get(lid, 0)})
            kept.add(lid)
    forms = []
    dropped_rare = 0
    for form in sorted(form_map):
        for lid in sorted(form_map[form]):
            if lid not in kept:
                continue
            sets = [frozenset(t.split()) for t in form_map[form][lid] if t]
            drop, tags = best_tags(sets)
            if drop:           # only obsolete/archaic/regional/etc.
                dropped_rare += 1
                continue
            forms.append({"form": form, "lemmaId": lid, "tags": tags})
    log(f"dropped {dropped_rare} rare/archaic forms")
    examples, eid = [], 0
    for lid in sorted(chosen):
        if lid not in kept:
            continue
        for si, f in chosen[lid]:
            eid += 1
            it, en = pairs[si]
            examples.append({"id": eid, "lemmaId": lid, "form": f, "it": it, "en": en})

    digest = hashlib.sha256(json.dumps([lemmas, forms, examples], ensure_ascii=False,
                                       separators=(",", ":")).encode()).hexdigest()[:8]
    bundle = {"version": f"{date.today().isoformat()}-{digest}",
              "lemmas": lemmas, "forms": forms, "examples": examples}
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, "bundle.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(bundle, f, ensure_ascii=False, separators=(",", ":"))
    split_bundle(bundle)
    with open(path, "rb") as f, gzip.open(path + ".gz", "wb", compresslevel=9) as g:
        while c := f.read(1 << 20):
            g.write(c)
    log(f"lemmas={len(lemmas)} forms={len(forms)} examples={len(examples)} "
        f"lemmas_with_examples={len({e['lemmaId'] for e in examples})}")
    log(f"bundle.json {os.path.getsize(path) / 1e6:.1f} MB, gzip "
        f"{os.path.getsize(path + '.gz') / 1e6:.1f} MB, version {bundle['version']}")
    log(f"total build time {time.time() - t0:.0f}s")


def split_bundle(bundle):
    """core.json (lemmas + forms: enough to search and look words up) and examples.json (sentences, ~60% of the bytes).
    The app loads core first so it is usable sooner and fetches the examples in the background. Same `version` in both."""
    for name, keys in (("core.json", ("lemmas", "forms")), ("examples.json", ("examples",))):
        part = {"version": bundle["version"], **{k: bundle[k] for k in keys}}
        with open(os.path.join(OUT, name), "w", encoding="utf-8") as f:
            json.dump(part, f, ensure_ascii=False, separators=(",", ":"))
        log(f"{name} {os.path.getsize(os.path.join(OUT, name)) / 1e6:.1f} MB")


if __name__ == "__main__":
    step = sys.argv[1] if len(sys.argv) > 1 else "all"
    if step in ("download", "all"):
        download()
    if step in ("build", "all"):
        build()
    if step == "split":  # re-split an existing out/bundle.json without rebuilding
        with open(os.path.join(OUT, "bundle.json"), encoding="utf-8") as f:
            split_bundle(json.load(f))

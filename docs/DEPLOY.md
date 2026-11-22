# Deploying to GitHub Pages

The app is published at `https://rezache4.github.io/langtutor/` by `.github/workflows/deploy-pages.yml` on every push to `master`
that touches `app/`. The dictionary (`core.json` ~15 MB + `examples.json` ~19 MB) is not in git: the workflow downloads both from a release.

## One-time setup (owner)
1. **Secrets** (repo Settings > Secrets and variables > Actions): `SUPABASE_URL` and `SUPABASE_KEY` (the publishable key). Both
   the keep-alive workflow and the deploy build use them (the build bakes them in as `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`).
2. **Pages**: Settings > Pages > Source = "GitHub Actions".
3. **Dictionary release**: build the bundle (`pipeline/`), then
   `gh release create data-latest pipeline/out/core.json pipeline/out/examples.json --title "Dictionary" --notes "CC BY-SA 4.0, see README"`.
   To update it later: `gh release upload data-latest pipeline/out/core.json pipeline/out/examples.json --clobber`, then re-run the workflow.
   (`bundle.json`, the old single file, is no longer used; delete that asset with `gh release delete-asset data-latest bundle.json`.)
   Note: an optional local `keep_lemmas.txt` forces extra lemmas into the bundle; they appear as ordinary dictionary entries.
4. **Supabase** (Authentication > URL Configuration): Site URL `https://rezache4.github.io/langtutor/`; add the same URL to Redirect URLs
   (keep the localhost entries for development).
5. **Google OAuth consent screen**: homepage `https://rezache4.github.io/langtutor/`, privacy policy
   `https://rezache4.github.io/langtutor/privacy.html`, then publish the app (no more test-user allow-list).

## Notes
- Vite `base` is `/langtutor/` in CI (`VITE_BASE`); locally it is `/`. The router basename, PWA scope/start_url and the OAuth redirect follow it.
- Pages has no SPA rewrites, so the workflow copies `index.html` to `404.html` (deep links like `/langtutor/word/casa` then load the app).
- Cloudflare Pages is not an option for the bundle (25 MB file limit).

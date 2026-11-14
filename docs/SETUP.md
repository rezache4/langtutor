# LangTutor sync setup (one time, owner only)

Project ref: `wsxmpqmwglkxzjhgglvd` (https://wsxmpqmwglkxzjhgglvd.supabase.co). The app already has the URL and publishable key in `app/.env`.

## 1. Create the database objects
1. Supabase dashboard > project > **SQL Editor** > **New query**.
2. Paste the whole of `supabase/migrations/0001_init.sql` > **Run**. Expect "Success. No rows returned".
3. Check: **Table Editor** shows `user_docs` with RLS enabled.

## 2. Google OAuth client
1. https://console.cloud.google.com > create/select a project.
2. **APIs & Services > OAuth consent screen** (or "Google Auth Platform > Branding"): User type **External**, app name `LangTutor`, your email as support and developer contact > Save. Scopes: keep the defaults (email, profile, openid).
3. **Audience / Publishing status > Publish app** (move to **In production**). Required so friends need not be added as test users. No verification is needed for these basic scopes.
4. **APIs & Services > Credentials > Create credentials > OAuth client ID**: type **Web application**, name `LangTutor`.
   - Authorized JavaScript origins: leave empty (or add your app URLs).
   - Authorized redirect URIs: `https://wsxmpqmwglkxzjhgglvd.supabase.co/auth/v1/callback`
5. **Create**, copy the **Client ID** and **Client secret**.

## 3. Enable Google in Supabase
**Authentication > Sign In / Providers > Google**: toggle on, paste Client ID and Client secret > **Save**.

## 4. URL configuration
**Authentication > URL Configuration**:
- **Site URL**: the hosted app URL once you have it (until then `http://localhost:4173`).
- **Redirect URLs** (add each): `http://localhost:4173`, `http://localhost:5173`, and your hosted URL (e.g. `https://yourname.github.io/langtutor`, no trailing slash; add `/**` variants if you use sub-paths).

## 5. Keep the free project awake (7-day pause)
GitHub repo > **Settings > Secrets and variables > Actions > New repository secret**:
- `SUPABASE_URL` = `https://wsxmpqmwglkxzjhgglvd.supabase.co`
- `SUPABASE_KEY` = the publishable key from `app/.env`

The workflow `.github/workflows/supabase-keepalive.yml` pings the REST API daily; run it once from the **Actions** tab (workflow_dispatch) to confirm it is green. The repo must be on GitHub with Actions enabled (GitHub also disables scheduled workflows after 60 days without repo activity: re-enable in the Actions tab if that happens).

## 6. Test
`cd app && npm run build && npm run preview` > open http://localhost:4173 > Settings > **Sign in with Google**. After redirect the Account card shows your email and "Last sync: just now". Open the app on a second device/browser, sign in with the same account, and your cards appear. Check **Table Editor > user_docs** for rows. `npm test` runs the offline sync tests.

Notes: sync is last-write-wins per record; deleting data is a soft delete that syncs. Signing out keeps local data. Each friend just signs in with their own Google account (data is isolated by row-level security).

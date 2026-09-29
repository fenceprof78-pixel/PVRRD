# PVRRD — Deploy with Supabase (database) + Render (web app)

The app is standard Flask + PostgreSQL, so switching to Supabase only needs a new
`DATABASE_URL`. The code now adds `sslmode=require` automatically for remote databases.

## 1. Create the Supabase project
1. supabase.com → **New project** → pick the region closest to you (e.g. Singapore) → set a **database password** (save it!).
2. Wait ~2 minutes for it to provision.

## 2. Load the schema
1. Supabase → **SQL Editor** → **New query**.
2. Paste the full contents of `schema.sql` → **Run**.
3. Check **Table Editor**: you should see `patients`, `vitals` with the sample data.

> Run the seed inserts only once — re-running duplicates the sample rows.

## 3. Get the connection string
Supabase → **Connect** (top of the dashboard) → **Session pooler** → copy the URI:

```
postgresql://postgres.<project-ref>:[YOUR-PASSWORD]@aws-0-<region>.pooler.supabase.com:5432/postgres
```

Use the **pooler** string, not "Direct connection": the direct host is IPv6-only and
Render's free web services connect over IPv4, so it fails with "Network is unreachable".
Replace `[YOUR-PASSWORD]` with your password (URL-encode special characters, e.g. `@` → `%40`).

## 4. Deploy the web app on Render
1. Push this folder to GitHub.
2. Render → **New +** → **Web Service** (or **Blueprint**, which reads `render.yaml`) → pick the repo.
3. Build: `pip install -r requirements.txt` · Start: `gunicorn app:app` · Plan: Free.
4. **Environment** → add `DATABASE_URL` = the Session pooler string from step 3.
5. Deploy. Open `/api/health` on your live URL — it should return `"database": "connected"`.

If you already have a Render web service for this project, just change its `DATABASE_URL` and
redeploy. Then delete the old Render database.

## Local testing
```
cp .env.example .env    # then edit DATABASE_URL
pip install -r requirements.txt
python app.py
```

## Notes
- **Free tier:** Render web services sleep after ~15 min idle (first load takes ~30–50s). Supabase free projects pause after about a week of inactivity; unpause from the dashboard.
- **Migrating existing data?** Export from Render with `pg_dump --data-only --inserts "<old DATABASE_URL>" > data.sql`, then run it in the Supabase SQL Editor (after the schema, without the seed inserts).
- **Other hosts** (Railway, Fly, a VPS): same idea, set `DATABASE_URL` and run `gunicorn app:app`.

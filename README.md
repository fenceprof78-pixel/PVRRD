# PVRRD — Deploy on Vercel (Flask) + Supabase (database)

## 1. Create the Supabase project
1. supabase.com → **New project** → choose the region nearest you (e.g. Singapore) → set a **database password** and save it.
2. Wait ~2 minutes for it to provision.

## 2. Load the schema
1. Supabase → **SQL Editor** → **New query** → paste all of `schema.sql` → **Run**.
2. In **Table Editor** you should see `patients`, `vitals` with the sample data.

> Run it once only: the seed inserts duplicate rows if repeated.

## 3. Get the connection string
Supabase → **Connect** → **Transaction pooler** (port **6543**) → copy the URI:

```
postgresql://postgres.<project-ref>:[YOUR-PASSWORD]@aws-0-<region>.pooler.supabase.com:6543/postgres
```

Use the **pooler** string, not "Direct connection". Vercel functions are short-lived and
can spin up many at once; the transaction pooler shares a few real connections between them,
while direct connections can run out. Replace `[YOUR-PASSWORD]` (URL-encode special characters, e.g. `@` → `%40`).

## 4. Deploy on Vercel
1. Push this folder to GitHub (its own repo, with `app.py` at the root).
2. vercel.com → **Add New… → Project** → import the repo. Vercel detects Flask automatically (no `vercel.json` needed).
3. Before deploying, open **Environment Variables** and add `DATABASE_URL` = the string from step 3.
4. **Deploy**, then open `https://<your-app>.vercel.app/api/health`. It should return `"database": "connected"`.

If you change `DATABASE_URL` later, **redeploy**. Environment variable changes only apply to new deployments.

## How this differs from the Render version
- `static/` moved to `public/static/`. Vercel serves everything in `public/` from its CDN, not from Flask. URLs are unchanged (`/static/...`).
- `Procfile` and `render.yaml` removed. Vercel runs the Flask `app` object directly, so `gunicorn` isn't needed.
- The database pool is small and created lazily, as serverless functions need.

## Local testing
```
cp .env.example .env    # then edit DATABASE_URL
pip install -r requirements.txt
python app.py           # http://localhost:5000
```

## Notes
- Supabase free projects pause after about a week of inactivity; unpause from the dashboard.
- Vercel's free Hobby plan is for personal, non-commercial use. Client projects need Pro.
- The first request after idle can be a bit slower (cold start).
- **Migrating data from Render?** `pg_dump --data-only --inserts "<old DATABASE_URL>" > data.sql`, then run it in the Supabase SQL Editor after the schema (without the seed inserts).

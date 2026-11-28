# Deploying SealedPaper (Supabase + Render + Vercel)

About 30 minutes, all on free plans, no credit card needed.

```
Browser ──HTTPS──▶ Vercel (Next.js website) ──/api/*──▶ Render (Express API + worker) ──SSL──▶ Supabase (PostgreSQL)
```

| Part | Service | Why this one |
| --- | --- | --- |
| Database | **Supabase** | Real PostgreSQL, so all 30 tables, 23 triggers, functions, views and roles run unchanged |
| API + release worker | **Render** | Runs a normal Node.js server with enough memory for the face models |
| Website | **Vercel** | Built by the makers of Next.js; free HTTPS, which the camera needs |

Before you start, have the code pushed to GitHub and Node.js 22 installed on your laptop.

---

## Step 1. Make the two secrets (2 minutes)

On your laptop, in the project folder:

```bash
cd server
npm install
npm run keygen
```

It prints two lines, `MASTER_KEY=…` and `JWT_SECRET=…`. Save both in a password manager or a private note.

> **Keep `MASTER_KEY` safe and never change it after you start using the site.** Every encrypted file, key share and face template depends on it. Lose it and nothing can be decrypted, ever. Never put it in git.

## Step 2. Create the Supabase database (5 minutes)

1. Go to <https://supabase.com>, sign in with GitHub, click **New project**.
2. Name: `sealedpaper`. **Database password:** click *Generate*, then copy and save it. **Region:** *Southeast Asia (Singapore)*, the same region you'll pick on Render.
3. Wait about a minute for the project to start.
4. Click **Connect** (top of the project page). Under **Session pooler**, copy the connection string. It looks like:

   ```
   postgresql://postgres.abcdefghijkl:[YOUR-PASSWORD]@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres
   ```

5. Replace `[YOUR-PASSWORD]` with your database password. If the password contains `@ # / ? %` or spaces, either generate a new one with only letters and numbers (Project Settings → Database → Reset password), or URL-encode those characters.

**Use the *Session pooler*, port 5432.** Not *Direct connection* (it is IPv6-only and Render cannot reach it), and not *Transaction pooler* (port 6543, it breaks the transactions and locks the release logic depends on).

You do **not** need to run any SQL in Supabase. Render creates all the tables on its first build.

Optional but recommended: Project Settings → **Data API** → turn it off. SealedPaper never uses it. Migration `007` already blocks Supabase's public `anon` and `authenticated` roles from every table, so this is a second lock on the same door.

## Step 3. Deploy the API on Render (10 minutes)

1. Go to <https://render.com>, sign in with GitHub.
2. **New → Blueprint**, pick your `SealedPaper` repository. Render reads `render.yaml`.
3. It asks for three values:

   | Key | Value |
   | --- | --- |
   | `DATABASE_URL` | the Supabase Session pooler string from step 2, with your password in it |
   | `MASTER_KEY` | from step 1 |
   | `JWT_SECRET` | from step 1 |

4. Click **Apply**. The build installs packages, then runs the migrations. In the build log you should see `applied 001_schema.sql` … `applied 007_hosted_postgres_hardening.sql` and `database is up to date`.
5. When the service shows **Live**, copy its URL, such as `https://sealedpaper-api.onrender.com`. Open `https://sealedpaper-api.onrender.com/api/health` in a browser. You should see `{"ok":true,"faceMode":"real"}`.

## Step 4. Deploy the website on Vercel (5 minutes)

1. Go to <https://vercel.com>, sign in with GitHub, **Add New → Project**, import `SealedPaper`.
2. **Root Directory:** click *Edit* and choose `web`. Framework: Next.js (detected).
3. **Environment Variables:** add `API_URL` = your Render URL from step 3, with no trailing slash, e.g. `https://sealedpaper-api.onrender.com`.
4. Click **Deploy**. You get a URL such as `https://sealedpaper.vercel.app`.

`API_URL` is read when the site is **built**. If you change it later, go to Deployments → ⋯ → **Redeploy**.

## Step 5. Create your controller account straight away (2 minutes)

**The first account registered on a fresh database becomes the controller (admin).** Do this yourself immediately after deploying, before you share the link with anyone.

1. Open your Vercel URL → **Create an account**.
2. Allow the camera, do the face scan (straight, left, right), and scan the QR code with Google Authenticator or Microsoft Authenticator.
3. You land on the controller dashboard. Other people who register after you start as key custodians, and you change their roles on **People**.

## Step 6. Check the live site (1 minute)

```bash
cd server
npm run check:deploy -- https://sealedpaper.vercel.app
```

Every line should say `PASS`. The first run can take up to a minute if the API was asleep.

## Step 7. Keep it awake (2 minutes, recommended)

Render's free plan sleeps after 15 idle minutes. While asleep, a document can't release exactly at its unlock time, and the first visitor waits about a minute. Supabase also pauses a free project after a week with no activity.

The repo includes `.github/workflows/keep-awake.yml`, which pings the API every 10 minutes. To turn it on:

GitHub repo → **Settings → Secrets and variables → Actions → Variables → New repository variable**
- Name: `API_HEALTH_URL`
- Value: `https://sealedpaper-api.onrender.com/api/health`

Then **Actions → Keep awake → Run workflow** once to test it.

Before a demo or viva, open the site about 2 minutes early anyway.

---

## If something fails

| What you see | Cause | Fix |
| --- | --- | --- |
| Render build: `Could not connect to the database: getaddrinfo ENOTFOUND db.xxxx.supabase.co` or `ENETUNREACH` | You used the *Direct connection* string | Use the **Session pooler** string (host ends in `pooler.supabase.com`, port 5432) |
| `password authentication failed` | Wrong password, or `[YOUR-PASSWORD]` left in the URL | Put the real password in; reset it in Supabase if unsure |
| `Tenant or user not found` | The username is missing the project ref | The user must be `postgres.<project-ref>`, exactly as Supabase shows it |
| `prepared statement … already exists` or random transaction errors | Transaction pooler (port 6543) | Switch to the Session pooler, port 5432 |
| `Missing environment variable MASTER_KEY` | Env var not set on Render | Render → service → Environment → add it → Save (redeploys) |
| Website says "The server is starting up…" for more than 2 minutes | Wrong `API_URL` on Vercel, or the API crashed | Open `<API_URL>/api/health`; fix `API_URL` and **Redeploy** |
| Camera doesn't start | Site not on HTTPS, or permission blocked | Use the `https://…vercel.app` URL; click the lock icon → allow camera |
| Login works, then you are logged out immediately | `TRUST_PROXY` or `NODE_ENV` changed | Keep `NODE_ENV=production` and `TRUST_PROXY=2` from `render.yaml` |
| Supabase project shows **Paused** | No activity for 7 days | Click **Restore** in Supabase, then turn on step 7 |

Render → your service → **Logs** shows every server error with its message.

## Running it locally instead

```bash
docker compose up -d                     # PostgreSQL 16 on localhost:5432
cd server && cp .env.example .env        # paste the two keys from npm run keygen
npm install && npm run migrate && npm run dev
cd ../web && npm install && npm run dev  # http://localhost:3000
```

# Supabase: invites + host setup

## Invite-only members (no public sign-up)

1. In Supabase Dashboard go to **Authentication → Users**.
2. Click **Invite user** and enter the member’s email. They receive a link to set a password or magic-link (depends on your Auth email templates).
3. Disable **Sign ups** for anonymous users if you want stricter control: **Authentication → Providers → Email** — turn off “Allow new users to sign up” *only if* you understand all users must be created via **Invite** or the Admin API.

Alternatively keep email sign-up off by using **Invite only** workflow: every member record is created from **Invite user**.

## Member sign-in on the site

- Members enter the email that was invited, click **Send sign-in link**, complete **magic link** from email (OTP must be enabled: Authentication → Email → **Confirm email** / magic link settings).
- If your project uses **invited** accounts with passwords, use **Password** sign-in after we add that UI; Phase 1 ships **Magic link (OTP)** via `signInWithOtp`.

## Static site build (Netlify)

Set these in **Site settings → Environment variables** (used when `npm run build` runs):

- `TMDB_API_KEY` — The Movie Database API key (film search).
- `SUPABASE_URL` — Project URL (**Settings → API**).
- `SUPABASE_ANON_KEY` — `anon` `public` key (safe in the browser; injected into `dist/app.js`).

## Host: create a screening room

Use the **host panel** in the app (5 taps on logo) with:

- **Netlify env:** `CLUB_HOST_PIN` — shared secret you choose; the create-room function checks it.
- **Netlify env:** `SUPABASE_SERVICE_ROLE_KEY` — from Supabase **Project Settings → API → service_role** (never commit; only Netlify server).

The app calls `POST /.netlify/functions/create-room` with your pin and event fields. Response includes `join_code` and `host_secret` — **save `host_secret` only on the host device** (browser localStorage); it is required to list the pool and draw.

### In-app invites (host panel)

On the live site, **5 taps → host → “the list (invite-only)”**: paste one or more emails and **Send invites**. That calls `POST /.netlify/functions/invite-members` with the same **`CLUB_HOST_PIN`** and your Supabase **service role** (server-side only).

- **Speakeasy / brand email**: Supabase does **not** send arbitrary HTML from this app. The message is whatever you configure under **Authentication → Emails → Templates → Invite user** — edit subject and body there for the “cool doorway” copy.
- **Where they land after the invite link**: The host panel fills **“after invite — send them here”** with your site URL and `?code=JOINCODE` when a screening exists. Add your URLs under **Authentication → URL Configuration → Redirect URLs** (e.g. production origin and `https://your-domain.com/**` so query strings are allowed).
- After they finish the invite flow, they still use **Send sign-in link** on your entry screen (magic link) unless you add password sign-in later.
- Optional metadata (`join_code`, `room_name`) is attached on invite for possible use in custom templates; see current Supabase docs for which template variables expose `user_metadata` / `data`.

## Database

Run [`phase1.sql`](phase1.sql) in the Supabase **SQL Editor** once per project (or after backing up).

## QA checklist

- Two invited users, two browsers: each submits a blind pick; neither sees the other’s film in the app.
- Host enters `host_secret`, sees both rows, runs draw after `submissions_close_at`.
- Copy **paper slip** and **reveal** lines from host panel.

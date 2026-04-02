# Supabase: invites + host setup

## Invite-only members (no public sign-up)

1. In Supabase Dashboard go to **Authentication → Users**.
2. Click **Invite user** and enter the member’s email. They receive a link to set a password or magic-link (depends on your Auth email templates).
3. Disable **Sign ups** for anonymous users if you want stricter control: **Authentication → Providers → Email** — turn off “Allow new users to sign up” *only if* you understand all users must be created via **Invite** or the Admin API.

Alternatively keep email sign-up off by using **Invite only** workflow: every member record is created from **Invite user**.

## Member sign-in on the site

- On the entry screen: **step 1** — sign in with the **same email** the host invited (**Send sign-in link** for magic link, or **sign in with password** if that user has a password in Auth).
- **Step 2** — enter the join code and tap **Enter**. The code alone does not open the room without a session.
- Magic link / OTP: Authentication → Email — **Confirm email** / magic link settings must match how you invite users.
- If the page shows only **offline demo** wording and **no** sign-in block, the deployed build is missing `SUPABASE_URL` and `SUPABASE_ANON_KEY` at build time — members should use the real hosted URL the host shared.

## First deploy checklist (operator)

1. Run [`phase1.sql`](phase1.sql) in the Supabase SQL Editor for the project.
2. **Netlify → Environment variables** (for production):
   - **Build**: `TMDB_API_KEY`, `SUPABASE_URL`, `SUPABASE_ANON_KEY` (so `dist/app.js` gets a Supabase client and film search works).
   - **Functions**: `CLUB_HOST_PIN` (your choice), `SUPABASE_SERVICE_ROLE_KEY` (service role from Supabase API settings — never expose to the browser).
3. **Supabase → Authentication → URL Configuration**: set **Site URL** to your production site origin (e.g. `https://your-film-site.netlify.app`). Under **Redirect URLs**, add that origin and patterns that cover invite/magic-link returns (e.g. `https://your-film-site.netlify.app` and `https://your-film-site.netlify.app/**`).
4. Trigger a deploy; open the live site — you should see **member sign-in** on the home screen, not only the offline-demo notice.
5. **Host**: tap the logo **five times** → create a screening → confirm the in-app **first screening checklist** (host key, redirects, invites).

## First member checklist

1. Host invites the address (Supabase **Invite user**, or **the list (invite-only)** in the app with the same `CLUB_HOST_PIN` + service role on Netlify).
2. Member opens the link the host sent (ideally includes `?code=JOINCODE` in the URL).
3. **Sign in first** (magic link or password), **then** enter the join code and **Enter**.
4. If **“not connected to your club’s server”** appears with a code in the URL, the site build is wrong or they opened a non-production URL — host should confirm the live deployment has Supabase env vars.
5. If sign-in errors persist, host checks the email matches the invite, **Redirect URLs**, and (for bursts) email rate limits / SMTP.

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

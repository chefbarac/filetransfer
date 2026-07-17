# Printshop Receive

A small self-hosted "receive files from customers" tool for a print/photocopy shop.
Frontend is static (GitHub Pages). Backend is Supabase's free tier (Postgres + Storage).
No file ever touches a server you have to run or pay for.

## What it does

- **You** open `index.html`, log in with your dashboard password, click **Receive
  files**, and get a link scoped to just that one order. The link expires 24 hours
  after you generate it.
- **Your customer** opens the link, drops in files, watches a progress bar. They can
  reopen the same link later (within 24h) to see the status; after that, uploads stop
  but the status is still viewable.
- **You** mark each order Received → Printing → Ready for pickup. The customer's
  page reflects this automatically (it checks every few seconds).
- Each received file has a **Print** button that opens it full-page, stretched to
  fill whatever paper size you pick (Short/Letter, Long/Legal, A4, A3), and triggers
  the browser's print dialog.
- A **Save files to PC** button lets you pick a folder on your computer and it saves
  all of that order's files into a subfolder named after the order.
- **Multiple dashboard passwords**: this tool supports more than one business. Each
  business gets its own password and only ever sees its own orders — so you can let
  other print shops use the same deployment (a small B2B setup) without seeing each
  other's customers.

## 1. Create a free Supabase project

1. Go to [supabase.com](https://supabase.com) → New project (free tier is enough).
2. Once it's ready, open the **SQL Editor** and paste in the full contents of
   `schema.sql` from this project, run it.
3. Before running, edit the line near the bottom of the setup section:
   ```sql
   insert into businesses (name, password_hash)
   values ('Your Print Shop', crypt('change-me', gen_salt('bf')));
   ```
   Replace `'Your Print Shop'` with your shop's name and `'change-me'` with your
   real dashboard password.

   **To onboard a second business later (B2B)**, just run another insert with a
   different name and password:
   ```sql
   insert into businesses (name, password_hash)
   values ('Some Other Print Shop', crypt('their-password', gen_salt('bf')));
   ```
   That business logs into the same `index.html` with their own password and only
   ever sees orders they created.

## 2. Create the storage bucket

1. In Supabase, go to **Storage** → **New bucket**.
2. Name it exactly `uploads`. Leave **Public bucket** turned **off**.
3. Open the bucket's **Policies** tab and add two policies (Storage → Policies →
   New policy → "For full customization"):

   **Upload policy**
   - Allowed operation: `INSERT`
   - Target roles: `anon`
   - USING/WITH CHECK expression: `bucket_id = 'uploads'`

   **Read policy**
   - Allowed operation: `SELECT`
   - Target roles: `anon`
   - USING expression: `bucket_id = 'uploads'`

   This means anyone with a file's exact storage path (which includes the
   unguessable order ID) can read it, and anyone can upload — but nobody can
   browse or list the bucket's contents.

## 3. Fill in your config

Open `js/config.js` and set:

```js
window.SUPABASE_URL = "https://xxxxxxxxxxxx.supabase.co";   // Settings → API
window.SUPABASE_ANON_KEY = "eyJ...";                          // Settings → API → anon public key
window.SHOP_NAME = "Printshop Receive";                       // shown before login / as fallback
```

The anon key is meant to be public — it has no direct table access at all.
Every read/write goes through the Postgres functions in `schema.sql`, which
check the dashboard password (and which business it belongs to) before doing
anything.

## 4. Deploy to GitHub Pages

1. Push this whole folder to a GitHub repo.
2. Repo → **Settings** → **Pages** → Source: deploy from branch → pick `main` and `/ (root)`.
3. Your dashboard will be at `https://<you>.github.io/<repo>/index.html` and the
   customer page at `.../send.html`.

## Notes and limitations

- **Link expiry**: each receive link stops accepting new files 24 hours after you
  generate it. The order and any files already sent stay visible on your dashboard —
  only new uploads on that link are blocked.
- **"Save files to PC"** uses the File System Access API, which currently only
  works in Chromium browsers (Chrome, Edge, Opera) — not Firefox or Safari. You
  can still print files individually on any browser.
- **You don't need to be online at the same time as your customer** — unlike pure
  peer-to-peer, they can upload anytime within the 24-hour window; you check the
  dashboard whenever you're back at your PC.
- **Free tier limits**: Supabase's free tier includes 1GB of file storage and a
  database that pauses after a week of no activity (it wakes back up automatically
  on the next request, just a few seconds slower). Fine for a single shop's volume;
  worth watching if several businesses share one project and send a lot of large files.
- **Security**: this is a lightweight setup appropriate for "keep casual senders
  out," not bank-grade security — anyone who correctly guesses or is given an
  order link can view that one order. Order IDs are random UUIDs, not sequential,
  so guessing one isn't practical. Each business's orders are only reachable through
  their own dashboard password, enforced in the database functions, not just the UI.
- To change a business's own dashboard password, use the **Change password** button
  in the dashboard header.

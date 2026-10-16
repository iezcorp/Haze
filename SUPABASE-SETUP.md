# Shop backend setup (free, ~10 minutes)

Right now the Shop works in **offline mode**: likes, uploads and reports are
kept in each browser separately. Follow these steps once and everything
(login, likes, uploads, reports, Mist wallets, avatar decorations, and
automatic per-account game data sync) becomes
a real shared backend — still
**100% free** (Supabase free tier: 500 MB database + 1 GB file storage, more
than enough for a wallpaper store).

## Step 1 — Create a free Supabase account

1. Go to https://supabase.com and click **Start your project** (sign up with
   GitHub or email — no credit card needed).
2. Click **New project**, give it any name (e.g. `wallpaper-store`), set a
   database password (save it somewhere), pick the region closest to you,
   and click **Create new project**. Wait ~1 minute while it starts.

## Step 2 — Create the tables (copy-paste, 1 minute)

1. In your project dashboard, open **SQL Editor** (left sidebar, `</>` icon).
2. Click **New query**.
3. Open the file `supabase-setup.sql` from this folder, copy **everything**,
   paste it into the query box, and click **Run**. The script can be rerun
   after updates; existing cloud installs should rerun it to add Mist wallets,
   queued gifts, protected Shop functions, and the private game-data sync table.
4. You should see `Success. No rows returned`. That's it — tables, security
   rules and the file bucket are all created.

## Step 3 — Let people sign up without email confirmation (recommended)

1. Go to **Authentication → Sign In / Up** (left sidebar).
2. Open the **Email** provider settings and turn **OFF** "Confirm email".
   (Otherwise new users must click an email link before they can log in.)

## Step 4 — Copy your two keys into the site

1. Go to **Project Settings** (gear icon, bottom left) → **API**.
2. Copy **Project URL** (looks like `https://xyzcompany.supabase.co`).
3. Copy the **anon public** key (long string starting with `eyJ...`).
   This key is safe to put in the site — the security rules from Step 2
   decide what it is allowed to do.
4. Open `script.js` in this folder and find these lines near the Shop code:
   ```js
   const SUPABASE_CONFIG = { url: "", anonKey: "" };
   ```
   Paste your values in:
   ```js
   const SUPABASE_CONFIG = { url: "https://xyzcompany.supabase.co", anonKey: "eyJ..." };
   ```
5. Reload the page. The Shop sidebar now says **☁️ Cloud connected**.

## Step 5 — Become admin

Just **sign up on your site with `iez123@proton.me`** (or any email whose
username is `iez123`). Open the Shop and you'll see the **🛡️ Admin** section, with:

- **Pending review** — approve or reject community uploads
- **Reports** — see who reported what and why, dismiss them or remove the wallpaper
- **Gifts** — queue Mist or Blossom for any registered member; rewards and
  sender notifications are delivered the next time that member signs in

Members can spend Mist on avatar decorations in the Shop. Cloud mode enforces
admin gifts and decoration prices through database functions. Local mode stores
wallets and queued gifts in that browser's account data.

## Drift private messaging

Drift requires the Supabase cloud account mode; browser-local demo accounts
cannot message other devices or users. For an existing project, rerun the
updated `supabase-setup.sql` to add Drift tags, cloud avatars, friend requests, private
message storage, and row-level access policies. Users pick a base name and
automatically receive the next free tag (`iez#0001`, `iez#0002`, …) — the full
tag is unique, so nobody else can claim `iez#0001` until that account is
deleted. Send requests by full tag. Only accepted friends can
read or send messages in that conversation. Use the site over HTTPS. Messages
are protected by account authorization and database policies; they are not
end-to-end encrypted, so the Supabase project owner can access the database.

## How the safety system works

1. **Automatic scan** — every uploaded image is checked in the browser with a
   free AI model (nsfwjs) before it leaves the device. Blatant pornography is
   blocked instantly with a message.
2. **Human review** — everything else from non-admins lands in the admin
   **Pending review** queue and is invisible to others until approved. Videos
   always go through review (they can't be auto-scanned).
3. **Community reports** — any wallpaper has a ⚑ button; reports pile up in
   the Admin section with reasons.
4. **Admin removal** — admins can delete any wallpaper instantly, from its
   card or from the queue.

## Going back to offline mode

Delete the two keys from `SUPABASE_CONFIG` (leave them as `""`) and reload.
The site keeps working exactly as before with browser-local storage.

## Troubleshooting

- **"Could not create the account"** → you skipped Step 3, or typed the
  keys with a typo/extra space.
- **"Admin section missing"** → you must be logged in as `iez123@proton.me`
  (or username `iez123`), and the page reloaded after pasting the keys.
- **"Upload failed" in offline mode** → the browser's 5 MB storage is full.
  Connect the cloud (above) for unlimited uploads.
- **Scanner says "unavailable"** → you're offline or a blocker stopped the
  free model download. Uploads then go straight to admin review, so nothing
  unsafe slips through.

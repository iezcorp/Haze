# Google Calendar Setup for Haze

Haze talks to Google Calendar directly from your browser using Google's
official OAuth 2.0 flow. There are **no secrets in the code** — but Google
requires you to register the app once and paste in its public **Client ID**.
This takes about 5 minutes and is free.

## What you need to supply

1. A **Google Cloud OAuth client ID** (public identifier, safe to keep in
   your browser — it is **not** a secret).
2. The **origin** you serve Haze from (e.g. `http://localhost:8000`)
   registered as an authorized JavaScript origin.

No client secret, no backend, and no service-account keys are needed.
Your Google account password is never asked for and never stored — sign-in
happens on google.com, and only an access token (kept in this browser's
local storage) is retained.

## Steps

1. Go to [Google Cloud Console](https://console.cloud.google.com/) and
   sign in.
2. Create a project (any name, e.g. `haze-desktop`).
3. Open **APIs & Services → Library**, search **Google Calendar API**,
   and click **Enable**.
4. Open **APIs & Services → OAuth consent screen**:
   - User type: **External**.
   - Fill in app name (`Haze`), your support email, and developer contact.
   - Scopes: add `.../auth/calendar.readonly` and `.../auth/userinfo.email`.
   - Under **Test users**, add your own Gmail address (required while the
     app is in testing mode).
   - Save.
5. Open **APIs & Services → Credentials → Create Credentials →
   OAuth client ID**:
   - Application type: **Web application**.
   - Under **Authorized JavaScript origins**, add the exact origin you
     open Haze from, for example:
     - `http://localhost:8000` (if you serve it with
       `python -m http.server 8000` from the project folder)
     - plus your hosted `https://…` origin if you deploy it.
   - No redirect URI is needed (Haze uses a popup token flow).
   - Create, then copy the **Client ID**
     (`…​.apps.googleusercontent.com`).
6. Haze already uses the built-in Client ID
   (`767881698813-…​.apps.googleusercontent.com`), so you can skip pasting
   anything. Only use the **Google OAuth client ID** field in
   Settings → Links if you ever switch to your own Cloud project.
7. Click **Connect** on the Google Calendar card and approve access.

Upcoming events then appear in the desktop calendar widget next to the
clock. Use **Disconnect** in Settings → Links to revoke access and wipe
the locally stored token.

## Serving over HTTP

Google OAuth does **not** accept `file://` origins. Serve the folder over
HTTP instead, e.g. from the project folder:

```sh
python -m http.server 8000
```

then open `http://localhost:8000` (and register exactly that origin in
step 5).

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `redirect_uri_mismatch` or `origin_mismatch` | The page origin is not in Authorized JavaScript origins. Add it exactly (scheme + host + port). |
| `access_denied` / Error 403 | The Google account is not listed under Test users (testing-mode apps), or Calendar API is not enabled. |
| Popup blocked | Allow popups for the site and click Connect again. |
| "Session expired — reconnect" | The token lapsed (tokens last ~1 hour). Haze retries silently once, then asks you to reconnect. |
| Widget says connection failed | Offline, or the Client ID is wrong — re-check the pasted value. |

## Security notes

- Access tokens live only in this browser (`localStorage`, key
  `glass.gcal`) and are sent only to `googleapis.com`.
- Requested scopes are the minimum read-only set: calendar events plus
  your account email for display.
- Disconnect revokes the token at Google and deletes all local copies.

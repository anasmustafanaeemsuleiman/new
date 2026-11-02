# Chatter — WhatsApp-style chat, no phone number

A real, deployable 1-to-1 chat app (WhatsApp-like UI) where you sign in with a
**username + password** and connect with someone by **showing or scanning a QR code**
instead of exchanging phone numbers.

- Frontend: Vite + React 19 + TypeScript (static build, hash routing)
- Backend: Supabase (Postgres + Auth + Realtime, row-level security)
- Hosting: GitHub Pages via GitHub Actions

---

## What it does

| Feature | Where |
| --- | --- |
| Sign up / sign in with username + password (no phone, no email UI) | `src/components/AuthScreen.tsx` |
| Chat list with last message, timestamps and unread badges | `src/components/Sidebar.tsx` |
| Live conversation with day separators and read ticks (✓ / ✓✓) | `src/components/ChatPane.tsx` |
| Tamper-proof contact exchange: your QR code ⇄ their scanner | `src/components/QrModal.tsx` |
| Find anyone by username | sidebar search / scanner fallback |
| Chat with yourself (notes to self) | the **Me** row at the top of the sidebar |
| Profile (display name, about) and sign out | `src/components/ProfileModal.tsx` |
| Real-time message + read-receipt delivery | `src/lib/supabaseBackend.ts` |
| Browser-only demo mode (no keys required) | `src/lib/localBackend.ts` |

### How the QR idea works

1. You open **My QR code**. It encodes `https://<your-site>/#/u/<your-username>`.
2. The other person taps **Scan**, points their camera at your screen, and the app
   immediately opens (or creates) the direct chat between the two of you.
3. Scanning with a normal phone camera also works: the link opens Chatter, and
   after sign-in the chat opens by itself.

Because the payload is a plain link, you can also paste it in a message, print it,
or put it on a business card — no phone number is ever exposed.

---

## 1. Run it locally

```bash
npm install
npm run dev          # http://localhost:3000
```

With no `.env` file the app starts in **demo mode**: accounts, chats and messages
live in this browser only. Open a second tab (or a private window) and create a
second account to try a real conversation between two people — each tab keeps its
own signed-in session.

## 2. Go live with Supabase (5 minutes)

1. Create a free project at <https://supabase.com>.
2. Open **SQL Editor → New query**, paste all of [`supabase/schema.sql`](supabase/schema.sql)
   and press **Run**. This creates the tables, security policies, the
   `start_direct_chat()` / `start_self_chat()` functions, the profile trigger and
   enables Realtime. Re-run the same file after updating Chatter — it is
   idempotent, and newer features (such as the self chat) need their functions.
3. Open **Authentication → Sign In / Providers → Email** and turn **off**
   *Confirm email*. Chatter uses internal, never-shown addresses
   (`<username>@chatter.local`), so there is no mailbox to confirm.
4. Open **Settings → API** and copy the **Project URL** and either the **anon public**
   key or the newer **publishable** key (`sb_publishable_…`) — both go in the same
   place. Use the bare project URL (`https://xxxx.supabase.co`), **not** its
   `/rest/v1/` endpoint: auth and realtime URLs are derived from the host.
5. Create `.env` in the project root:

   ```bash
   cp .env.example .env
   ```

   ```env
   VITE_SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
   # anon key (eyJhbGciOi...) or publishable key (sb_publishable_...)
   VITE_SUPABASE_ANON_KEY=eyJhbGciOi...
   ```

Restart `npm run dev`. The badge on the sign-in card switches from *Demo mode* to
*Live · connected to Supabase*, and two browsers can now chat with each other.

> The anon key is meant to be public — it ships inside the JavaScript bundle.
> All protection comes from the row-level security policies in `schema.sql`.
> Never put the `service_role` key in this app.

## 3. Host it on your GitHub

The workflow in [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) is
the whole publishing path: `actions/checkout` → `setup-node` (Node 22, npm cache)
→ `npm ci` → `npm run build` → `actions/configure-pages` →
`actions/upload-pages-artifact` (publishing `dist/`) → `actions/deploy-pages`,
with `permissions: contents: read, pages: write, id-token: write` and a `pages`
concurrency group. It runs on every push to `main` or `master` and on manual
dispatch, so pushing is all it takes — no branch of generated HTML, no config to
edit.

```bash
git init
git add .
git commit -m "Chatter: QR-based chat app"
git branch -M main
git remote add origin https://github.com/anasmustafanaeemsuleiman/new.git
git push -u origin main
```

This repository is empty, so the first push creates `main`, and Pages will serve
the app from <https://anasmustafanaeemsuleiman.github.io/new/>. The build uses
relative asset paths, so the `/new/` sub-path needs no extra configuration.

Then, in the repository on github.com:

1. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
   Choose the *GitHub Actions* option, not *Deploy from a branch* — there is no
   `gh-pages` branch and nothing to build locally.
2. **Settings → Secrets and variables → Actions → Variables → New repository variable**,
   and add both (values from step 2.4 above):

   | Name | Value |
   | --- | --- |
   | `VITE_SUPABASE_URL` | `https://xxxx.supabase.co` |
   | `VITE_SUPABASE_ANON_KEY` | the anon `eyJhbGciOi...` key or a `sb_publishable_...` key |

   (Repository *secrets* with the same names also work.)
3. Push again — or run **Actions → Deploy Chatter to GitHub Pages → Run workflow**.

> **What is verified here, and what is not.** This workspace has no git remote
> and no GitHub credential, so the workflow has never been triggered by a real
> push and nothing has actually been deployed to Pages from it. What *is*
> verified locally is everything the workflow does: `npm ci` and `npm run build`
> run green in that order, and the resulting `dist/` is served by the Playwright
> suite from two different repo subpaths (`/repo/` and `/chat-app/`) with zero
> failed requests. Enabling the Pages source (step 1) is the one click that has
> to happen in your repository.

Your app is live at `https://<your-username>.github.io/<your-repo>/`.

The build uses relative asset paths (`base: './'`), so it works both for project
pages (`/<repo>/`) and for a `<username>.github.io` user page. Routing is
hash-based, so no `404.html` redirect tricks are needed.

Finally, add your Pages URL to **Supabase → Authentication → URL Configuration →
Site URL / Redirect URLs** so sign-in keeps working on the deployed origin.

---

## Project layout

```
.github/workflows/deploy.yml   build + publish to GitHub Pages
index.html                     entry HTML
public/favicon.svg
src/main.tsx                   React root
src/App.tsx                    session, chat list, message + typing state
src/components/                AuthScreen, Sidebar, ChatPane, QrModal, ProfileModal, Modal, Avatar, Icons
src/lib/types.ts               domain types, username/password rules, backend interface
src/lib/backend.ts             picks Supabase or local backend from env
src/lib/supabaseBackend.ts     real backend: auth, queries, realtime, typing
src/lib/localBackend.ts        offline demo backend (localStorage + BroadcastChannel)
src/lib/qr.ts                  QR generation, deep-link parsing, clipboard
supabase/schema.sql            database schema, RLS policies, realtime setup
playwright.config.ts           e2e config: one static server per repo subpath
tests/chat.spec.ts             end-to-end browser tests, run per subpath
tests/subpaths.ts              repo folder names the suite verifies
tests/serve-subpath.mjs        serves dist/ under $SUBPATH like GitHub Pages
tests/setup-browser-libs.mjs   rootless Chromium libraries/fonts for minimal Linux
```

## Data model

```
profiles(id → auth.users, username unique, display_name, about, color)
chats(id, kind)
chat_members(chat_id, user_id, last_read_at)          -- composite PK
messages(id, chat_id, sender_id, body, created_at)
```

Security highlights:

- `is_chat_member(chat_id)` is `SECURITY DEFINER`, so the policy on
  `chat_members` cannot recurse into itself.
- Members can only read chats, members and messages belonging to them; inserts are
  restricted to `sender_id = auth.uid()`.
- New chats are only created through `start_direct_chat()`, which is idempotent
  and refuses self-chats or unknown users.
- Read receipts come from `chat_members.last_read_at` and drive the ✓ / ✓✓ ticks.
- Profiles are readable by anyone (that is how username search and QR linking
  work); only the owner can edit their row.

## Tests

```bash
npm run test:e2e
```

Playwright drives real Chromium and asserts on the rendered UI. One run proves:

- two username/password accounts sign up in two tabs and both see the conversation;
- contact exchange works both ways — typing a username in search, and the QR payload
  opened in a fresh tab (sign in, and the chat opens by itself);
- a message reaches the other side with no reload, with list preview and unread badge;
- the sender's tick stays single until the recipient opens the chat, then becomes ✓✓;
- the unread badge clears once the chat is opened, and the reply travels back live;
- a single account can open the **Me** chat, message itself, still see the message
  after a reload, and never gets an unread badge for its own messages;
- the typing indicator appears while the other person composes;
- the deep link opens the existing conversation instead of creating a duplicate.

Both tests run against the **production build**, never the dev server: the config
starts one static server per repo subpath name and the whole suite runs under
each, because GitHub Pages serves a project site from `/<repo>/` and the
repository can be called anything. Per subpath, the hosting test checks that every
asset referenced by the HTML (JS, CSS, favicon) returns 200, that the CSS really
loaded, that the lazily imported scanner chunk resolves under that path, that
`/<repo>/#/u/<username>` lands on the chat after sign-in, and that a signed-in
user reloading the subpath lands back on the chat list — with zero 4xx responses
across the whole run.

The subpath list lives in `tests/subpaths.ts` (`/repo/` and `/chat-app/`): add a
name there and the entire suite runs for it. To poke at a build by hand:
`SUBPATH=/chat-app PORT=4182 npm run serve:subpath`.

The conversation uses two tabs in one browser context: the offline backend shares
its store through `localStorage`, so separate browser contexts (isolated storage)
could not exchange messages without the Supabase backend.

On minimal Linux images that lack Chromium's shared libraries and fonts,
`npm run setup:browser` unpacks them into `.cache/` without root; `pretest:e2e`
runs it automatically. On macOS and Windows it is a no-op.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Sign-in card says *Demo mode* | `.env` missing or the dev server was not restarted after creating it. |
| “requires email confirmation” | Turn off *Confirm email* (step 2.3). |
| “no profile row was created” | `supabase/schema.sql` was not run, so the trigger is missing. |
| Messages arrive only after refresh | Realtime is off: re-run `schema.sql` section 8, or check **Database → Replication**. |
| Camera does not start | Browsers only allow the camera on HTTPS or `localhost`; type the username instead. |
| GitHub Pages shows the README | **Settings → Pages → Source** must be *GitHub Actions*. |
| Deployed site stays in demo mode | The `VITE_SUPABASE_*` repository variables are missing, so the build had no keys. |
| `npm run test:e2e` cannot launch Chromium | Run `npm run setup:browser`; on bare Linux images it supplies the missing libraries and fonts. |

## Notes and limits

- Demo mode stores password hashes with SHA-256 in `localStorage` — fine for trying
  the UI, **not** a security boundary. Real accounts live in Supabase Auth.
- One-to-one direct chats only. Group chats, attachments and voice notes are not
  implemented.
- The app reads the most recent 400 messages per chat list and 500 per
  conversation, which keeps the free tier comfortable.

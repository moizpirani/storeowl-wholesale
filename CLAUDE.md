# StoreOwl Wholesale

Invoicing and back office for wholesalers that sell to gas stations and convenience stores. A separate app from
StoreOwl Back Office (repo `moizpirani/shift-close-app`), with the same look. Build plan = claude.ai Project
"StoreOwl Wholesale Invoicing", doc `claude/build-plan-phases.md` (Release 1 = Phases 0–7 + a basic QuickBooks export).

## Working with Moiz (same rules as StoreOwl)
- He isn't technical: plain words, ideas with a clear Yes/No recommendation. Show pictures before building or releasing.
- Say plainly when a request won't fit how wholesalers actually work, and why.
- Never name another software company's product in screens, code, comments, tests or commits; never copy their screens.
- **Release words:** "Put it on test" = push to `test` → test-wholesale.storeowl.app. "Make it live" = push to `main`.
  Anything else = ask which. Until the first wholesaler, both use the test database.
- StoreOwl never keeps tax rates: each state gives a *structure*; the wholesaler types in their own rates.
- Setup starts with "Which state are you in?" + "Do you also sell in other states?"; only those states ever show.

## Design rules (every screen)
Navy #0F1B2D side menu / table headers, page #F6F7F9, white cards, lines #E3E6EB; amber #F2A900 = the ONE main button,
last on the right; other buttons white with a grey outline; teal = ✓, orange = needs you, red = failed. Public Sans,
tabular digits. No long pages (tabs instead), no long help sentences, one home per thing, the sticky "Not saved yet"
bar for forms. **Typing never redraws the page.** Every button / input / select / summary gets `data-guide="<area>-<screen>-<thing>"`
(names never change once given); `tests/ui.test.js` fails without them.

## Code
- Vite single-page app: `src/app.js` (screens), `src/db.js` (the only door to the database + a pretend backend
  `makeFake` for tests and pictures), `src/states.js`, `src/owl.js` (copied from StoreOwl), `src/styles.css`.
- Database: Supabase project **`twedblbvzdmlhtmnysgo` "StoreOwl Wholesale (Test)"** (us-east-1). `supabase/schema.sql`
  is the whole database, safe to re-run. Tables are locked; everything goes through security-definer functions
  that check `_need(company, role)` (owner > manager > staff). Every change is written to `change_log`.
- Tests: `npm test` (node --test; jsdom for screens, PGlite runs schema.sql for the database). Run before every push.
- Pictures: `VITE_FAKE=1 npx vite` runs on the pretend database (never set VITE_FAKE in Vercel).

## Where things stand
- **Phase 0 (built 2026-11-26, pictures shown, not deployed yet):** email-code sign in (6 boxes that fill from the
  text), company setup (1 Your company · 2 Your states with neighbours offered first), side menu (unbuilt pages say
  which phase brings them), Home, Settings → Company · States (owners) · People (invite by email; the invite turns
  into a membership at first sign-in; the last owner can't step down) · History. Schema applied to the test database
  as migration `phase0_companies_people_states_2026_11_26`.
- Still to do for Phase 0: GitHub repo + Vercel project, Supabase Auth (code email template, Site URL
  https://wholesale.storeowl.app), domain wholesale.storeowl.app / test-wholesale.storeowl.app.

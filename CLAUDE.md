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
- Vite single-page app: `src/app.js` (sign in, setup, menu, Home, Settings), `src/catalog.js` (Items, Customers, Settings → Price levels · License rules), `src/rules.js` (pure rules: license states, tobacco stop, item / customer checks), `src/demo.js` (made-up data for pictures only), `src/db.js` (the only door to the database + a pretend backend
  `makeFake` for tests and pictures), `src/states.js`, `src/owl.js` (copied from StoreOwl), `src/styles.css`.
- Database: Supabase project **`twedblbvzdmlhtmnysgo` "StoreOwl Wholesale (Test)"** (us-east-1). `supabase/schema.sql`
  is the whole database, safe to re-run. Tables are locked; everything goes through security-definer functions
  that check `_need(company, role)` (owner > manager > staff). Every change is written to `change_log`.
- Tests: `npm test` (node --test; jsdom for screens, PGlite runs schema.sql for the database). Run before every push.
- Pictures: `VITE_FAKE=1 npx vite` runs on the pretend database; add `VITE_FAKE_DEMO=1 VITE_FAKE_USER=moiz@example.com` for made-up items and customers (never set VITE_FAKE in Vercel).

## Where things stand
- **Phase 0 (built 2026-11-26, pictures shown, not deployed yet):** email-code sign in (6 boxes that fill from the
  text), company setup (1 Your company · 2 Your states with neighbours offered first), side menu (unbuilt pages say
  which phase brings them), Home, Settings → Company · States (owners) · People (invite by email; the invite turns
  into a membership at first sign-in; the last owner can't step down) · History. Schema applied to the test database
  as migration `phase0_companies_people_states_2026_11_26`.
- **On test (2026-11-26, Moiz: "Put it on test"):** Vercel project `storeowl-wholesale` (prj_CVUZAdoMViGTBZ4v98jVRbzoAaLG,
  team moiz-pirani), linked to this repo; env `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` (publishable key) = the
  test database on Production + Preview; Vercel sign-in off. Branch `test` → domain test-wholesale.storeowl.app (needs
  Cloudflare DNS `CNAME test-wholesale → cname.vercel-dns.com`, DNS only, added by Moiz) and
  storeowl-wholesale-git-test-moiz-pirani.vercel.app. Custom SMTP set by Moiz. Site URL = the git-test vercel.app
  link; Redirect URLs = it and test-wholesale.storeowl.app, each with `/**`. Not done: wholesale.storeowl.app for `main`.
- **Supabase Auth checklist for EVERY new Wholesale database (2026-11-26, Moiz: "let's not make the same mistakes"):**
  BOTH email templates **Confirm signup** (first sign-in of a new email) AND **Magic Link** must show `{{ .Token }}`
  (the screen asks for a 6-digit code; Confirm signup was missed first, so a new email got a link); Site URL = the
  app address with no `/**`; Redirect URLs = each address + `/**`; custom SMTP. Checking means signing in with an
  email that has never signed in before. **Email OTP Length = 6** (Sign In / Providers → Email; Supabase's
  default is now 8 and the screen has 6 boxes).
- **Phase 1, part 1 (built 2026-11-26, Moiz approved the pictures, then "yes build it"; NOT pushed yet):** migration
  `phase1_items_customers_levels_2026_11_26` on the test database (every company got L1–L3).
  - **Price levels have private names** (Settings → Price levels, 1–6, default for new customers; a level with customers can't be
    taken off). **Never shown at a glance on a customer's page** (wholesalers open it in front of customers): only "Price level ••• Show",
    which shows it for 5 seconds. The Customers list has no level column, only a level filter.
  - **Items:** list (search by name / UPC / item #, Needs you = no UPC / no cost / price missing / below cost, category), item panel on the
    right: details, category (vapor asks ml, OTP / snuff / pouches / cigars ask ounces), "Counted in" = the smallest unit (stock is counted
    in it), sizes (name, holds N units, UPC unique per company, cost, a price per level). Staff see no costs and can't change items.
  - **Customers:** list → full customer page (Overview · Details · Licenses · Prices · Notes · History). Licenses: resale certificate,
    state location number, tobacco, vapor, hemp, beer, with expiry and "copy on file". **Tobacco license ended or missing = tobacco
    stopped** (Settings → License rules: stop or only warn; remind 0–90 days before). Customers who don't buy tobacco skip that check.
    Owes / past due / buys a week show $0 until invoices (Phase 2) and payments (Phase 3).
  - Not built yet in Phase 1: Bring in from your old system (import with a "balances match" check), uploading license copies.

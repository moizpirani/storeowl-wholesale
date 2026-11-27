# StoreOwl Wholesale

Invoicing and back office for wholesalers that sell to gas stations and convenience stores. A separate app from
StoreOwl Back Office (repo `moizpirani/shift-close-app`), with the same look. Build plan = claude.ai Project
"StoreOwl Wholesale Invoicing", doc `claude/build-plan-phases.md` (re-ordered 2026-11-26: Release 1 = Phases 0–9 — 2 Counter, 3 Payments, 4 Inventory & Receiving,
5 Store ordering app, 6 State Rules, 7 Monthly reports incl. MSA, 8 Send to store, 9 QuickBooks export).

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
- Vite single-page app: `src/app.js` (sign in, setup, menu, Home, Settings), `src/catalog.js` (Items, Customers, Settings → Price levels · License rules), `src/rules.js` (pure rules: license states, licenses needed per state, item / customer checks), `src/demo.js` (made-up data for pictures only), `src/db.js` (the only door to the database + a pretend backend
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
- **Phase 1, part 1 (built 2026-11-26, Moiz approved the pictures, then "yes build it"; ON TEST since 2026-11-26, branch `test`; not on `main`):** migration
  `phase1_items_customers_levels_2026_11_26` on the test database (every company got L1–L3).
  - **Price levels have private names** (Settings → Price levels, 1–6, default for new customers; a level with customers can't be
    taken off). **Never shown at a glance on a customer's page** (wholesalers open it in front of customers): only "Price level ••• Show",
    which shows it for 5 seconds. The Customers list has no level column, only a level filter.
  - **Items:** list (search by name / UPC / item #, Needs you = no UPC / no cost / price missing / below cost, category), item panel on the
    right: details, category (vapor asks ml, OTP / snuff / pouches / cigars ask ounces), "Counted in" = the smallest unit (stock is counted
    in it), sizes (name, holds N units, UPC unique per company, cost, a price per level). Staff see no costs and can't change items.
  - **Customers:** list → full customer page (Overview · Details · Licenses · Prices · Notes · History). Licenses: resale certificate,
    state location number, tobacco, vapor, hemp, beer, with expiry and "copy on file". **Tobacco license ended or missing = tobacco
    stopped** — REPLACED 2026-11-26 by part 4 below (nothing ever stops a sale now).
    Owes / past due / buys a week show $0 until invoices (Phase 2) and payments (Phase 3).
- **Phase 1, part 2 = Bring in from your old system (built 2026-11-26, Moiz said "Yes"; database migration
  `phase1_import_and_starting_balances_2026_11_26` on the test database; ON TEST since 2026-11-26, branch `test`; not on `main` live):**
  `src/importer.js` (pure: CSV / Excel reading, heading row found, column guessing incl. price levels by name, UPC from Excel's
  scientific notation refused, 11-digit UPC fixed only when the check digit then works, dates, terms, levels, carton / roll sizes;
  `buildItems` / `buildCustomers` → good / bad (left out with the reason) / skip (already in StoreOwl: same UPC, or same name + store #);
  customers also `balance` and `outBal` = balances on rows left out). `src/importui.js` = the 4-step page (Upload · Match columns ·
  Check · Bring it in) opened from Items / Customers "Bring in" (`it-import` / `cu-import`): the Check step asks what the old system says
  customers owe and says "Balances match to the cent" or "Off by $X" (and when the gap = the rows left out, says so); rows go in batches
  of 500; every import can be taken back (two taps; deletes what it added). Database: `customers.opening` = the starting balance (what
  they owe until Phase 3 payments; owners only can change it, `_opening_put`), `imports` table, `items/customers.import_id`,
  `import_start` / `import_items` / `import_customers` / `import_finish` / `imports_list` / `import_undo` (managers+, ≤1000 rows a call).
- **Phase 1, part 3 = license copies (built 2026-11-26, Moiz approved the pictures, then "yes build and put it on test";
  migration `phase1_license_copies_2026_11_26` on the test database; ON TEST since 2026-11-26, branch `test`):** Customers → a customer →
  Licenses: each row's Copy cell = **Add copy** (photo or PDF, ≤10 MB; photos shrunk to ≤1600 px JPEG on the device) or a small picture of
  the current copy; tapping it opens the side window `#lc-pan` (full copy, number + end date boxes with Save, Added by / when, Open full size,
  Remove two taps, Replace with a new copy, **Copies on file** = every copy, the current one showing the license as it is now, older ones
  the number / end date they were added with). Managers+ add / remove; staff look. Files: private storage bucket `licenses`, path
  `<company>/<customer>/<kind>-<time>-<rand>.<ext>`, storage rules `license copies add` (managers+) / `license copies look` (members) via
  `copy_path_ok(name, min)`; the app shows each with a signed link good for an hour (`withUrls` in src/db.js). Table `license_copies`
  (never deleted, `removed_at`), `copy_add` (path must be under that company / customer, photo or PDF only), `copy_remove`,
  `customer_get` returns `copies`. The simpler import (no Match columns page) is on branch `import-simple`, not on test (Moiz: leave it).
- **Phase 1, part 4 = licenses the wholesaler picks per state; warnings only (built 2026-11-26, Moiz: "Let the wholesaler decide which
  licenses he needs ... complete authority ... make this change and build it"; migration `phase1_license_rules_per_state_2026_11_26`
  on the test database; ON TEST since 2026-11-26):** Settings → License rules = **Licenses you need to sell**, one box per state the
  company sells in, 6 checkboxes (resale, location number, tobacco, vapor, hemp, beer; each says what it covers: every sale / the item
  categories in `LIC_COVERS`), "Use the suggested list"; **When a needed license is missing or ended** = Only warn me (default) · Ask for a
  manager's OK; Remind me. Suggested lists (`suggestedLic` in src/rules.js): **TN = resale + location + hemp** (Tennessee doesn't license
  stores to sell tobacco or vapor, 2026; hemp stores need a TABC retail license); every other state = resale + tobacco until researched.
  Settings: `lic_mode` ('warn' | 'ask'), `lic_need` ({state: [kinds]}); `tobacco_stop` is gone. A customer falls under their store's state,
  else the home state; tobacco / vapor only if they buy tobacco; missing hemp / beer licenses only warn at sale (`saleWarnings`), not on the page.
  **Nothing stops a sale** (Moiz: the wholesaler always has the final say; the app never blocks an order). Customer page: orange bar
  `#cu-licbar` (what's missing or ended, "You can still sell to them", **Email the store** = mailto with the request, **Upload now** = add a copy,
  then the Licenses tab opens with the copy panel); Licenses tab lists needed ones first with what they cover, others say "Not needed";
  Prices tab says "<license> ended … · you'll be warned". All license issues are orange. Still to come: the Counter's "Sell anyway" box with a
  reason, written to History (Phase 2), license reminder emails to stores (needs a sender).
- **Phase 1, part 5 = item photos (built 2026-11-26, Moiz approved the pictures, then "yes"; migration `phase1_item_photos_2026_11_26`
  on the test database; ON TEST since 2026-11-26, Moiz: "put it on test"):**
  one photo per item (sizes share it), shrunk to ≤ 800 px JPEG on the device (`readCopy(file, 800, true)`), PUBLIC bucket `item-photos`
  `<company>/<item>-<time>.jpg` (product photos aren't private; invoices and the store app show them), `items.photo`, `item_photo_set`
  (managers+, path must be under that company / item, '' takes it off; logged), `photo_url` added in src/db.js. Items list: 40 px photo
  or a dashed "+", **No photo** filter (a missing photo is NOT "Needs you"). Item panel: photo at the top of Details — Take a photo
  (phone camera) / Pick a photo, or Take or pick a new photo / Remove photo (two taps); a new item keeps the photo until it's saved.
  **Add photos** (`#it-photos`): pick or drop many photos; a file named with any size's UPC (leading zeros or the check digit may be
  missing, `upcSame`) or the item # matches by itself (`photoMatch`), others get "Pick the item"; Save N photos (last one wins for one item).
- **Phase 1, part 6 = quantity breaks (built 2026-11-26, Moiz approved the pictures, then "yes build it and put it to test"; migration
  `phase1_quantity_breaks_2026_11_26` on the test database; ON TEST since 2026-11-26, Moiz: "ok go ahead"):** per size `item_sizes.breaks` = [{min, off}] (buys at least `min` → `off` dollars off each, at
  EVERY price level — Moiz chose "$ off each", not a price per level), `items.break_group` (items with the same group name count together,
  e.g. any Seneca cartons). Checked in `breaksCheck` (rules.js) and `_breaks_clean` (database): whole number ≥ 2, amount off > 0, no
  quantity twice, more bought takes off at least as much, never more than the price. Item panel: **Quantity breaks** under Sizes and
  prices (size, buys at least, off each, the price for each level updating while typing, + Add a break), **Count together with** (a group
  name with the existing ones offered; the hint says how many items count). Customer Prices tab: "5+ $33.90 · 10+ $33.60" under their
  price. `breakOff` / `breakPrice` are ready for the Counter (Phase 2), which applies them. Still to check in Phase 6: a break must not
  take a cigarette below a state's minimum price.
- **Phase 2, piece 1 = the Counter (built 2026-11-27, Moiz approved the pictures, then "yes build it and put it on test"; migration
  `phase2_counter_sales_barcodes_2026_11_27` on the test database; ON TEST since 2026-11-27):** `src/counter.js`. Counter main screen = big
  **New sale**, Resume a suspended sale (count), Find an invoice (Orders tile comes with Phase 5, statements with piece 3). **Privacy:** no recent
  customers; search shows name · store # · city only and nothing until you type; Owes / Credit left behind "••• Show" (5 s); the screen clears
  after a sale. Scan → the Ordered box is focused with 1 selected → type, Enter → back to scanning; same item again = +1; Shipped follows
  Ordered unless changed ("N short"); name search under the scan box (arrows / Enter); lines grouped by category with subtotals; size toggle;
  breaks applied (`priceSale`). **Unknown barcode** → logged (`upc_unknown_scan`), orange note, pick by name (records "sold as") →
  Items → **Barcodes to add** (`#it-bc`, managers+, add to a size with no UPC or ignore). Buttons: **Suspend** (finish by closing; a past-due
  one shows on Review, never posts by itself) · **Send for review** (reason chips + note) · **Complete sale** (Charge to account only, no due
  date) · Clear / Cancel sale (two taps) · Repeat last order. Licenses per `lic_mode`: warn = orange box + "Why sell anyway?" (required, saved
  as `sales.lic_reason` and in History); ask = staff must Send for review; **off** = owners only ("Don’t warn at the Counter"), nothing at the
  Counter, the customer page / Home still show it. **Review** menu item (managers+, badge) = sales sent for review + past-due suspends; opening
  one lets a manager fix and complete it, dated the day it was sent. **Invoices** = a simple list (search by #, customer, date) with a lines
  panel; printing / emailing = piece 3. Database: `sales` (suspended | review | posted | cancelled; prices worked out on the server by
  `_sale_price`, same as `priceSale`), `companies.next_invoice` (from 1001), `sale_save` (suspend | review | complete | cancel), `sales_list`,
  `sale_last`, `unknown_upcs` + `upc_unknown_*`; owes = opening + posted invoices. Still to come: printing (piece 3), returns (piece 4),
  suspend time limit / hide balances settings.
- **NEXT = Phase 2, piece 3: print + email + EDI (pictures shown 2026-11-26, NOT approved to build yet; pictures in claude.ai Project doc
  `claude/next-steps.md`):** printed invoice on Letter, always "Page 1 of 1" (wholesaler licenses / MSA ID at top; Sold to; store licenses on
  file, only filled ones; Terms + "Charged to account", NO due date; Sold by = real name; lines grouped by category with subtotals: photo,
  item #, full UPC + real UPC-A barcode, size "Carton · 10 packs", ordered / shipped + "N short", old price above break price; Cigarettes vs
  All other summary; TN "Tennessee Dept of Revenue Tobacco Tax Paid Invoice" line; owed before + "You owe as of"; editable policy footer;
  optional signature line). After Complete sale: tick boxes **Print** (N copies) · **Email the invoice** (PDF) · **Email EDI** (X12 810 +
  spreadsheet, pack barcode / pack count / pack cost per line) → "Send and start next sale". Settings → Invoices tab (your license numbers,
  show photos / barcodes / what the store owes / signature line, tax line, footer, after a sale default, copies). Customer → Details:
  Invoice email + EDI email + what this store normally gets. Recommended (waiting on Moiz): sender invoices@storeowl.app with reply-to the
  wholesaler (DNS records in Cloudflare), Letter only, Items "Needs you: No single-pack barcode", Resend on Invoices. Also uncommitted-then-
  committed here: done-screen fix (`.rowr.center` clashed with `.center{min-height:100vh}` → `rowc`).

# Next Level Family Restaurant — POS UI Prompt Pack (React)

Prompts for generating the POS front-end in Claude. **Paste Prompt 0 first**
and keep that chat open — every later prompt builds on the design system it
establishes. Then run the screen prompts one at a time, in any order you like.

Each screen prompt is self-contained enough to paste into a *fresh* chat too
— just paste Prompt 0 above it if you do.

Everything here is derived from the real running system, not invented: the
colours come from the venue's own website tokens, the roles and screens come
from the POS's `page-gate.js`, and the money rules come from the billing code.

---

## PROMPT 0 — Design system + app shell

> Paste this first.

```
You are designing the front-end for a real, in-production restaurant
point-of-sale system. Build it in React (function components + hooks,
TypeScript). Use Tailwind CSS v4. No component library — build the
primitives yourself so every one is touch-sized and consistent.

THE BUSINESS
"Next Level Family Restaurant & Dhaba" — a single family restaurant in
India. It has three tills under one roof:
  1. the main restaurant (food + a bar that serves alcohol),
  2. an outside cafe counter (tea/coffee/ice cream — its own catalog),
  3. online: customers order from the website or by scanning a QR code
     at their table.
Currency is Indian rupees (₹). Timezone Asia/Kolkata. Staff are Indian,
comfortable in English, and are not office workers — they are servers,
cashiers and cooks moving fast during a dinner rush.

THE DEVICE REALITY — this drives every layout decision
- Billing/cashier staff work from a PHONE or a small 8-10" tablet, held
  in one hand, often with wet or oily fingers. Design for the thumb:
  primary actions sit in the BOTTOM half of the screen, never the top.
- The kitchen screen is a tablet or monitor MOUNTED ON A WALL, read from
  1-2 metres away across a hot, steamy, badly-lit kitchen. Big type,
  very high contrast, no small text, no hover-only affordances.
- The owner checks the dashboard on a phone, occasionally a laptop.
- Customers scanning the table QR use their own phone, no login.
So: MOBILE-FIRST, genuinely. Design the 390px-wide layout first and let it
grow to desktop, not the reverse. Minimum touch target 48x48px, 56px for
anything used repeatedly (quantity steppers, item tiles, the pay button).

VISUAL IDENTITY — taken from the real venue
The restaurant's public website already uses these; the POS should feel
like the same family, but calmer and denser, because it is a tool people
stare at for eight hours, not a marketing page.

  --cardinal:      #a31621   (primary — the painted walls)
  --cardinal-deep: #7c0f19   (pressed / dark states)
  --marigold:      #e3a522   (accent, warnings, "needs attention")
  --sunflower:     #f6c445   (light accent, highlights)
  --cream:         #fbf3e7   (app background, light mode)
  --cream-dim:     #f3e7d4   (cards, raised surfaces)
  --ink:           #2b211a   (primary text — warm near-black, never #000)
  --ink-soft:      #5a4c3f   (secondary text)
  --basil:         #4b6b3d   (success, paid, ready)
  --saffron:       #ff9933   (in-progress)
  --india-green:   #138808   (confirmed / positive money)

Typography: one warm display face for numbers and headings, one clean
sans for UI text. Money is the most important thing on most screens —
render every amount in tabular figures (font-variant-numeric: tabular-nums)
so columns of prices line up and don't jitter as they change.

Rounding: 6px for chips and inputs, 14px for cards. Warli folk-art white
line work is the venue's decorative motif — use it sparingly, as a thin
header rule or an empty-state illustration, never behind text.

TWO THEMES, and they are not the same design
- LIGHT (cream) — every screen except the kitchen.
- KITCHEN DARK — near-black background (#14100d), oversized type, tickets
  as big colour-coded cards. This is not "dark mode"; it is a different
  density and scale, tuned for reading across a room.

THE APP SHELL
Build a shell with:
- A bottom tab bar on mobile (thumb reach) / a left sidebar from 1024px up.
  The tabs shown depend entirely on the signed-in user's role (below).
- A compact top bar: restaurant name, current till/screen name, a live
  connection dot (green = realtime connected, amber = reconnecting, red =
  offline), and the user chip (name + role) with a sign-out menu.
- A global toast/alert layer for new-order alerts.
- An "offline" banner. The POS runs on a server INSIDE the restaurant, so
  it keeps working when the internet is down — but the website-order feed
  does not. Say that honestly in the banner rather than showing a generic
  error.

THE SIX ROLES — the nav must be built from this table, not hand-wired
  admin        — every screen, including Staff and Audit Log
  manager      — everything EXCEPT Staff and Audit Log
  owner        — Dashboard and Audit Log ONLY, and strictly read-only:
                 render no create/edit/settle control anywhere for them
  billing      — Dashboard, Food Billing, Alcohol Billing, Orders history,
                 Live QR Orders, Website Orders. NOT Menu, NOT QR Tables,
                 NOT Staff, NOT Audit, NOT Kitchen, NOT the Cafe till
  kitchen      — the Kitchen screen ONLY
  cafe_billing — the Cafe till ONLY
Landing screen after login: kitchen -> Kitchen, cafe_billing -> Cafe till,
everyone else -> Dashboard.

NON-NEGOTIABLE RULES THE UI MUST ENCODE
1. Bills are immutable. Once a bill exists it can never be edited or
   deleted — by anyone, including admin. Never draw an edit or delete
   control on a bill. (This is enforced in the database too; a delete
   button would simply produce an error.) Corrections happen as a new bill.
2. The kitchen screen NEVER shows money. No prices, no totals, no payment
   state. Cooks see dishes and quantities only.
3. Only alcohol is taxed. Food and cafe items carry no tax. This looks
   like a bug and is not — show a tax line only when there is alcohol.
4. A QR or website order is invisible to the kitchen until a billing user
   presses "Accept → Kitchen". Make that button the single obvious primary
   action on a new order card.
5. Website orders are confirmed by the payment gateway, never by staff.
   Show payment state as read-only fact. There must be no "mark as paid".

DELIVERABLE FOR THIS PROMPT
Produce: the theme tokens as Tailwind v4 CSS variables; the app shell with
role-driven navigation; and the primitive components everything else will
use — Button (primary/secondary/danger/ghost, all >=48px), IconButton,
Card, Sheet (mobile bottom sheet, the main modal pattern), Field, Select,
NumberStepper (big + / - for quantities), Badge/StatusPill, Money (tabular,
₹ prefixed, 2dp), EmptyState, Skeleton, Toast, ConfirmDialog.
Make the bottom sheet the default modal on mobile and a centred dialog on
desktop — same component, responsive.
```

---

## PROMPT 1 — Login

```
Design the POS login screen, mobile-first.

Single centred card on the cream background with a thin Warli line rule at
the top. Fields: username, password, a "keep me signed in on this device"
checkbox (staff use the same tablet all shift), and a large primary
"Sign in" button.

This is a shared-device login: make the fields tall (56px), the labels
persistent (never placeholder-only), and add a show/hide password toggle.

Error states to design: wrong credentials; account deactivated; and a
rate-limited state ("too many attempts, try again in 2:41") with a live
countdown — the backend throttles repeated failures.

After sign-in the user lands on a different screen depending on role, so
show a brief branded transition rather than a flash of the wrong nav.
```

---

## PROMPT 2 — Dashboard

```
Design the owner/manager dashboard. Read-only. Phone-first, and it must be
genuinely useful at a glance while standing in the restaurant.

Top: today's headline numbers as large tiles — Total sales, Bill count,
Average bill. Under each, a small delta vs the same day last week.

Then, in order of usefulness:
- Sales split by till: Food, Alcohol, Cafe, Website. A horizontal stacked
  bar plus the four amounts. These are the four revenue streams and the
  owner thinks in exactly these terms.
- Payment method mix: cash / card / UPI, as a compact donut or stacked bar.
  UPI is the most common method in India — order it first if it leads.
- 7-day trend: a simple line or bar chart of daily totals. Touch a bar to
  see that day's figure.
- Hourly flow for today: bars by hour, so the owner can see the lunch and
  dinner peaks and staff accordingly.
- Top items today: a ranked list with quantity sold and revenue.
- Live strip: orders waiting to be accepted, tickets in the kitchen right
  now, tables currently occupied. These update in realtime.

Design the empty/early-morning state too — at 9am there is almost no data,
and the screen should look intentional, not broken.

The `owner` role sees this screen and the audit log and nothing else, and
may not mutate anything. No action buttons here at all.
```

---

## PROMPT 3 — Food billing + table sessions (the busiest screen)

```
Design the main food billing screen. This is the screen a cashier uses
hundreds of times a day — it deserves the most care of anything in this
system. Phone-first, one-handed.

Two modes on one screen:
  A) TABLE MODE — open a table, build a running session over time
     (guests order more across the meal), then settle it.
  B) DIRECT MODE — a counter sale with no table, built and settled at once.

Layout, mobile:
- Top: a mode switch (Table / Direct). In table mode, a horizontal
  scrolling strip of tables showing status — free, occupied (with elapsed
  time and running total), or reserved. Tapping an occupied table opens
  its session.
- Middle: the catalog. Category chips across the top (horizontally
  scrollable), then a grid of item tiles. Each tile: dish name, price, and
  a photo if one exists. Tapping adds one. Long-press or a small stepper
  adjusts quantity. Include a search field that filters across all
  categories — during a rush, searching beats browsing.
- Bottom, always visible and thumb-reachable: a running total bar showing
  item count and amount. Tapping it expands the current bill as a bottom
  sheet.

The bill sheet: line items with quantity steppers and a swipe-to-remove,
customer name and phone (optional), a discount field, and the totals.
Then a big "Settle" button.

SETTLEMENT — design this carefully, it has a real subtlety:
When a session contains both food and alcohol, settling produces TWO
separate immutable bills (a FOOD-xxxxxx and an ALC-xxxxxx), because
only alcohol is taxed. Any discount is split pro-rata across the two by
subtotal. The settle sheet must show this clearly BEFORE confirming:
two stacked summary cards, each with its own subtotal, its share of the
discount, its tax (food: none) and its total. The cashier picks a payment
method (Cash / Card / UPI) and confirms.

After settling: a success state showing the bill number(s) with a print /
share receipt action. Make it obvious the bill is now final and cannot be
edited.

Also design: an item that is out of stock (dimmed tile, "unavailable"),
and the "table already has an open session" state.
```

---

## PROMPT 4 — Alcohol billing

```
Same skeleton as the food billing screen, but for the bar, with these
differences:

- Every line is taxed. Show the tax rate per item and a clear tax line in
  the totals. This is the only till in the whole system with tax.
- Bar items are bottles/pegs — include quantity units in the tile
  (e.g. "Kingfisher 650ml", "60ml peg") because the same drink exists at
  several sizes and a wrong tap is expensive.
- Stock matters more here. Show remaining stock on each tile and block
  adding beyond it, with an honest message rather than a silent failure.
- Bills settle as ALC-xxxxxx.

Visually distinguish this till from the food till so a cashier never
confuses the two mid-rush — a different header accent (deep cardinal) and
a clear "BAR" label in the top bar.
```

---

## PROMPT 5 — Outside cafe till

```
Design the outside cafe counter till. This is used by ONE role
(cafe_billing) on a phone, standing at an outdoor counter, and it is the
only screen that role can ever see — so it must be completely
self-sufficient.

It is deliberately the simplest till in the system:
- Its own small catalog: Tea, Coffee, Ice Creams, Water Bottles, Cool
  Drinks, Juices, Other.
- No tables, no kitchen ticket, no tax.
- Bills settle as CAFE-xxxxxx.

Optimise hard for speed and repetition: big tiles for the ten or so
best-sellers pinned first, a persistent running total, one-tap quantity,
and a settle flow that is two taps (amount confirm, then payment method).
A cafe sale is often a single 20-rupee chai; the flow should feel that
light.

Include a "today at this counter" summary the operator can pull up —
count and total — since they have no dashboard access.
```

---

## PROMPT 6 — Live QR orders board

```
Design the live board where staff see orders that customers placed by
scanning the QR code at their table.

This is a realtime, high-attention screen. New orders arrive without a
page refresh and must be impossible to miss.

Layout: a column (or responsive grid) of order cards, newest first,
grouped by status: NEW, ACCEPTED, PREPARING, READY, SERVED. Use a
segmented control to filter by status, with a live count badge on each
segment.

An order card shows: the public order number, the table, time since it
arrived (counting up — "4m 20s ago", turning amber past 5 minutes, red
past 10), the items with quantities, the total, and any customer note.

The primary action on a NEW card is "Accept to Kitchen" — one large
button. Pressing it raises a kitchen ticket. Make it idempotent-looking:
after the press it immediately becomes a disabled "Accepted" state, so a
nervous double-tap cannot read as a second order.

Secondary action: "Push to table bill" — adds the items straight onto that
table's open session instead of raising a ticket.
Also: a reject/cancel action behind a confirm.

NEW-ORDER ALERT — the important part:
When a new order lands, three things happen at once: the card animates in
with a highlight, a sound plays, and a dismissible alert banner appears at
the top of the screen ("Order received · Table 6 · #A31 · ₹540"). If
several land together it collapses to "3 new orders received". The banner
must be tappable to jump to the first new card. Design the alert, the
highlight animation, and the collapsed "N new" state.

Design a "sound is muted" warning state too — if a staff member has muted
alerts, this screen should say so visibly, because a silently muted board
loses orders.
```

---

## PROMPT 7 — Website orders board

```
Design the board for pre-orders placed on the restaurant's public website
for pickup. Same family as the QR board but with a payment dimension.

Each order card shows: the reference (WEB-000123), customer name and
phone, requested pickup time, items, and the money — total, the 50%
advance the customer already paid online, and the balance due at pickup.
Make those three numbers unambiguous; staff collect the balance in person
and getting it wrong costs real money.

Status pipeline: PENDING_PAYMENT, CONFIRMED, ACCEPTED, PREPARING, READY,
COMPLETED (plus CANCELLED / FAILED).

CRITICAL UI RULE: only the payment gateway can move an order out of
PENDING_PAYMENT. Staff cannot mark an order paid. So a PENDING_PAYMENT
card must show a passive "waiting for payment" state with a spinner and
the time elapsed — and NO action button at all except cancel. Design this
so it reads as "the system is waiting", not "you forgot to do something".

A CONFIRMED card gets the same big "Accept to Kitchen" button as the QR
board.

Show the payment facts as a read-only receipt block: advance paid, the
time, and the gateway reference. Staff need this when a customer disputes.

Same realtime alert treatment as the QR board — new confirmed orders
animate in, sound, banner.
```

---

## PROMPT 8 — Kitchen screen (dark, wall-mounted)

```
Design the kitchen display. This is the most visually distinct screen in
the system and must be designed for its environment, not for a phone.

Environment: a tablet or monitor mounted on a wall, viewed from 1-2
metres, in a hot kitchen with steam and glare, by cooks who may have wet
hands and who glance at it between tasks.

Therefore:
- Near-black background (#14100d), very high contrast.
- Huge type. The dish name should be readable at 2 metres — think 28-40px
  for item names, not 16px.
- Tickets as large cards in a horizontally-flowing grid, OLDEST FIRST
  (oldest = most urgent, the opposite of the order boards).
- Colour-coded by age: fresh (basil green edge), ageing past 8 minutes
  (marigold), late past 15 minutes (cardinal, and pulsing).

A ticket card shows ONLY: ticket number, table or "WEBSITE PICKUP", a
large elapsed timer, and the dish list with quantities in big type.
ABSOLUTELY NO MONEY — no prices, no totals, no payment status. Cooks must
never see prices. Design it so there is nowhere money could even go.

Status stepping: QUEUED, PREPARING, READY, DONE. The whole card is the
button — tapping it advances to the next status, with a large confirming
animation. Make a mis-tap recoverable with a brief undo.

New tickets slide in with a strong highlight and ring the alert sound.
Because a cook may be across the room, the alert should also flash the
screen edge, not just play a sound.

Include a persistent header strip: count of tickets in each status, the
current time, and a large sound on/off control (cooks toggle this a lot).

Design the empty state — a quiet kitchen at 4pm — so it looks calm and
intentional.
```

---

## PROMPT 9 — Alert sound manager (the new feature)

```
Design a notification-sound manager for the POS. Today the system only has
a single on/off chime; this replaces it.

Entry points: a bell icon in the top bar of every order-facing screen
(QR orders, Website orders, Kitchen), and a row in settings. Opens as a
bottom sheet on mobile, a dialog on desktop.

What it must let a staff member do:

1. CHOOSE A TONE from a built-in library. Present about 8 tones as
   selectable rows, each with its name, a short visual waveform, and a
   play/preview button. Suggested set, calm to urgent: Soft Chime, Temple
   Bell, Marimba, Doorbell, Two-Tone, Kitchen Bell, Alert Siren, Classic
   Beep. Selecting a row previews it immediately.

2. SET VOLUME — a large slider with a speaker icon, plus a test button
   that plays the currently selected tone at the set volume.

3. SET A DIFFERENT TONE PER CHANNEL. Three channels, each its own row with
   its own tone and volume:
      - QR table orders
      - Website orders
      - Kitchen: ticket ready
   Staff must be able to tell, by ear alone and without looking, which
   kind of order just arrived. Make that the explicit promise of the
   screen — say it in the sheet's subtitle.

4. REPEAT UNTIL ACKNOWLEDGED — a toggle, plus an interval picker (every
   10s / 20s / 30s) and a stop-after (1 / 3 / 5 minutes). This is how an
   order stops being missed during a rush. While it is ringing, every
   screen shows a persistent "1 order waiting — tap to silence" bar;
   acknowledging silences it.

5. MUTE, with a clearly visible consequence. A muted board must show a
   permanent warning strip. Design both the mute toggle and that strip.

6. A "test all" button that plays each channel's tone in sequence, so a
   manager can confirm the tablet's volume is actually up before service.

Settings are per-device, not per-account — the kitchen tablet and the
cashier's phone should be able to differ. Say so in the UI with a small
line: "These settings apply to this device only."

Also design the FIRST-RUN state: browsers block audio until the user
interacts with the page, so on first load the app cannot play anything.
Design a friendly one-time "Tap to enable order sounds" card that unlocks
audio — it should feel like a deliberate setup step, not an error.
```

---

## PROMPT 10 — Menu / catalog admin

```
Design the catalog manager (admin and manager only).

Three catalogs live here, switched by a top-level tab: FOOD, ALCOHOL,
CAFE. Each has its own categories and items — they never mix.

Per catalog:
- Category list with drag-to-reorder and inline rename, plus add/remove.
- Item list under the selected category: name, price, photo, availability
  toggle, and for alcohol a tax rate and stock count.
- Add/edit item as a bottom sheet: name, description, price, category,
  photo upload with crop, available toggle, and (alcohol only) tax rate
  and stock.

Two things to design carefully:
- Price changes are audited. When a price is edited, show a confirm step
  that states the old and new price plainly, because this writes an audit
  record attributable to the signed-in user.
- Bulk availability. During service, the common action is "we have run out
  of X" — make marking an item unavailable a one-tap action from the list,
  not something buried in an edit sheet.

The restaurant's real catalog is large (26 categories, ~200 dishes), so
design for scale: sticky category headers, search, and a fast scroll.
```

---

## PROMPT 11 — Tables and QR tokens

```
Design the table manager (admin and manager only).

A grid of table cards. Each shows: table number/name, seats, current
status (free / occupied / reserved), and its QR token state.

Actions per table: rename, set seat count, deactivate, view QR, and
regenerate QR token.

The QR view is important and physical: show the QR code large, with the
table name printed under it, and a "Download / Print" action that produces
a clean printable card the restaurant can laminate and put on the table.
Design that printable card as its own artefact — Warli border, restaurant
name, table name, QR, and a short "Scan to order" line in English.

Regenerating a token invalidates the printed QR. Put that behind a confirm
that says exactly that, in plain words.

Also design a bulk "print all table QRs" sheet.
```

---

## PROMPT 12 — Orders / bill history

```
Design the bill history screen.

A searchable, filterable list of every bill. Filters: date range, till
(Food / Alcohol / Cafe / Website), payment method, and a free-text search
over bill number, customer name and phone.

Each row: bill number, time, till badge, customer (if given), payment
method, and amount. Tapping opens the full bill as a sheet — line items,
discount, tax, total, who created it, and a reprint/share action.

THERE IS NO EDIT AND NO DELETE. Bills are immutable by design and
enforced in the database. Do not draw those controls. If you want to offer
a correction path, it is "create a corrective bill", not an edit.

Include a day summary header for the filtered range: count, gross,
discount, tax, net — and an "Export CSV" action.
```

---

## PROMPT 13 — Staff management (admin only)

```
Design staff account management. Only the `admin` role may ever see this.

A list of staff accounts: name, username, role badge, active/inactive, and
last sign-in.

Actions: create account, change role, reset password, deactivate/
reactivate. All as bottom sheets.

The role picker is the heart of this screen. Present the six roles as
selectable cards, each with a plain-language description of what that
person will and will not be able to do:
  Admin        — everything, including staff and the audit log
  Manager      — everything except staff accounts and the audit log
  Owner        — dashboard and audit log only; cannot bill or change anything
  Billing      — tills, tables, and the order boards
  Kitchen      — the kitchen screen only
  Cafe billing — the outside cafe counter only
Say it in those words. The person assigning a role is a restaurant owner,
not an administrator, and the consequence must be obvious without a manual.

Deactivate, not delete: staff records are never removed, because bills
reference who created them. Design the deactivate confirm to say that.
```

---

## PROMPT 14 — Audit log (admin and owner only)

```
Design the audit log viewer. Read-only, append-only, and the manager role
is deliberately excluded from it.

A reverse-chronological timeline. Each entry: timestamp, the person and
their role, the action, the entity it touched, and an expandable detail
block with the before/after where relevant.

Filters: date range, actor, action type, entity type.

Actions that appear here include bill creation, settlement, staff changes,
catalog price changes, and website order settlement.

Make it feel like a ledger, not a feed: monospace-ish alignment for
timestamps and ids, quiet colour, dense rows, and a clear visual grouping
by day. This screen is read when something has gone wrong, so optimise for
scanning and for copying a reference out.

Add an "Export CSV" action for the filtered range.
```

---

## PROMPT 15 — Customer QR menu (public, no login)

```
Design the customer-facing menu a guest sees after scanning the QR code on
their table. This is the only screen in the system seen by the public, on
their own phone, so it carries the restaurant's brand fully — warmer and
more decorative than the staff screens.

Flow: scan, browse, add to cart, place order, track.

- Header: restaurant name, Warli motif, and "Table 6" so the guest is
  confident they scanned the right code.
- Menu: category chips, dish cards with photo, name, description and
  price. Veg/non-veg indicator dots (the green/red square used in India)
  are expected and should be prominent.
- A floating cart button with item count and total; the cart opens as a
  bottom sheet with quantity steppers and an optional note to the kitchen.
- Place order: name and phone, then confirm. No payment here — QR orders
  are settled at the table.
- After placing: an order tracking view with the public order number and a
  clear status stepper (Received, Accepted, Preparing, Ready, Served) that
  updates live. Include a "call a server" affordance.

Design the states: menu still loading, an item that is unavailable, an
empty cart, order placed successfully, and the order-rejected case.

This screen must be fast on a weak mobile connection — design assuming
images may load late, and make the skeleton pleasant.
```

---

## Appendix A — role → screen matrix (build nav from this)

| Screen | admin | manager | owner | billing | kitchen | cafe_billing |
|---|:--:|:--:|:--:|:--:|:--:|:--:|
| Dashboard | ✅ | ✅ | ✅ (read-only) | ✅ | — | — |
| Food billing | ✅ | ✅ | — | ✅ | — | — |
| Alcohol billing | ✅ | ✅ | — | ✅ | — | — |
| Cafe till | ✅ | ✅ | — | — | — | ✅ |
| Orders history | ✅ | ✅ | — | ✅ | — | — |
| Live QR orders | ✅ | ✅ | — | ✅ | — | — |
| Website orders | ✅ | ✅ | — | ✅ | — | — |
| Kitchen | ✅ | ✅ | — | — | ✅ | — |
| Menu / catalog | ✅ | ✅ | — | — | — | — |
| Tables & QR | ✅ | ✅ | — | — | — | — |
| Staff | ✅ | — | — | — | — | — |
| Audit log | ✅ | — | ✅ | — | — | — |

Landing screen after login: `kitchen` → Kitchen, `cafe_billing` → Cafe
till, everyone else → Dashboard.

Legacy role names still exist in old data and must be normalised on the
way in: `staff` → `billing`, `cafe` → `cafe_billing`.

---

## Appendix B — money rules the UI must not get wrong

- Amounts are rupees to 2 decimals. Render with tabular figures.
- **Only alcohol is taxed.** Food and cafe lines never carry tax. Show a
  tax row only when alcohol is present.
- Settling a mixed session produces **two** bills, `FOOD-xxxxxx` and
  `ALC-xxxxxx`. Discount splits pro-rata by subtotal; the rounding
  remainder goes to the last group so the parts sum exactly to the
  original discount.
- Cafe bills are `CAFE-xxxxxx`. Website orders are `WEB-000123`.
- Website orders take a **50% advance** online; the balance is collected
  at pickup. Website money is handled in integer paise, never floats.
- Bill numbers never skip and never repeat.
- Bills, once created, cannot be edited or deleted by anyone.

---

## Appendix C — realtime behaviour

The POS holds a live connection to the in-restaurant server. Three
channels push updates: `live_orders` (QR), `website_orders`, `kitchen`.

Design for the connection states explicitly: connected, reconnecting, and
offline. On reconnect the client replays state — so a returning connection
must **not** re-ring the alert sound for orders it already knew about.
Show a quiet "caught up" indicator instead.

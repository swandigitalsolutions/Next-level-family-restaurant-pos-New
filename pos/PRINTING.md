# Printing bills

The POS prints through the **browser**, not through a driver of its own. The
receipt is rendered as HTML sized for an 80mm roll and handed to
`window.print()`; the operating system's printer driver does the rest.

That choice is deliberate. The alternative — talking ESC/POS to the printer
over USB or a socket — means a native helper running next to the browser on
every till, and a different one for Windows and for the Pi. Browser printing
works the same on the counter PC, the manager's laptop and an Android tablet,
and it is the only approach where "print" keeps working when the POS is opened
from a second device.

---

## What gets printed

`pos/web/src/components/Receipt.tsx`, styled by `Receipt.css`:

```
   NEXT LEVEL FAMILY RESTAURANT
        GSTIN: <when set>
            FOOD BILL
           FOOD-000123
       2026-09-27 21:04:11
- - - - - - - - - - - - - - - -
Customer: ...       Payment: Cash
- - - - - - - - - - - - - - - -
Masala Dosa x2            240.00
Butter Naan x1             50.00
- - - - - - - - - - - - - - - -
Subtotal                  290.00
Discount                  -20.00
GRAND TOTAL               270.00

     Thank you, visit again!
```

- **72mm content on an 80mm roll, and each page exactly as long as the bill.**
  `PrintArea` measures every receipt just before printing and gives it its own
  named page (`@page receipt-0 { size: 80mm <height>mm }`), so the printer
  feeds only what is printed — not an A4 or 297mm "roll" page of blank paper.
  (The earlier `size: 80mm auto` is not valid CSS; Chrome silently dropped it
  and printed on Letter/A4.)
- **Reprints are marked.** A receipt printed again from Bill history says
  `DUPLICATE`, and one for a cancelled bill carries a boxed
  `CANCELLED — NOT A VALID BILL` with the reason, so a reprint can never be
  passed off as a second sale or as proof of a payment that was reversed.
- **Always black on white**, whatever theme the till is in. Thermal paper has
  no dark mode; a dark-theme receipt prints as a solid black rectangle and
  empties the roll.
- **Tax is only shown when there is tax.** Only alcohol is taxed, so a zero tax
  line on a food bill is noise.
- A mixed table settles into two bills — `FOOD-` and `ALC-` — and prints them
  as **two receipts, one per page**.

## The GSTIN

Not yet issued, so it is blank and the line is **omitted** rather than printed
empty. Set it in `pos/web/.env` and rebuild:

```
VITE_RESTAURANT_GSTIN=29ABCDE1234F1Z5
```

It is read at build time (`import.meta.env`), so `npm run build` has to run
again after changing it — editing the file on a running server does nothing.

---

## Setting up the printer

Any 80mm thermal printer that installs as a normal system printer works —
Epson TM-T82/T88, TVS RP 3160, Rugtek, Posiflex and the generic 80mm USB
printers sold locally all do.

### 1. Install the driver

Windows: run the manufacturer's driver, then **Settings → Bluetooth & devices →
Printers**. Confirm it prints its own test page before going near the POS.

Raspberry Pi: most of these speak ESC/POS and work through CUPS.

```bash
sudo apt install cups printer-driver-escpr
sudo usermod -aG lpadmin "$USER"
# then http://localhost:631 -> Administration -> Add Printer
```

### 2. Set the paper size

This is the step that is usually wrong. In the printer's **Preferences**, set
the paper to the **80mm × Receipt** (or "roll paper / continuous") size. If it
is left on A4, the browser scales a 72mm receipt onto an A4 page and you get
one line of text at the top of a very long slip.

### 3. Turn off the browser's own headers

In the Chrome print dialog, open **More settings** and:

- **Margins → None**
- **Headers and footers → off** (otherwise every bill carries the page URL and
  the date twice)
- **Scale → 100** (not "Fit to page")
- **Paper size** should show the receipt's own size (80 × ~85mm for a short
  bill). If it shows A4 or Letter, the browser is older than Chrome/Edge 131,
  which is when per-page sizes arrived — update it.

Chrome remembers these per printer, so it is a one-time job per till.

### 4. Skip the dialog (optional, recommended for a busy counter)

Launch the till's browser in kiosk-printing mode and `window.print()` goes
straight to the default printer with no dialog:

```
chrome.exe --kiosk-printing --app=http://<pos-host>:8080
```

Make the thermal printer the machine's **default** printer first, or every bill
goes to whatever is.

---

## Checking it without wasting a roll

Print to PDF first. Chrome's "Save as PDF" destination with the 80mm paper size
produces exactly what the roll will show, and costs nothing:

1. Settle a bill with **Save & print**.
2. In the dialog choose **Save as PDF**.
3. The PDF should be one page per bill, **80mm wide and only as long as the
   bill**, with no app chrome or navigation. A mixed table gives two pages.

Verified in Chromium (Playwright, `page.pdf` with the page's own CSS sizes):
food till, cafe till and a Bill-history reprint each produce one 80mm-wide
page per receipt (80 × 85mm, 80 × 80mm, 80 × 101mm), with nothing but the
receipt on it.

### First print on the real printer

1. Print the printer's own self-test (hold FEED while powering on) — proves
   paper and head, independent of the PC.
2. Print a short bill with **Save & print**. Check: nothing cut off on the
   right (if it is, the driver's paper is 58mm — set it to 80mm), no long blank
   tail (if there is, the driver is forcing a fixed page length — choose its
   "roll"/"receipt" paper), and the auto-cutter fires once per bill.
3. Print a long bill (15+ lines) — it must come out as one continuous slip.
4. Settle a mixed food + bar table — two slips, `FOOD-` then `ALC-`.

If the app's own screen appears on the page, the print stylesheet did not
apply — that is a bug, not a setting; see `Receipt.css`, which hides everything
outside `.print-area` while a receipt is mounted.

---

## Known gaps

- **Never tested on real hardware.** The layout is built for an 80mm roll and
  is covered by a test, but it has only ever been rendered to PDF. The first
  print on the counter printer is where paper width and margins get their real
  check.
- **No cash drawer kick.** Drawers are opened by an ESC/POS pulse through the
  printer, which browser printing cannot send. It needs the native helper this
  design deliberately avoids.
- **No automatic reprint queue.** If the printer is offline the bill is still
  saved — bills are immutable and independent of paper — and can be reprinted
  from **Bill history** once it is back.

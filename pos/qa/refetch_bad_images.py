"""
Re-fetch the menu photos that do not show the dish they are labelled with.

Why this exists separately from fetch_correct_food_images.py: that script
derives its search query from the item name, which is how the bad ones got
there in the first place. "Chicken Hariyali Kebab" matched a green blob and
"Palak Dal" matched a photo of palak paneer, because a title-token score
cannot tell whether a picture shows the right food.

So two changes:
  1. The query is written by hand per dish, below, aimed at what the dish
     actually looks like rather than at its name.
  2. Nothing is applied automatically. It downloads SEVERAL candidates per
     dish and lays them out in a contact sheet for a human (or a model that
     can see) to pick from. apply_image_picks.py does the applying.

Licence: Wikimedia Commons only, and the licence and author of every
candidate are recorded in the manifest, because these end up on a commercial
menu and on the public website's /credits page.

Usage:
    python qa/refetch_bad_images.py           # fetch candidates + contact sheets
"""

import json
import re
import sys
import time
from pathlib import Path

import requests
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "qa" / "candidates"
SHEETS = ROOT / "qa" / "candidate-sheets"
MANIFEST = ROOT / "qa" / "candidate-manifest.json"

API = "https://commons.wikimedia.org/w/api.php"
SESSION = requests.Session()
SESSION.headers.update(
    {"User-Agent": "NextLevelFamilyRestaurant/1.0 (menu image correction; contact: restaurant owner)"}
)

# dish name in the catalog -> what to ask Commons for.
# Written by hand: the query describes the FOOD, not the menu label.
TARGETS = {
    # Flatly wrong — the photo shows something else entirely.
    "Mineral Water": "drinking water glass",
    "Chicken Curry": "chicken curry bowl",
    "Chicken Hariyali Kebab": "hariyali chicken tikka green",
    "Hariyali Chicken Tikka": "hariyali kebab green chicken",
    "Palak Dal": "dal palak spinach lentil",
    "Mushroom Masala": "mushroom curry masala",
    "Gajar Halwa": "gajar ka halwa carrot",
    "Pepper Chicken": "pepper chicken chettinad",
    "Plain Dosa": "plain dosa",
    "Egg Roll": "egg roll kathi roll",
    "Chicken Methi Malai": "methi malai murg creamy",
    "Cheese Sandwich": "cheese sandwich",
    "Palak Paneer": "palak paneer",
    "Baby Corn Hyderabadi": "baby corn curry",
    "Egg 65": "egg 65 fried",
    "Egg Chilli": "chilli egg",
    # Poor: real dish, but an amateur table snapshot rather than a dish photo.
    "Buttermilk": "buttermilk chaas glass",
    "Chicken Sweet Corn Soup": "sweet corn chicken soup bowl",
    "Grilled Veg Sandwich": "grilled vegetable sandwich",
    "Chicken Mayo Sandwich": "chicken mayonnaise sandwich",
    "Kulfi": "kulfi indian ice cream",
    "Cucumber Salad": "cucumber salad",
    "Peas Pulao": "peas pulao matar",
    "Mushroom Pepper Fry": "mushroom pepper fry",
    "Veg Schezwan Fried Rice": "schezwan fried rice",
    "Dal Fry": "dal fry lentil",
    "Dal Tadka (Spicy)": "dal tadka",
    "Mushroom Kadai": "kadai mushroom",
    "Chicken Tikka": "chicken tikka skewer",
}

PER_DISH = 5  # candidates offered per dish
BAD_TITLE = ("logo", "icon", "flag", "map", "poster", "screenshot", "diagram", "chart")


def slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def api(params: dict, attempts: int = 5) -> dict:
    """Commons rate-limits hard (429) and expects a polite client. Back off
    rather than dropping the dish — a skipped dish silently keeps its wrong
    photo, which is the failure this whole script exists to fix."""
    delay = 2.0
    for attempt in range(attempts):
        r = SESSION.get(API, params={**params, "format": "json"}, timeout=30)
        if r.status_code == 429:
            wait = float(r.headers.get("Retry-After", delay))
            print(f"    (429, waiting {wait:.0f}s)", flush=True)
            time.sleep(wait)
            delay = min(delay * 2, 60)
            continue
        r.raise_for_status()
        return r.json()
    raise RuntimeError("rate limited after retries")


def search(query: str, limit: int = 25) -> list:
    data = api({"action": "query", "list": "search", "srsearch": query, "srnamespace": 6, "srlimit": limit})
    ids = [str(h["pageid"]) for h in data.get("query", {}).get("search", []) if h.get("pageid")]
    if not ids:
        return []
    info = api(
        {
            "action": "query",
            "pageids": "|".join(ids),
            "prop": "imageinfo",
            "iiprop": "url|mime|size|extmetadata",
            "iiurlwidth": 900,
        }
    )
    out = []
    for page in info.get("query", {}).get("pages", {}).values():
        ii = (page.get("imageinfo") or [{}])[0]
        if not ii.get("mime", "").startswith("image/"):
            continue
        w, h = ii.get("width") or 0, ii.get("height") or 0
        # Too small to look like anything on a tile; too tall/thin to crop well.
        if w < 600 or h < 400 or w / max(h, 1) < 0.9:
            continue
        title = page.get("title", "").lower()
        if any(b in title for b in BAD_TITLE):
            continue
        ext = ii.get("extmetadata", {})
        out.append(
            {
                "pageid": page.get("pageid"),
                "title": page.get("title", ""),
                "url": ii.get("thumburl") or ii.get("url"),
                "descurl": ii.get("descriptionurl", ""),
                "width": w,
                "height": h,
                "licence": (ext.get("LicenseShortName", {}) or {}).get("value", ""),
                "author": re.sub(r"<[^>]+>", "", (ext.get("Artist", {}) or {}).get("value", "") or "")[:120],
            }
        )
    return out


def sheet_for(dish: str, picks: list) -> None:
    """One labelled strip per dish, so the choice can be made by eye."""
    CW = CH = 260
    LBL = 28
    img = Image.new("RGB", (CW * len(picks), CH + LBL), "#111318")
    d = ImageDraw.Draw(img)
    try:
        font = ImageFont.truetype("C:/Windows/Fonts/arialbd.ttf", 15)
    except OSError:
        font = ImageFont.load_default()
    for i, p in enumerate(picks):
        try:
            im = Image.open(p["file"]).convert("RGB")
            im.thumbnail((CW - 8, CH - 8))
            img.paste(im, (i * CW + 4 + (CW - 8 - im.width) // 2, 4 + (CH - 8 - im.height) // 2))
        except Exception:
            d.text((i * CW + 10, 10), "ERR", fill="red", font=font)
        d.rectangle([i * CW, CH, (i + 1) * CW, CH + LBL], fill="#1b2029")
        d.text((i * CW + 8, CH + 6), f"[{i + 1}] {dish[:26]}", fill="#e8edf4", font=font)
    SHEETS.mkdir(parents=True, exist_ok=True)
    img.save(SHEETS / f"{slug(dish)}.png")


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    # Resume: a rate-limited run leaves most dishes done, and re-fetching them
    # only burns quota and risks getting throttled again.
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8")) if MANIFEST.exists() else {}
    todo = {d: q for d, q in TARGETS.items() if not manifest.get(d)}
    print(f"{len(manifest)} already done, {len(todo)} to fetch\n")

    for dish, query in todo.items():
        try:
            cands = search(query)[:PER_DISH]
        except Exception as e:  # a single bad query must not lose the whole run
            print(f"  ! {dish}: search failed: {e}", file=sys.stderr)
            continue
        picks = []
        for i, c in enumerate(cands):
            dest = OUT / f"{slug(dish)}-{i + 1}.jpg"
            try:
                data = SESSION.get(c["url"], timeout=40).content
                dest.write_bytes(data)
                c["file"] = str(dest)
                picks.append(c)
            except Exception as e:
                print(f"  ! {dish} #{i + 1}: {e}", file=sys.stderr)
            time.sleep(0.15)  # be polite to Commons
        if picks:
            sheet_for(dish, picks)
            manifest[dish] = picks
            MANIFEST.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
        print(f"{dish}: {len(picks)} candidates", flush=True)
        time.sleep(1.5)
    MANIFEST.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(f"\nmanifest: {MANIFEST}")
    print(f"sheets:   {SHEETS}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

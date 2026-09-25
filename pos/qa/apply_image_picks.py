"""
Apply the hand-picked replacement photos over the wrong ones.

PICKS below are chosen by eye from the contact sheets that
refetch_bad_images.py produces — one dish, one candidate index. Nothing is
picked automatically: a title-match score is what put a picture of palak
paneer on Palak Dal in the first place.

The catalog maps a dish name to a path (aws/db/data/menu-images.json), so a
replacement overwrites the file at that same path. The mapping is untouched
and a re-seed keeps the new picture.

Every replacement's Commons page, licence and author is appended to
qa/image-credits.json. These are CC-licensed photographs on a commercial
menu; the credit is the condition of using them.

Usage:
    python qa/apply_image_picks.py --dry-run
    python qa/apply_image_picks.py
"""

import argparse
import json
import shutil
from datetime import date
from pathlib import Path

from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "qa" / "candidate-manifest.json"
IMAGE_MAP = ROOT / "aws" / "db" / "data" / "menu-images.json"
ASSETS = ROOT / "aws" / "hosting" / "assets" / "menu"
CREDITS = ROOT / "qa" / "image-credits.json"
BACKUP = ROOT / "qa" / "replaced-originals"

# dish -> which candidate (1-based, as labelled on the contact sheet).
# Only dishes where a candidate genuinely shows the dish. Anything Commons
# could not cover is listed in UNRESOLVED and deliberately left alone: a
# wrong photo is better than a differently-wrong photo, and leaving it makes
# the remaining work visible.
PICKS = {
    "Mineral Water": 5,
    "Palak Dal": 3,
    "Palak Paneer": 2,
    "Cheese Sandwich": 3,
    "Gajar Halwa": 1,
    "Plain Dosa": 2,
    "Grilled Veg Sandwich": 3,
    "Kulfi": 3,
    "Cucumber Salad": 5,
    "Veg Schezwan Fried Rice": 3,
    "Dal Tadka (Spicy)": 1,
    "Dal Fry": 3,
    "Mushroom Kadai": 1,
    "Chicken Tikka": 2,
}

# Wikimedia Commons has no usable photograph of these. Left as they are.
UNRESOLVED = [
    "Chicken Hariyali Kebab", "Hariyali Chicken Tikka", "Chicken Methi Malai",
    "Pepper Chicken", "Egg Roll", "Egg 65", "Egg Chilli", "Mushroom Masala",
    "Baby Corn Hyderabadi", "Chicken Curry", "Buttermilk",
    "Chicken Sweet Corn Soup", "Peas Pulao", "Mushroom Pepper Fry",
    # Best Commons candidate had branded packaging in frame.
    "Chicken Mayo Sandwich",
]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    image_map = json.loads(IMAGE_MAP.read_text(encoding="utf-8"))
    credits = json.loads(CREDITS.read_text(encoding="utf-8")) if CREDITS.exists() else {}
    BACKUP.mkdir(parents=True, exist_ok=True)

    applied = skipped = 0
    for dish, idx in PICKS.items():
        cands = manifest.get(dish) or []
        if not (1 <= idx <= len(cands)):
            print(f"  ! {dish}: no candidate #{idx}")
            skipped += 1
            continue
        rel = image_map.get(dish)
        if not rel:
            print(f"  ! {dish}: not in menu-images.json")
            skipped += 1
            continue

        target = ASSETS / Path(rel).name
        cand = cands[idx - 1]

        # A Full/Half pair shares one file; replacing it updates both, which
        # is correct — they are the same dish.
        sharers = [d for d, p in image_map.items() if p == rel]
        note = f"  (also {', '.join(s for s in sharers if s != dish)})" if len(sharers) > 1 else ""
        print(f"{'DRY ' if args.dry_run else ''}{dish} -> {target.name}{note}")
        if args.dry_run:
            applied += 1
            continue

        if target.exists() and not (BACKUP / target.name).exists():
            shutil.copy2(target, BACKUP / target.name)

        im = Image.open(cand["file"])
        im = ImageOps.exif_transpose(im).convert("RGB")
        # Square-ish crop: the tiles are 16:10 and a portrait photo letterboxed
        # into one is mostly background.
        im = ImageOps.fit(im, (900, 600), method=Image.LANCZOS, centering=(0.5, 0.5))
        im.save(target, "WEBP", quality=82, method=6)

        credits[dish] = {
            "file": rel,
            "source": "Wikimedia Commons",
            "page": cand.get("descurl", ""),
            "title": cand.get("title", ""),
            "licence": cand.get("licence", ""),
            "author": cand.get("author", ""),
            "replaced_on": date.today().isoformat(),
        }
        applied += 1

    if not args.dry_run:
        CREDITS.write_text(json.dumps(credits, indent=2), encoding="utf-8")

    print(f"\napplied {applied}, skipped {skipped}")
    print(f"still wrong, no Commons photo exists ({len(UNRESOLVED)}): {', '.join(UNRESOLVED)}")
    if not args.dry_run:
        print(f"originals backed up to {BACKUP}")
        print(f"credits written to {CREDITS}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

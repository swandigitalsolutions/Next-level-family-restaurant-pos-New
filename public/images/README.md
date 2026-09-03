# Photos for the website

Drop real photos in here **using the exact filenames below** and the site
picks them up automatically (see `lib/images.ts`). Every slot has a target
crop / aspect ratio — match it and there's no layout shift.

The build reads these directly; no import step. After replacing a file,
just refresh (in dev) or rebuild.

## Venue photos — you already have these

| filename | shows | crop (w × h) | where it appears |
|---|---|---|---|
| `venue-hero.jpg` | wide shot of the building + mural wall + forecourt | 1600 × 1200 (4:3) | Home hero image |
| `venue-facade.jpg` | brick front, tricolour pillars, red roof | 1200 × 1400 (portrait) | Gallery (tall) |
| `venue-gate.jpg` | entrance archway with the bilingual sign | 1600 × 1000 (16:10) | About hero, Gallery (wide) |
| `venue-interior.jpg` | dining hall + temple/forest mural + wood ceiling | 1600 × 1000 (16:10) | About, Gallery |
| `mural-warli-woman.jpg` | folk mural of the woman carrying a pot | 1200 × 1400 (portrait) | Home story split, Gallery (tall) |
| `mural-warli-wall.jpg` | white Warli figures on the deep-red wall | 1600 × 1000 (16:10) | About values, Gallery (wide) |
| `garden-pergola.jpg` | garden seating, hanging flower pots on frames | 1600 × 1000 (16:10) | About values, Gallery |
| `juice-stall.jpg` | painted "Fresh Juice" / "Tandoori Chai" counter | 1200 × 1400 (portrait) | About values, Gallery |

### Which of your 9 photos goes where
1. Building wide + parking + mural  → `venue-hero.jpg`
2. Entrance gate sign (Kannada + English) → `venue-gate.jpg`
3. Round logo board close-up → not needed as a photo; the clean logo is `public/logo.jpeg`
4. Fresh Juice / Tandoori Chai stall → `juice-stall.jpg`
5. Brick facade + flag pillars → `venue-facade.jpg`
6. Garden with hanging pots → `garden-pergola.jpg`
7. Woman-with-pot mural building → `mural-warli-woman.jpg`
8. Warli tribal art red wall → `mural-warli-wall.jpg`
9. Interior temple mural + dining hall → `venue-interior.jpg`

> To auto-crop your originals to the sizes above: put the 9 files in
> `public/images/originals/` (any names, alphabetical = order 1–9) and run
> `node scripts/crop-images.mjs`. It writes correctly-cropped versions to
> the slot filenames.

## Food photos — still needed

There were no dish photos in the set. Until real ones arrive these use
temporary stand-ins. Replace with real shots, same filenames:

| filename | dish | crop |
|---|---|---|
| `food-thali.jpg` | Next Level Special Thali | 1000 × 1000 (square) |
| `food-dosa.jpg` | Butter Masala Dosa | 900 × 1040 (portrait) |
| `food-tandoori.jpg` | Tandoori Chicken | 900 × 1040 (portrait) |
| `food-biryani.jpg` | Dum Biryani | 1100 × 830 (4:3) |
| `food-paneer.jpg` | Paneer Butter Masala | 1100 × 830 (4:3) |
| `food-dessert.jpg` | Gulab Jamun & Rabri | 1100 × 830 (4:3) |

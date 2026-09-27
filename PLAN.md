# 3D Clothes Scanner — Plan

## The idea in one line
Scan your body, paste a clothing link, and see **which size actually fits and where** — on your own 3D body, from any angle.

**What makes it different:** most virtual try-on apps show a pretty picture that looks the same in S or XL. Ours is driven by real measurements: the size you pick visibly changes how the garment sits on *your* body.

---

**Platform:** a web app used on the phone (mobile browser, portrait). Must be served over HTTPS so the phone camera works for the scan and so the phone can open it at all (Vercel for the demo, ngrok during development). Desktop is secondary.

## User flow
1. **Scan** — user scans their body with their phone (Bodygram Scanner) → we get ~35 body measurements + a 3D body model (OBJ).
2. **Paste a link** — user pastes a product link (e.g. Zara).
3. **Pull product data** — photos, size chart for every size, fabric. If the live pull fails → use pre-saved demo items.
4. **Fit check** — compare body measurements to each size's garment measurements → recommended size + where it's tight / good / loose.
5. **See it on your body** — 3D body with a garment shape built from the size chart, colored by fit (red = tight, green = good, blue = loose). Switch sizes S/M/L/XL and watch it change. Rotate to any angle.
6. **(Optional) Realistic image** — AI turns the 3D render into a photo-like image while keeping the measured shape.

---

## Architecture

| Part | Tool | Role | Accurate? |
|---|---|---|---|
| Body scan + measurements + 3D body | **Bodygram Platform** | Hosted scanner page + API, returns measurements + OBJ avatar | Yes |
| Product data | Scraper for Zara + **saved demo items** (JSON) | Photos, size chart, fabric | Saved items: yes |
| Fit check | **Our code** (simple math) | Best size + per-region verdicts | Yes |
| Size shown on body | **Our code, three.js** | Garment "shell" built from size-chart numbers around the Bodygram body | Yes — core of the demo |
| Photo-real image (stretch) | Image model that follows a guide image (e.g. FLUX w/ control via Replicate/fal) | Makes the 3D render look real; shape stays from our math | Needs testing |

**Not using FASHN (for now):** it has no size/fit input, so S and XL look nearly identical. Only reconsider it as a "pretty preview", never as the size-accurate view.

---

## Core pieces

### 1. Body scan (Bodygram)
- Create a scan token: `POST https://platform.bodygram.com/api/orgs/{ORG_ID}/scan-tokens`
- Send the user to the hosted scanner: `https://platform.bodygram.com/{locale}/{ORG_ID}/scan?token=...&system=metric` (new tab, or iframe with camera permission + Bodygram SDK).
- Or scan directly by API: `POST /api/orgs/{ORG_ID}/scans` with front + side photos (base64), age, **weight in grams**, **height in mm**, gender. Stats-only scans (no photos) still return measurements + avatar.
- Response: `measurements: [{name, unit, value}]` and `avatar: {data (base64 OBJ), format: "obj"}`.
- **Only 5 free scans.** Save every scan's JSON + OBJ to `data/scans/` and reuse them. Never re-scan to test.
- Phone camera requires **HTTPS** → host on Vercel/Netlify or use ngrok.

### 2. Product data
- **Demo path first:** 3–5 saved items in `data/garments/*.json` with photos, fabric, and a hand-entered size chart.
- **Live path (bonus):** Zara is behind Akamai bot protection; plain requests get blocked. Try a headless browser. If the size chart can't be found in the page data, screenshot it and have Claude read it into JSON.
- Garment JSON shape:
```json
{
  "id": "zara-basic-tee",
  "name": "Basic T-Shirt",
  "category": "top",
  "fabric": "100% cotton",
  "stretch": "low",
  "images": ["..."],
  "chart_type": "garment_flat",
  "sizes": {
    "S": { "chest": 50, "waist": 48, "length": 68, "sleeve": 20, "shoulder": 44 },
    "M": { "chest": 53, "waist": 51, "length": 70, "sleeve": 21, "shoulder": 46 }
  }
}
```

### 3. Fit check (the accurate part)
- **Watch the units:** Zara charts are usually **garment measured flat** (half the circumference) → multiply chest/waist/hip by 2 before comparing to body girths. Some charts are *body* measurements instead — store `chart_type` per item.
- Per region: `ease = garment_circumference − body_circumference`
- Labels depend on garment type and fabric stretch. Starting point for a regular woven top (tune after testing):
  - `ease < 0` → **tight** (red)
  - `0–4 cm` → **snug** (yellow)
  - `4–12 cm` → **good** (green)
  - `> 12 cm` → **loose** (blue)
  - Stretchy fabric: allow slightly negative ease as "snug".
- Length / sleeve: compare garment length to where it lands on the body (hem at hip vs mid-thigh; sleeve above/at/past wrist).
- Recommend the size with no "tight" regions and the most "good" regions.
- Output:
```json
{
  "recommended": "M",
  "sizes": {
    "M": {
      "regions": {
        "chest":  { "ease_cm": 6,  "verdict": "good" },
        "waist":  { "ease_cm": 14, "verdict": "loose" },
        "length": { "lands_at": "mid-hip", "verdict": "good" }
      },
      "summary": "Good through the chest, relaxed at the waist."
    }
  }
}
```

### 4. 3D fit view (the centerpiece)
- three.js page: load the Bodygram OBJ, orbit controls to rotate.
- Build the **garment shell**: copy the torso (and arms) of the body mesh and push it outward by `ease / (2π)` per region, blending smoothly between chest → waist → hip.
- Cut the shell at the garment's real **hem length** and **sleeve length**.
- Color the shell per region by verdict (red / yellow / green / blue), semi-transparent over the body.
- S / M / L / XL buttons → shell visibly changes size and length. This is the "size actually shows on the body" moment.

### 5. Realistic image (stretch goal)
- Render the 3D body + shell from the chosen angle (exact outline).
- Send the render + product photo to an image model that follows the render's shape → photo-like result with the measured silhouette.
- Label it "visual preview"; the 3D view is the source of truth.

---

## Setup checklist
- [x] Bodygram account + API key (in local `.env`)
- [ ] Bodygram **Org ID** in `.env` (`BODYGRAM_ORG_ID`)
- [ ] Hosting with HTTPS (Vercel/Netlify) or ngrok — for the phone camera
- [ ] Replicate or fal account + a few dollars (only for the realism stretch goal)
- [ ] (Optional) Anthropic API key — reading size charts from screenshots
- [ ] Demo person: height, weight, age, gender, 1 full-body photo
- [ ] 3–5 Zara product links for demo items

Secrets go in `.env` (gitignored). `.env.example` lists the variable names.

---

## Build order
1. ~~**One scan** — run one stats-only Bodygram scan, save JSON + OBJ to `data/scans/`.~~ ✅ `data/scans/demo` (4 free scans left)
2. ~~**One garment** — hand-enter a Zara t-shirt size chart into `data/garments/`.~~ ✅ 3 demo items (approximate charts)
3. ~~**Fit check** — function + unit test with the saved scan and garment.~~ ✅ `shared/fit.js`, `npm test`
4. ~~**3D fit view** — OBJ viewer + garment shell + size buttons + fit colors.~~ ✅ `public/js/viewer.js`
5. ~~**App flow** — scan page → paste link / pick item → results.~~ ✅ `public/`
6. ~~**Real charts** — 3 real Zara items (heavyweight tee, slim tee, loose jeans) entered from the product pages' PRODUCT MEASUREMENTS + composition.~~ ✅ Live Zara pull stays blocked (bot protection); charts are entered by hand from screenshots.
7. **Realism test** — render → photo-like image. Keep only if it holds the shape. (not started; the 3D shell now hangs like cloth, has a neckline and a fabric sheen)
8. ~~Real phone scan~~ ✅ (Daniel, via the app) · **Rehearse the demo, record a backup video.**

## Minimum to demo
- [x] A body (saved scan) loads in 3D and rotates
- [x] At least 3 garments with **real** size charts
- [x] Fit check recommends a size and explains tight/loose spots
- [x] Switching sizes visibly changes the garment on the body
- [x] Whole flow runs without depending on live Zara or live scanning
- [x] Real phone scan of the demo person works end to end
- [x] Real product photos on the item cards
- [ ] Demo rehearsed on the phone over the tunnel; backup video recorded

## Risks
| Risk | Plan B |
|---|---|
| Zara blocks scraping / size chart hidden | Saved demo items |
| Only 5 Bodygram scans | Save every result; reuse |
| Scanner needs HTTPS for camera | Deploy early or ngrok |
| AI image ignores the size | 3D view is the proof; image is optional |
| Size chart units (flat vs circumference, body vs garment) | Store `chart_type` per item; double flat widths |

---

## Change tracking
Every change is logged in `CHANGELOG.md` with date, what, why, and files.

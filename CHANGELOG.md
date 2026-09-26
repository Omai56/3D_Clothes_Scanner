# Changelog

Every change made by Claude (AI assistant) is logged here: when, what, why, and which files.

---

## 2026-09-26 — Project setup: secrets handling + changelog
**By:** Claude (Opus 5.5)
**What:**
- Added `.gitignore` (ignores `.env` secrets, `node_modules`, build output, OS/editor files).
- Added `.env.example` listing the environment variables the app needs (real `.env` stays local, not committed).
- Created this `CHANGELOG.md` to track all changes.

**Why:** Bodygram API key received; keys must stay out of GitHub.
**Files:** `.gitignore`, `.env.example`, `CHANGELOG.md`

---

## 2026-09-26 — Replaced PLAN.md with the agreed plan
**By:** Claude (Opus 5.5)
**What:**
- Rewrote `PLAN.md` with the plan discussed with Daniel: Bodygram scan → product link (Zara, with saved demo items as backup) → fit check math → 3D fit view (garment shell built from size-chart numbers, colored by fit, switchable sizes) → optional photo-real image.
- Dropped the old approach (manual form + SMPL + Sketchfab 3D clothes) and FASHN (no size/fit control).
- Added setup checklist, garment/fit-report JSON formats, build order, minimum demo checklist and risks.

**Why:** old PLAN.md didn't match the project direction.
**Files:** `PLAN.md`, `CHANGELOG.md`

---

## 2026-09-26 12:40 — Project scaffold + first Bodygram scan saved
**By:** Claude (Fable 5.1)
**What:**
- `package.json` — Node project (Express server, dotenv). Scripts: `npm start`, `npm run dev`, `npm test`, `npm run scan:stats`.
- `server/bodygram.js` — Bodygram API wrapper: stats-only scan, fetch scan by id, scan-token for the phone scanner, scanner URL builder, mm→cm helper.
- `scripts/run-stats-scan.js` — runs ONE stats-only scan and saves it (refuses to overwrite so we don't burn quota by accident).
- `data/scans/demo.json` + `demo.obj` — development body (placeholder stats 175 cm / 70 kg / 22 / male). 35 measurements, 32k-vertex OBJ in metres, y-up, feet at y=0. **Used 1 of 5 free scans; 4 left.**
- `PLAN.md` — noted the app is a phone web app (mobile browser, HTTPS required).

**Why:** Step 1 of the build order — verified credentials (Org ID `org_4b3RJOjsEEqtn2k4sbbVPT` works) and captured a reusable body so all further development runs from the saved file.
**Files:** `package.json`, `package-lock.json`, `server/bodygram.js`, `scripts/run-stats-scan.js`, `data/scans/demo.json`, `data/scans/demo.obj`, `PLAN.md`, `CHANGELOG.md`

---

## 2026-09-26 — Three-page fit flow (measurements → pick clothes → fit result)
**By:** Claude (Opus 5.5)
**What:**
- `public/index.html` — page 1: form for height, chest, waist, hips, inseam, shoulder width (cm). A body outline beside it highlights the part being filled in, with a tape-measure line. "Fill with demo scan" loads the numbers from `data/scans/demo.json`. Submit saves to the browser and goes to page 2.
- `public/shop.html` — page 2: card grid of 6 demo items (image, brand, name). Tapping one opens page 3.
- `public/result.html` — page 3: body outline coloured per region (green good, yellow slightly tight/loose, red too tight/loose), one-sentence English summary, "Recommended: <size>" badge, garment image. S/M/L/XL tabs to compare sizes.
- `public/app.js` — shared body SVG, demo garment catalogue, fit check (ease = garment − body per region → verdict, recommended size, summary).
- `public/styles.css` — shared styles, phone-first, dark mode.
- `server/index.js` — Express static server for `public/` (`npm start`, port 3000).

**Note:** the 6 garments' size charts and images are placeholders (hand-made numbers, drawn SVG). Replace with real `data/garments/*.json` in build step 2.
**Why:** app flow (build step 5) needed a clickable demo for judges; works without live scanning or scraping.
**Files:** `public/index.html`, `public/shop.html`, `public/result.html`, `public/app.js`, `public/styles.css`, `server/index.js`, `CHANGELOG.md`

---

## 2026-09-26 — Polish the three fit pages (standalone, own demo data)
**By:** Claude (Opus 5.5)
**What:**
- Page 1: cm / inch toggle (values stored in cm), numbered fields, "x of 6 filled" progress bar, per-field error messages, Enter jumps to the next field, caption under the body shows the typed value.
- Page 2: All / Tops / Bottoms filter; every card shows your best size with a coloured fit pill, plus price.
- Page 3: tap a part in the list (or on the body) to show only that area on the body map; "Why this size" box explains what goes wrong one size down and one size up; "Try another item" and "Edit measurements" buttons.
- `public/app.js`: garment category and price, size notes, summary wording no longer repeats the same adjective.

**Why:** improve the pages on their own before combining with the main app. The earlier merge with main is kept on branch `backup-merged-with-main`.
**Files:** `public/index.html`, `public/shop.html`, `public/result.html`, `public/app.js`, `public/styles.css`, `CHANGELOG.md`

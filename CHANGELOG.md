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

## 2026-09-26 13:40 — Working end-to-end app: fit engine + 3D fit view + phone UI
**By:** Claude (Fable 5.1)
**What:**
- `shared/fit.js` — fit engine. Doubles flat chart widths, computes ease per region (chest/waist/hem/shoulders/length/sleeves for tops; waist/hip/thigh/inseam for bottoms), verdicts tight/snug/good/relaxed/very loose with fabric-stretch allowance, size recommendation, plain-English summary + notes.
- `shared/bodyslices.js` — cuts the Bodygram OBJ into 1 cm outline loops (exact mesh/plane intersection), separates torso / arms / legs, clips the fused arm roots above the armpit. Torso rings match Bodygram's own waist & hip girths within 8%.
- `public/js/viewer.js` — three.js viewer: body + garment "shell" built from the size chart (offset = ease/2π per region, cut at real hem/sleeve length, colour by verdict), sleeves as tubes along the arms, legs for bottoms, orbit/pinch controls.
- `public/index.html`, `public/css/style.css`, `public/js/app.js` — phone-first 3-step flow: Body (camera scan via Bodygram hosted scanner, or saved body) → Item (paste link or saved item) → Fit (size chips with BEST badge, 3D view, per-region breakdown).
- `server/index.js` — Express API: `/api/scans`, `/api/scan-session` (+ polling), `/api/garments`, `/api/import`, `/api/fit`; serves `public/`, `shared/`, `data/scans/*.obj`.
- `server/importer.js` — best-effort product import from a store link (og/JSON-LD). Zara returns a bot-protection shell → clear error, UI falls back to saved items.
- `data/garments/*.json` — 3 demo items (tee, oversized hoodie, slim jeans) with **approximate** size charts marked DEMO DATA.
- `tests/` — 16 tests (fit engine + body slicing), `npm test`.

**Verified:** headless Chrome at phone size (390×844): full flow runs with no console errors; S tee = snug shoulders/green body, XL = blue and visibly larger/longer; jeans 32 = green, 36 = blue waist; hoodie = relaxed body, snug sleeves.
**Known limits:** chest ring runs through the shoulder mass (≈17% over Bodygram's bust girth) — visual only, fit math uses Bodygram's numbers directly. Live Zara import blocked; size charts are hand-entered.
**Files:** `shared/`, `public/`, `server/`, `data/garments/`, `tests/`, `package.json`, `CHANGELOG.md`

---

## 2026-09-26 13:55 — README, plan checklist, line endings
**By:** Claude (Fable 5.1)
**What:**
- `README.md` — how to run, how to open on a phone over HTTPS (`npx localtunnel --port 3000`), how it works, how to add a garment.
- `PLAN.md` — build order / demo checklist updated with what's done and what's left.
- `.gitattributes` — LF line endings for everyone (stops the CRLF warnings on Windows).

**Note:** GitHub reports the repo was renamed to `Omai56/Fitting.Room`. The local remote still points at the old name (redirects work); run `git remote set-url origin https://github.com/Omai56/Fitting.Room.git` to update it.
**Files:** `README.md`, `PLAN.md`, `.gitattributes`, `CHANGELOG.md`

---

## 2026-09-26 14:20 — Daniel's real phone scan saved + scan-saving cleanup
**By:** Claude (Fable 5.1)
**What:**
- `data/scans/daniel.json` + `daniel.obj` — Daniel's real Bodygram photo scan from the phone (178 cm / 63 kg, 35 measurements + body composition). Done through the app's "Scan me with the camera" flow → the hosted scanner works end to end on a phone.
- `scripts/save-scan.js` — download any existing scan (by id or `--latest`) into `data/scans/` without using quota.
- `server/bodygram.js` `saveScanFiles()` — one shared saver (server polling + script) that also normalises `input` to cm/kg so saved bodies show their height/weight in the list.
- Removed the duplicate `scan-90afef5d` files the server had saved for the same scan.
- Saved-body labels: "Daniel (phone scan)".

**Verified:** app screenshot with Daniel's body — tee S = green, best fit; M = relaxed blue. Torso rings within 6% of Bodygram girths (waist/hip/thigh).
**Scans used:** 2 of 5 (demo + daniel). 3 left.
**Files:** `data/scans/daniel.*`, `scripts/save-scan.js`, `server/bodygram.js`, `server/index.js`, `CHANGELOG.md`

---

## 2026-09-26 14:50 — Real Zara size chart for the heavyweight tee + fit-engine upgrades
**By:** Claude (Fable 5.1)
**What:**
- `data/garments/zara-heavyweight-tee.json` — real chart from the product page (Basic Heavyweight T-Shirt /03, ref 1887/410/800, S–XXL), converted from inches to cm. Real product photos in `public/img/zara-heavyweight-tee*.png`. Fabric composition still to confirm.
- `shared/fit.js` — new **upper arm** region (chart `arm_width` vs `upperArmGirthR`); **dropped-shoulder detection** (shoulder seam ≥ 90% of chest width on the smallest size → shoulders reported as "good (dropped)" with a note instead of "loose"), decided once per garment so all sizes agree. Optional `shoulder_style` override in the garment JSON.
- `public/js/viewer.js` — sleeve tube width now comes from the chart's arm width when available, coloured by the upper-arm verdict.
- `public/js/app.js` — default body is now the newest phone scan; if a saved body disappears the app refreshes the list instead of failing with "need scan name"; `server/index.js` returns a clear 404 for a missing body.
- `tests/fit.test.js` — chart-driven expectations + dropped-shoulder/upper-arm test (17 tests pass).

**Result for Daniel (real scan × real chart):** S recommended; chest +25 cm (relaxed — boxy cut), upper arm relaxed, hem at the hip, sleeves mid upper arm. M/L very loose in the chest.
**Files:** `data/garments/zara-heavyweight-tee.json`, `public/img/zara-heavyweight-tee*.png`, `shared/fit.js`, `public/js/viewer.js`, `public/js/app.js`, `server/index.js`, `tests/fit.test.js`, `CHANGELOG.md`

---

## 2026-09-26 — Simple 3-page fit flow at /fit/, on real data
**By:** Claude (Opus 5.5)
**What:**
- `public/fit/index.html` — page 1: pick a saved body scan (from `/api/scans`) or type height, chest, waist, hips, inseam, shoulder width. A body outline highlights the part being filled in.
- `public/fit/shop.html` — page 2: card grid of the real garments from `/api/garments` (product photo, brand, name). Items whose chart is still DEMO DATA get a "Sample chart" tag.
- `public/fit/result.html` — page 3: result from `/api/fit` (the shared fit engine). 2D body map coloured per area (green good; yellow snug/relaxed; red tight/very loose), one-sentence English summary, "Recommended: <size>" badge, product image, per-region list, size tabs, engine notes.
- `public/fit/fit-ui.js`, `public/fit/styles.css` — shared drawing and wording. Typed measurements are turned into a full body by scaling the demo scan (the six typed values are used exactly; heights, arm and thigh girths are estimated).
- `README.md` — mention of `/fit/`.

**Why:** a lighter flow for judges that works without a 3D view or a new scan. Moved under `/fit/` so it doesn't clash with the main app at `/`. Replaces the earlier version of these pages that used made-up garments.
**Verified:** headless Chrome, phone and desktop widths. Daniel's scan × heavyweight tee → S (relaxed chest and upper arm, as the engine reports). Typed body × slim jeans → 34.
**Files:** `public/fit/*`, `README.md`, `CHANGELOG.md`

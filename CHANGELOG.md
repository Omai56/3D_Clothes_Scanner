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

## 2026-09-26 15:35 — Three real Zara items, cloth-like 3D shell, waistband/rise logic
**By:** Claude (Fable 5.1)
**What:**
- Real items from product pages (inches → cm, garment measured flat): `zara-heavyweight-tee` (composition confirmed 100% cotton), **new** `zara-slim-tee` (95% cotton 5% elastane → high stretch), **new** `zara-loose-jeans` (100% cotton; Zara's "Front tow hook"/"Backfire" = front/back rise). Real product photos. The two approximate demo charts moved to `data/garments/examples/` (not shown in the app).
- `shared/fit.js`: bottoms now derive **inseam = total length − rise** when no inseam is given; the **waistband is compared to the body girth at the height the waistband actually sits** (crotch + rise, capped at the natural waist) and the summary says where it sits; dropped-shoulder check per size (shoulder ≥ 90% of chest width); stretch allowance also applied (half) to shoulders; shoulder "good" band starts at −1 cm; cropped-leg wording.
- `public/js/viewer.js`: **cloth hangs straight down from the widest point** (chest for tops, mid-thigh for bottoms) instead of hugging the waist/calves; **crew neckline** cut into the top edge; legs coloured by width (thigh/hip) not by length; fabric-like sheen material (MeshPhysicalMaterial).
- Tests: 19 pass (`npm test`), incl. real-chart checks for both new items.

**Daniel's results (real scan × real charts):** heavyweight tee **S** (boxy cut, relaxed), slim tee **L** (M very close), loose jeans **29** (waistband at natural waist, cropped ankle-length leg).
**Files:** `data/garments/`, `public/img/zara-*.png`, `shared/fit.js`, `public/js/viewer.js`, `tests/fit.test.js`, `PLAN.md`, `CHANGELOG.md`

---

## 2026-09-26 15:50 — Loose jeans: description, rise/leg style recorded
**By:** Claude (Fable 5.1)
**What:** `data/garments/zara-loose-jeans.json` — added Zara's description (mid-rise, straight leg hip to ankle, rigid raw denim, model height 187 cm) and `rise_style: mid`, `leg_style: straight`. No inseam is published for this item; it remains estimated as total length − front rise.
**Files:** `data/garments/zara-loose-jeans.json`, `CHANGELOG.md`

---

## 2026-09-26 16:30 — Live Zara import (paste a link → chart, photos, composition)
**By:** Claude (Fable 5.1)
**What:**
- `server/zara.js` — pasting a zara.com product link now imports it live in ~5 s: the installed Chrome is driven headlessly to read the product page (`window.zara.viewPayload`: name, colour, price, description, photos, composition, per-size stock), then Zara's plain-request endpoints give the **full size chart in cm** (`size-measure-guide`) and composition (`extra-detail`). Saves `data/garments/<id>.json` + up to 3 photos in `public/img/` (flat product shot first). Falls back to a clear error (e.g. no measurements published) so the UI offers saved items.
- `server/zara-map.js` — pure mapping of Zara's table titles (incl. machine-translated "Front tow hook" = front rise, "Backfire" = back rise), composition → stretch level, category detection, garment JSON builder.
- `public/js/app.js` — after a successful import the app jumps straight to the fit screen for that item.
- `tests/zara-map.test.js` + fixture `tests/fixtures/zara-size-measure-guide-tee.json` (24 tests pass).
- Both tees re-imported live: `zara-basic-heavyweight-t-shirt-03-545422590`, `zara-basic-slim-fit-t-shirt-01-555813546` (chart straight from Zara in cm; hand-typed versions moved to `data/garments/examples/`). Loose jeans stay hand-typed until we have their link.
- `package.json` — `puppeteer-core` dependency (uses the machine's Chrome/Edge; `CHROME_PATH` override in `.env`).

**Note:** the live import works from a laptop/home IP. Cloud IPs are likely to be blocked by Zara's bot protection, so run the server locally for the demo.
**Files:** `server/zara.js`, `server/zara-map.js`, `server/index.js`, `public/js/app.js`, `tests/zara-map.test.js`, `tests/fixtures/`, `data/garments/`, `public/img/`, `README.md`, `package.json`, `package-lock.json`, `CHANGELOG.md`

---

## 2026-09-26 16:50 — Loose jeans imported live; Tripo3D key + mesh scripts
**By:** Claude (Fable 5.1)
**What:**
- `data/garments/zara-loose-fit-jeans-556169731.json` + photos — live import from the product link (Indigo, CA$69.90, 100% cotton, sizes 28–36 in cm). The hand-typed jeans moved to `data/garments/examples/`. **All three demo items are now straight from Zara.**
- `server/tripo.js`, `scripts/tripo-mesh.js` — Tripo3D image-to-3D helper (upload photo → `image_to_model` task → poll → download GLB to `public/models/`). Experiment for a photo-real garment mesh; `TRIPO_API_KEY` in `.env` (not committed).
**Files:** `data/garments/`, `public/img/zara-loose-fit-jeans-*.jpg`, `server/tripo.js`, `scripts/tripo-mesh.js`, `.env.example`, `CHANGELOG.md`

---

## 2026-09-26 17:15 — Merged Samuel's Meshy pipeline; pre-made GLB support
**By:** Claude (Fable 5.1)
**What:**
- Rebased onto Samuel Zhu's commits (`Add Meshy image-to-3D pipeline`, `Fix 6 bugs found in architecture review`). Kept all his fixes; resolved the `.env.example` conflict by listing both `MESHY_API_KEY` and `TRIPO_API_KEY`.
- `public/js/app.js` — if a garment JSON has `model.glb` (a GLB already in `public/models/`, e.g. made with `scripts/tripo-mesh.js` or downloaded by hand from the Tripo/Meshy web apps), the viewer loads it directly instead of starting a Meshy job.
- Tripo API status: the key works but the API wallet has **0 credits** (the 200 free credits are web-app only; API task creation fails with code 2010). No mesh generated yet.
**Files:** `public/js/app.js`, `.env.example`, `CHANGELOG.md`

---

## 2026-09-26 17:50 — First photo-real garment mesh (Tripo) + Look / Fit toggle
**By:** Claude (Fable 5.1)
**What:**
- `public/models/zara-basic-heavyweight-t-shirt-03-545422590.glb` — Daniel generated the tee from its flat product photo in the Tripo web app (model v2.5; v3.1 looked better but export needs a paid plan). Optimized with gltf-transform: 257k → 76k vertices, 16.7 MB → 5.6 MB (quantized, loads in three.js without extra decoders). Linked via `model.glb` in the garment JSON.
- `public/js/viewer.js` `loadGarmentModel` — the mesh is sized from the **chart**: height = garment length on this body; width/depth scale by the selected size's chest (or hip) and length ratios vs the smallest size, so S and XL of the same mesh visibly differ. Materials forced to matte cloth (roughness/metalness maps dropped; AI exports look like latex otherwise). GLB is cached per URL so switching sizes is instant.
- **Look / Fit toggle** on the viewer (`#view-mode`): Look = photo-real mesh, Fit = measured shell coloured by fit. The toggle appears only when a mesh exists; without one the shell shows as before. ("Both" was tried and dropped — the two surfaces interleave into a blotchy mess.)
- `public/js/app.js` — garments with `model.glb` load it directly (no Meshy call); toggle wiring.

**Verified:** headless phone screenshots — Look S vs XL differ in width and length; Fit view unchanged; no console errors; 24 tests pass.
**Files:** `public/models/*.glb`, `data/garments/zara-basic-heavyweight-t-shirt-03-545422590.json`, `public/js/viewer.js`, `public/js/app.js`, `public/index.html`, `public/css/style.css`, `CHANGELOG.md`

---

## 2026-09-26 18:20 — Garment mesh calibrated to body + chart (fixes body poking through the back)
**By:** Claude (Fable 5.1)
**What:** `public/js/viewer.js` `loadGarmentModel` now sizes each axis from what we actually know:
- **Length** from the chart (garment length on this body).
- **Depth** from the body: front-to-back extent of the torso rings over the covered height range + ease + margin. A mesh made from a flat photo has no real depth, which is why the back showed through before.
- **Width** from the chart: circumference = 2 × flat width; worn, the garment is ~an ellipse with that perimeter and the depth above, so the visible width is the ellipse's major axis (56 cm flat ≈ 42 cm worn for S; XL ≈ 48 cm). The mesh's own hem width (measured from its bottom 12% of vertices) is scaled to that, so sleeves scale along.
- Mesh centred on the torso's actual x/z centre. `window.__viewer` exposed for debugging.
**Verified:** headless screenshots front (S, XL), back and side — body fully enclosed, sizes differ, no console errors; 24 tests pass.
**Files:** `public/js/viewer.js`, `public/js/app.js`, `CHANGELOG.md`

---

## 2026-09-26 19:40 — Meshes for all three items; trousers reshaped onto the body
**By:** Claude (Fable 5.1)
**What:**
- `public/models/` — Tripo (v2.5, web export) meshes for the slim tee and the loose jeans (Daniel generated them; files were saved under swapped names and fixed by inspecting each mesh's proportions). Optimized with gltf-transform (quantize; jeans kept unsimplified because simplification cracked the dark denim texture). Linked via `model.glb` in each garment JSON.
- `public/js/viewer.js` — **trousers deformer** (`_deformBottoms`): a flat-lay mesh is remapped vertex by vertex onto the body. Height: mesh hem → ankle-clamped hem, mesh crotch (detected as the highest band with no geometry on the centre line) → the height where the body's legs split, mesh top → waistband height from the rise. Cross-section: each vertex's position across the flat garment becomes an **angle** on the body's own ring at that height (front layer on the front half, back layer on the back half); rings are sampled smoothly in height and angle. Hips/waist: ring scaled to the chart circumference (or pushed out by the ease if larger). Legs: each leg wraps its own body leg, never narrower than the thigh (straight leg), blended into the hip mapping over the last 6 cm below the crotch. Sealed hems are cut open.
- Fixed: recomputed normals were written into the file's quantized int16 buffer (black speckle) — normals are rebuilt as float32 on load.
- Debug hook: `window.__debugBottoms = true` before load makes the viewer record per-height targets/extents (`__viewer.debugBottoms`).

**Verified:** headless renders of the jeans front (29 vs 34), side and back — enclosed everywhere, sizes differ; slim tee front/side; heavyweight unchanged; no console errors; 24 tests pass.
**Files:** `public/models/*.glb`, `data/garments/*.json`, `public/js/viewer.js`, `CHANGELOG.md`

---

## 2026-09-26 21:10 — Tops now drape on the body: ring-wrapped torso, sleeves along the arms, shoulder drape
**By:** Claude (Fable 5.1)
**What:** `public/js/viewer.js` `_deformTop` replaces the scale-and-place approach for tops (same idea as the trousers):
- **Torso** below the shoulder line: each vertex is placed by angle on the body's own ring at its height, pushed out by the chart's radial ease (chest circumference vs body), never narrower than the chest below the bust (cloth hangs). Result: the tee follows the chest/back instead of floating as a rigid box.
- **Collar zone** (above the shoulder line): the mesh's own collar/shoulder shape, scaled to the chest, blended into the ring mapping over 5 cm — no more turtleneck.
- **Shoulder drape:** a height map of the shoulder tops (armpit → just below the neck base, head excluded) lifts any cloth that would sit inside the shoulders onto the surface (max 5 cm), bilinear so it doesn't step.
- **Sleeves:** detected along each sleeve's own axis in the flat mesh (shoulder seam → cuff centre; flat-lay sleeves hang diagonally), width measured from the mesh; each sleeve becomes a tube of the chart's arm circumference along the scanned arm direction from the shoulder point. Underarm cloth beside the sleeve stays with the torso (was collapsing into stripes).
- Look/Fit semantics: Look always encloses the body (a tight garment hugs with a small gap); Fit shows where it's tight/loose in colour.
**Verified:** headless renders — heavyweight tee S/XL front + side, slim tee front + back, jeans regression: enclosed everywhere, no console errors; 24 tests pass.
**Files:** `public/js/viewer.js`, `CHANGELOG.md`

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

---

## 2026-09-26 — Livelier body figure + premium visual redesign of the three pages
**By:** Claude (Opus 5.5)
**What:**
- Body figure (`public/app.js`): natural proportions with hair, face, bent elbows, knees, skin shading and floor shadow. On page 1 it breathes, blinks and sways; a yellow tape wraps around the body (girths) or runs with arrows (lengths) with a value tag; it hops with sparkles when all six measurements are in; tapping a body part focuses that field. Page 3 uses the same figure, static.
- Design system (`public/styles.css`): Fraunces display serif + Inter UI font (Google Fonts), warm ivory background with soft gradient glows, layered card shadows, frosted sticky top bar with logo mark and labelled steps (Measure / Choose / Fit), studio-style backdrop behind the figure, gradient buttons, inset inputs, spotlight + drop shadow on garment images, refined fit colours, dark mode.
- Markup (`public/index.html`, `shop.html`, `result.html`): new header, eyebrow labels, stage wrapper for the figure.

**Files:** `public/*`, `CHANGELOG.md`

---

## 2026-09-26 — Page 2: try on from a pasted product link
**By:** Claude (Opus 5.5)
**What:**
- `public/shop.html`: "Try on from a link" panel. Paste any store's product link (one-tap Paste button where the browser allows it). The page shows the detected store, product name and garment type; the type can be changed before "Try it on". Pasted items are kept under "From your links" (this browser only, up to 12) with a remove button, and follow the Tops/Bottoms filter.
- `public/app.js`: `parseProductLink` (store from the domain, name and colour from the URL slug, type from keywords), `makeCustomGarment`, and saved-link storage. `getGarment` also finds pasted items.
- `public/result.html`: pasted items show a notice that a standard size chart for the type was used, plus a "View on <store>" link.

**Limit:** the store's real size chart and photos are not read (no server-side fetching in this version), so results for pasted links are estimates.
**Files:** `public/shop.html`, `public/result.html`, `public/app.js`, `public/styles.css`, `CHANGELOG.md`

---

## 2026-09-26 — Page 2: 3D wardrobe replaces the clothes grid
**By:** Claude (Opus 5.5)
**What:**
- `public/shop.html`: removed the demo clothes grid and filters under the link box. Added "Your wardrobe": a CSS 3D wooden wardrobe whose doors swing open (mirrors on the inside), with a lit interior, hanging rail and every item tried from a link hung on a hanger with a size dot and name tag. Tap a piece to see its fit again, × to take it out. Empty wardrobe offers "Hang some sample pieces" for demos. Open/closed state is remembered for the session and the wardrobe opens automatically when you come back from a fit.
- `public/result.html`: back link and main button go "Back to wardrobe"; viewing a pasted item moves it to the front of the rail.
- `public/styles.css`: wardrobe styles (wood, interior walls, doors, hangers, swing animation, dark-mode walnut).
**Files:** `public/shop.html`, `public/result.html`, `public/styles.css`, `CHANGELOG.md`

---

## 2026-09-26 — Wardrobe: real 3D clothes + paged rails
**By:** Claude (Opus 5.5)
**What:**
- `public/wardrobe3d.js` (new, three.js 0.169 from jsDelivr): the wardrobe interior is a live 3D scene. Each garment outline is "inflated" into a closed cloth mesh with drape wrinkles (quilted puffs for the jacket), fabric bump textures (knit / denim twill / nylon) and sheen. Details per type: tee rib collar; shirt collar, placket, buttons, pocket; hoodie hood, drawstrings, kangaroo pocket, rib hem; jacket collar and zipper; jeans/chinos waistband, belt loops, rivets. Garments hang on wooden hangers with chrome hooks (clip hangers for trousers) from a chrome rail, lit with a studio environment and casting soft shadows on the back wall. They sway gently; hovering lifts and turns a piece to show its depth; new rails slide in.
- `public/shop.html`: rails are paged (3 per rail on desktop, 2 on phones) with arrow buttons, page dots and swipe. Labels, size chips and remove buttons are HTML laid exactly under each 3D garment. If three.js can't load (offline), the flat hangers are used with the same paging. Six sample pieces for demos.
- `public/styles.css`: pager, arrows, 3D overlay styles.
**Files:** `public/wardrobe3d.js`, `public/shop.html`, `public/styles.css`, `CHANGELOG.md`

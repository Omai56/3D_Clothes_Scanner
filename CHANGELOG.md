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

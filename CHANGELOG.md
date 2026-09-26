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

# 3D Clothes Scanner — FitCheck

Scan your body, paste a clothing link, and see **which size actually fits and where**, on your own 3D body, from any angle.

See [PLAN.md](PLAN.md) for the plan and [CHANGELOG.md](CHANGELOG.md) for every change.

## Run it

```bash
npm install
cp .env.example .env     # then fill in the Bodygram key + org id (ask Daniel)
npm start                # http://localhost:3000
npm test                 # fit engine + body slicing tests
```

`npm run dev` restarts the server when files change.

## Use it on a phone

The app is built phone-first. The phone needs to reach your laptop over **HTTPS** (the Bodygram scanner needs the camera, which browsers only allow on HTTPS).

Quickest option, no account needed:

```bash
npx localtunnel --port 3000
```

Open the printed `https://….loca.lt` link on the phone. (First visit shows a "tunnel password" page: the password is your laptop's public IP, which the page tells you how to get.)

Alternatives: `ngrok http 3000` (needs a free ngrok account) or `cloudflared tunnel --url http://localhost:3000`.

## How it works

| Step | What happens | Where |
|---|---|---|
| Body | Bodygram hosted scanner (2 photos) → 35 measurements + 3D body (OBJ). Saved bodies live in `data/scans/`. | `server/bodygram.js`, `scripts/run-stats-scan.js` |
| Item | Paste a link (best-effort import) or pick a saved item with a size chart. | `server/importer.js`, `data/garments/*.json` |
| Fit | Garment vs body per region → ease in cm → tight / snug / good / relaxed → best size + explanation. | `shared/fit.js` |
| 3D | Body sliced into 1 cm outlines; a garment shell is built from the size chart (offset by ease, cut at real length) and coloured by fit. | `shared/bodyslices.js`, `public/js/viewer.js` |

**Only 5 free Bodygram scans.** Every scan is saved to `data/scans/` and reused. Don't re-scan to test — use the saved `demo` body.

## Adding a garment

Create `data/garments/<id>.json` (copy an existing one). `chart_type: "garment_flat"` means the chart gives widths measured flat (half the circumference), which is what Zara publishes. Length = back neck to hem; sleeve = shoulder seam to cuff.

## Secrets

`.env` is gitignored. Never commit keys.

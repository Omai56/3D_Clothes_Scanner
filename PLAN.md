# 3D Clothes Scanner — Hackathon Plan

## Goal

Build a working demo that shows: user enters their measurements → selects a garment → gets a fit score and visual result. Judges should walk away understanding the idea immediately.

No accounts, no real brand partnerships, no servers to set up. Hardcode what you have to. Ship the demo.

**Team size: 4 people**

---

## Team Assignments

### Person 1 — Body Input + Server

**Goal:** Get user measurements into the system and wire everything together on the server side.

**Body input:**
- Build a simple form: height, chest, waist, hips, inseam, shoulder width
- When the user submits, send those numbers to the server

**Server (keep it simple):**
- One route: `/fit` — receives body measurements + which garment was selected, returns a fit report
- The garment catalog is just a file sitting in a folder (no database needed)
- Store the 3D clothing files and their measurements in a local folder called `/assets`

**Recommended tools:** FastAPI (Python) or Express (Node) — pick whichever your team knows fastest.

**You do not need:** user accounts, a database, or any cloud storage.

**Stretch goal:** If you have an iPhone 12 Pro+, you can use the phone's built-in body scanning to capture a real 3D scan instead of the form — impressive visually, but do not let the whole demo depend on it.

**Deliverable by demo:**
- Measurement form working, passes numbers to the server
- The `/fit` and `/garments` routes running on your laptop

---

### Person 2 — Clothing Models + Fit Scoring

**Goal:** Get the 3D clothing files ready and write the logic that scores how well a garment fits.

**Clothing models (find them, do not build from scratch):**
- Download free clothing models from Sketchfab (filter by free license) or TurboSquid free section
- Target 3 to 5 garments: a t-shirt, jeans, a hoodie, a jacket, a dress
- For each garment, manually write down its key measurements in a data file: chest width, waist width, hip width, total length, shoulder width — these are the numbers we compare against the user's body

**Fit scoring:**
- Write a function: `fitCheck(bodyMeasurements, garmentMeasurements)` → returns a fit report
- The logic is simple: subtract the garment measurement from the body measurement to get "ease" (how much extra room there is), then label it

```
fit_report = {
  "overall": "good fit" or "tight" or "loose",
  "regions": {
    "chest":     { "extra_room_cm": +4,  "verdict": "good" },
    "waist":     { "extra_room_cm": -1,  "verdict": "tight" },
    "hips":      { "extra_room_cm": +8,  "verdict": "loose" },
    "length":    { "extra_room_cm": +2,  "verdict": "good" },
    "shoulders": { "extra_room_cm":  0,  "verdict": "good" }
  },
  "size_recommendation": "M",
  "notes": "Waist runs small — size up if between sizes."
}
```

**How to label the extra room:**
- Less than -1 cm: too tight
- -1 to +2 cm: snug / fitted
- +2 to +6 cm: good fit
- More than +6 cm: too loose

**Size recommendation:** run the fit check against Small, Medium, Large, and Extra Large measurements for that garment, and recommend whichever size has the most "good" regions.

**Deliverable by demo:**
- 3 to 5 garment files with their measurements written down
- `fitCheck` function working and plugged into Person 1's server

---

### Person 3 — What the User Sees (the App)

**Goal:** Build the visual app that the user actually interacts with — and that judges watch during the demo.

The app has three pages the user moves through in order:

**Page 1 — Enter your measurements**
This is the starting point. The user sees a simple form asking for their height, chest, waist, hips, inseam, and shoulder width. As they fill it in, a simple body outline drawing on the side highlights the body part they are measuring. When they hit submit, it moves to the next page.

**Page 2 — Pick a clothing item**
The user sees a grid of clothing cards — like browsing a clothing website. Each card shows a photo of the item, its name, and a fake brand logo (Nike, Hollister, whatever looks good). The user clicks one item to select it and move forward.

**Page 3 — See how it fits**
This is the most important page and what judges will remember. It shows:
- A body outline drawing with each body region colored in — green means it fits well there, yellow means it is snug, red means it is too tight or too loose
- A plain-English sentence underneath, like: "Good fit in the chest and shoulders. The waist runs a little tight — consider sizing up."
- A clear size recommendation, like a badge that says "Recommended: Medium"
- The clothing item shown next to or on the body

**Recommended tools:** React for building the pages, Tailwind for making it look good fast.

**Deliverable by demo:**
- All 3 pages working and connected to Person 1's server
- Looks polished enough to show on a laptop in front of judges

---

### Person 4 — 3D Body Avatar

**Goal:** Build the centerpiece of the entire demo — a 3D body figure shaped to the user's actual measurements, with the selected clothing item shown on it.

This is the thing that makes the demo look like real technology and not just a spreadsheet. When the user enters their measurements and picks a jacket, they should see a 3D figure that roughly looks like their body wearing that jacket — and be able to spin it around.

**Step 1 — Build the body figure from measurements**
Take the measurements Person 1 collected (chest, waist, hips, height, etc.) and use them to generate a 3D body shape. You do not need to build this from scratch — use a free pre-built body model called SMPL (download at smpl.is.tue.mpg.de). It takes body measurements as input and outputs a realistic human body shape. Load it into the browser using Three.js (a free tool for showing 3D things in a web browser).

The result: every user gets a figure that is shaped like them, not a generic mannequin.

**Step 2 — Put the clothing on the body**
Take the 3D clothing file from Person 2 and position it on the body figure. It does not need to simulate real fabric physics — just place it on the body and scale it to fit. The garment sits on the figure the same way a photo layer sits over an image.

Color-code the garment on the body to match the fit report from Person 2 — green where it fits well, red where it is tight. This makes the fit result visual and immediate.

**Step 3 — Make it interactive**
The user should be able to click and drag to spin the figure around 360 degrees. That single interaction makes the demo feel polished and real. Three.js handles this in about 10 lines of code.

**Deliverable by demo:**
- A 3D body figure that changes shape based on the user's measurements
- The selected clothing item shown on the figure, color-coded by fit
- The figure is spinnable in the browser
- Plugged into Person 3's result page

---

## Pitch (Everyone, Hour 20–22)

Do this together as a team — it is not one person's job.

- Write a 60-second problem statement: "When you shop for clothes online, you have no idea if they will fit. 40% of everything bought online gets returned, mostly because of fit. We built a tool that tells you exactly how a piece of clothing will fit your body before you buy it."
- Walk through the app live. Practice it at least twice so it feels smooth.
- Record a backup video of the full demo in case something breaks on stage.

---

## Hackathon Timeline

Assumes about 24 hours. Adjust to your actual schedule.

| Time | What the team is doing |
|------|------------------------|
| Hour 0–2 | Agree on tools, set up a shared code repository, split up tasks |
| Hour 2–8 | Everyone builds their own piece independently |
| Hour 8–12 | First connection — link the app screens to the server and fit scoring |
| Hour 12–18 | Fix bugs, clean up the look, add the 3D view |
| Hour 18–22 | Full flow working end to end, rehearse the pitch |
| Hour 22–24 | Final polish, record the backup demo video |

---

## Minimum Required to Demo

- [ ] User can enter body measurements
- [ ] User can browse at least 3 garments
- [ ] Selecting a garment triggers a fit check
- [ ] Fit result shows color-coded body regions and a size recommendation
- [ ] The whole flow runs without crashing in front of judges
- [ ] Pitch script rehearsed at least once

---

## Stretch Goals (only if the core is done early)

- Live body scan using an iPhone's built-in depth camera instead of the manual form
- 3D body figure with the garment draped on it
- Multiple size options per garment with automatic comparison
- A "try another size" button that re-runs the fit check
- Fake brand logos and product page styling to make it feel like a real app

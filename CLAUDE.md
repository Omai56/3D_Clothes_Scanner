# 3D Clothes Scanner — Project Overview

## Core Idea

An app that solves the online shopping fit problem: users don't know if clothes will fit or look good on them before buying.

**How it works:**
1. User scans their body (or a specific body part) using an existing 3D body scanner
2. We receive 3D clothing models from partner brands (e.g., Hollister, Nike)
3. The clothing model is fitted/draped onto the user's 3D body model
4. User sees a realistic preview of how the item looks and fits on *them specifically*

## Goal

Improve online shopping UX and reduce returns by giving users a personalized, accurate virtual try-on experience.

## Key Components

- **Body scanning integration** — interface with existing 3D body scanner hardware/apps (e.g., Fit3D, Styku, phone-based LiDAR)
- **3D clothing models** — pipeline for ingesting brand-provided garment models or generating them from product photos
- **Cloth simulation / fitting engine** — drape and deform clothing onto the user's body mesh
- **Brand partnerships** — API or asset pipeline for Nike, Hollister, and other retailers to supply garment data
- **User-facing app** — display the fitted result, show size recommendations, flag fit issues

## Open Questions / To Decide

- What body scanner format do we target first (phone LiDAR, dedicated scanner, manual measurements)?
- Do we source 3D clothing models from brands directly, or generate them from 2D product images?
- What cloth simulation library/engine do we use (Marvelous Designer export, real-time GPU sim, etc.)?
- Web app, mobile app, or browser plugin that layers onto existing retail sites?

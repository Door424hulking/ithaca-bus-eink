# Ithaca Bus E-ink

Ithaca Commons → Carpenter Hall / Sage Hall → walk to Cornell Rhodes Hall.

Cloud deployment is live on Render. A cron job fetches fresh TCAT data and uploads a 400×300 monochrome board to Zectrix page 2 every ten minutes. The computer does not need to remain on. The display still needs power, Wi-Fi, and its own synchronization cycle.

- [Run history](https://dashboard.render.com/cron/crn-dbrro63l550s73elgrqg/runs)
- [中文使用说明与验证记录](README_中文.md)

Verified on November 13, 2026 (EST): 21 server-side tests passed; manual push at 20:41 and scheduled push at 20:43 both succeeded. The Windows updater was disabled before the scheduled run.

Secrets are supplied only through environment variables. Never commit .env.

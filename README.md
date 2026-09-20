# QueueMate

**Digital Queue Management System** — *’Wag nang mag-antay, sa app nalang magbantay!*

Scan a QR code at the counter, get a queue number on your phone, leave the physical line, and get alerted about 5 minutes before your turn.

Group 2 — Galvez, Go, Huang, Villanueva · EMERTEC

## What's in it

| Screen | Route | What it does |
| --- | --- | --- |
| Queue (home) | `#/` | Your active tickets, scan button, queues on this device |
| Scan | `#/scan` | Camera QR scanner, or type the code printed under the QR |
| Ticket | `#/ticket/…` | Live number, people ahead, estimated wait, alerts, leave queue |
| Staff console | `#/staff` | Call next, call again, no-show, walk-ins, counters, stats, CSV export |
| QR poster | `#/staff/<queue>/qr` | Printable poster; the code changes every day |
| Display board | `#/display/<queue>` | "Now serving" screen for a TV or monitor |

It is an installable PWA (manifest + service worker), works offline, and needs no build step — plain HTML, CSS and ES modules.

## Single-device demo

This build has no server. All data lives in the browser's `localStorage`, so the customer view, staff console and display board stay in sync **across tabs on the same device**, but two different phones do not share a queue.

**Demo mode** (on by default, see Settings) fills a queue with sample people when you join and moves the line automatically, so one phone can show the whole journey: waiting → "almost your turn" → called → served. Turn it off to run the queue by hand from the Staff tab.

Alerts (notification, chime, vibration) fire while the app is open or in the background; true push notifications to a closed app would need a server.

## Run locally

```bash
python -m http.server 5173
```

Then open http://localhost:5173. After changing any file, bump `VERSION` in `sw.js` so installed copies pick up the update.

## Credits

QR generation: [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) (MIT). QR scanning fallback: [jsQR](https://github.com/cozmo/jsQR) (Apache-2.0).

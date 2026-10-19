# Roadmap & Schedule — Full-stack v2

A responsive study roadmap for students preparing for government recruitment exams alongside college. Frontend uses plain HTML/CSS/JavaScript; backend uses Node.js + Express. The backend periodically checks configured sources and records new RSS items or official-page changes. Personal checklists and mock-test records are stored locally in the visitor's browser.

## Requirements
- Node.js 20 or newer
- npm
- Internet access for the official source monitor and optional Google Fonts

## Run locally in VS Code
1. Extract/open this folder in VS Code.
2. Open Terminal → New Terminal.
3. Run `npm install`
4. Run `npm start` (or `npm run dev` for Node's watch mode).
5. Open `http://localhost:3000` in Chrome.

Do not open `public/index.html` directly as a file; use the server so the `/api` endpoints work.

## Backend and monitoring
- `GET /api/health` — health check.
- `GET /api/config` — app dates and configured source metadata.
- `GET /api/notifications` — latest detected items and source status.
- `POST /api/admin/refresh` — manually refresh configured sources.
- `POST /api/feedback` — validation-only feedback endpoint; does not save personal feedback.
- `sources.json` — configure monitored source URLs. `type: "page"` monitors page changes; `type: "rss"` reads an RSS/Atom feed URL.
- Polling defaults to every 60 minutes and is clamped to 15–1440 minutes. Set `POLL_MINUTES=60` to change it.
- Optional: set `ADMIN_TOKEN` to require the `x-admin-token` header for manual refresh. Without it, the refresh endpoint is public; set a token for a deployed public service.
- State is persisted in `data/state.json`. Ensure the hosting platform supports persistent disk if you want notifications to survive restarts.

### Important monitoring limitations
Official recruitment portals may block automated requests, change page markup, rate-limit, or publish notices in ways a generic monitor cannot parse. A page-change alert is **not** proof that a new vacancy exists. RSS feeds are preferred when a source provides a reliable official feed. Review every notice on the official website. Do not treat this tool as a guaranteed or complete notification service.

### Production deployment notes
For a public production deployment, use a host that supports a long-running Node server and persistent storage (for example, a VPS or a suitable Node application platform). Static-only hosting such as GitHub Pages cannot run this backend. Configure HTTPS, `ADMIN_TOKEN`, monitoring/backup for `data/state.json`, and platform terms/rate limits before deployment. For multiple server instances, replace JSON persistence with a database and move scheduled jobs to a single worker. Do not add user accounts or store personal data without appropriate authentication and privacy protections.

## Frontend features
- Dashboard, 6-month roadmap, weekly schedule, syllabus, 26-week checklist, mock test tracker, recruitment monitor and official resource links.
- Checklist and mock-test data are saved in the browser's localStorage; they do not sync between browsers/devices.
- Search, light/dark theme, responsive mobile menu, progress bars, progress JSON export, and motivational pop-ups.
- Motivational messages are local UI messages, not messages scraped from recruitment websites. Official source changes appear in the notification area and may trigger an in-app reminder.

## Recruitment eligibility
The roadmap is a general study plan, not an official syllabus. Verify qualifications, age rules, deadlines and the detailed syllabus in each official notification.

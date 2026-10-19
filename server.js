'use strict';
const express = require('express');
const helmet = require('helmet');
const cron = require('node-cron');
const Parser = require('rss-parser');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const SOURCES_FILE = path.join(ROOT, 'sources.json');
const parser = new Parser({ timeout: 12000, headers: { 'User-Agent': 'RoadmapSchedule/2.0 (public recruitment notice monitor)' } });
fs.mkdirSync(DATA_DIR, { recursive: true });

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(ROOT, 'public')));

function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeState(state) {
  const tmp = STATE_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, STATE_FILE);
}
function getState() {
  return readJSON(STATE_FILE, { notifications: [], seenItems: [], sourceStatus: [], updatedAt: null });
}
function getSources() { return readJSON(SOURCES_FILE, []); }
function hash(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function safeText(v, max = 300) { return String(v || '').replace(/[<>]/g, '').trim().slice(0, max); }

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'roadmap-schedule', time: new Date().toISOString() }));
app.get('/api/config', (_req, res) => {
  res.json({ appName: 'Roadmap & Schedule', startDate: '2026-10-19', endDate: '2027-04-18', pollMinutes: Number(process.env.POLL_MINUTES || 60), sources: getSources().map(({ id, name, url, enabled, note }) => ({ id, name, url, enabled, note })) });
});
app.get('/api/notifications', (req, res) => {
  const limit = Math.min(100, Math.max(1, Number(req.query.limit || 30)));
  const state = getState();
  res.json({ items: state.notifications.slice(0, limit), updatedAt: state.updatedAt, sourceStatus: state.sourceStatus });
});
app.get('/api/notifications/:id', (req, res) => {
  const item = getState().notifications.find(n => n.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Notification not found' });
  res.json(item);
});

// Manual progress data is stored in the visitor's browser. This endpoint is a
// simple server-side validation endpoint for optional future integrations.
app.post('/api/feedback', (req, res) => {
  const message = safeText(req.body && req.body.message, 500);
  if (!message) return res.status(400).json({ error: 'Message is required' });
  // Intentionally do not persist personal feedback or identifying information.
  res.status(202).json({ accepted: true, message: 'Thanks. Feedback was accepted for this session.' });
});

async function checkPageSource(source) {
  const response = await fetch(source.url, { redirect: 'follow', signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'Mozilla/5.0 (compatible; RoadmapScheduleNoticeMonitor/2.0)' } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const html = (await response.text()).slice(0, 2_000_000);
  // Hash only a normalized title + visible text approximation; a change is not proof of a vacancy.
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || ['', ''])[1].replace(/\s+/g, ' ').trim();
  const text = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 250000);
  return { signature: hash(`${title}\n${text}`), title, excerpt: text.slice(0, 500), status: 'ok' };
}
async function checkRssSource(source) {
  const feed = await parser.parseURL(source.url);
  return { items: (feed.items || []).slice(0, 30).map(item => ({ title: safeText(item.title, 250) || 'Untitled notice', url: item.link || source.url, date: item.isoDate || item.pubDate || null, summary: safeText(item.contentSnippet || item.summary || '', 500) })) };
}
async function refreshSources() {
  const sources = getSources().filter(s => s.enabled);
  const state = getState();
  const seen = new Set(state.seenItems || []);
  const oldStatuses = new Map((state.sourceStatus || []).map(s => [s.id, s]));
  const statuses = [];
  const created = [];

  for (const source of sources) {
    const now = new Date().toISOString();
    try {
      if (source.type === 'rss') {
        const feed = await checkRssSource(source);
        for (const item of feed.items) {
          const key = hash(`${source.id}|${item.title}|${item.url}`);
          if (!seen.has(key)) {
            seen.add(key);
            created.push({ id: key.slice(0, 18), sourceId: source.id, sourceName: source.name, title: item.title, url: item.url, publishedAt: item.date, summary: item.summary || 'New item in the configured feed.', kind: 'notice', createdAt: now, verified: false, label: 'Review official notice' });
          }
        }
        statuses.push({ id: source.id, name: source.name, url: source.url, status: 'ok', checkedAt: now, message: `Feed checked; ${feed.items.length} recent items read.` });
      } else {
        const result = await checkPageSource(source);
        const old = oldStatuses.get(source.id);
        if (old && old.signature && old.signature !== result.signature) {
          const key = hash(`${source.id}|page-change|${result.signature}`);
          if (!seen.has(key)) {
            seen.add(key);
            created.push({ id: key.slice(0, 18), sourceId: source.id, sourceName: source.name, title: `${source.name}: official page changed`, url: source.url, publishedAt: now, summary: 'The monitored official page changed. This may be a routine website update, not a new vacancy. Open the official page and verify the notice manually.', kind: 'page-change', createdAt: now, verified: false, label: 'Check official website' });
          }
        }
        statuses.push({ id: source.id, name: source.name, url: source.url, status: 'ok', checkedAt: now, signature: result.signature, message: old && old.signature === result.signature ? 'No page change detected.' : old ? 'Page changed; review the official page.' : 'Baseline saved. Changes will be compared on future checks.' });
      }
    } catch (err) {
      statuses.push({ id: source.id, name: source.name, url: source.url, status: 'error', checkedAt: now, message: safeText(err.message, 180) });
    }
  }
  state.notifications = [...created, ...(state.notifications || [])].slice(0, 200);
  state.seenItems = [...seen].slice(-1500);
  state.sourceStatus = statuses;
  state.updatedAt = new Date().toISOString();
  writeState(state);
  return { checked: sources.length, added: created.length, statuses };
}
let refreshInProgress = false;
app.post('/api/admin/refresh', async (req, res) => {
  const secret = process.env.ADMIN_TOKEN;
  if (secret && req.get('x-admin-token') !== secret) return res.status(401).json({ error: 'Unauthorized' });
  if (refreshInProgress) return res.status(409).json({ error: 'A refresh is already running' });
  refreshInProgress = true;
  try { res.json(await refreshSources()); }
  catch (e) { res.status(500).json({ error: safeText(e.message, 200) }); }
  finally { refreshInProgress = false; }
});

// Check periodically. Set POLL_MINUTES to a sensible value; avoid aggressive polling.
const pollMinutes = Math.min(1440, Math.max(15, Number(process.env.POLL_MINUTES || 60)));
cron.schedule(`*/${pollMinutes} * * * *`, async () => {
  if (refreshInProgress) return;
  refreshInProgress = true;
  try { const result = await refreshSources(); console.log(`[monitor] checked ${result.checked}, added ${result.added}`); }
  catch (e) { console.error('[monitor] refresh failed:', e.message); }
  finally { refreshInProgress = false; }
});

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(ROOT, 'public', 'index.html'));
});
app.use((err, _req, res, _next) => { console.error(err); res.status(500).json({ error: 'Unexpected server error' }); });

app.listen(PORT, () => {
  console.log(`Roadmap & Schedule running at http://localhost:${PORT}`);
  // Baseline immediately; later checks detect new feed items or page changes.
  refreshSources().then(r => console.log(`[monitor] initial check: ${r.checked} sources, ${r.added} new items`)).catch(e => console.error('[monitor] initial check failed:', e.message));
});

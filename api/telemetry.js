import { put } from '@vercel/blob';

const MAX_BODY = 32 * 1024;
const hits = new Map();

function str(value, max = 60) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[\u0000-\u001f\u007f]/g, '').slice(0, max);
}

function num(value, min = 0, max = 100000, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n * 100) / 100));
}

function stats(value) {
  const s = value && typeof value === 'object' ? value : {};
  return {
    apps: num(s.appearances, 0, 100000),
    goals: num(s.goals, 0, 100000),
    assists: num(s.assists, 0, 100000),
    minutes: num(s.minutes, 0, 10000000),
    motm: num(s.motm, 0, 100000),
  };
}

function sanitize(raw) {
  const p = raw && raw.player && typeof raw.player === 'object' ? raw.player : {};
  const honours = p.honours && typeof p.honours === 'object' ? p.honours : {};
  const names = Array.isArray(honours.names)
    ? honours.names.slice(0, 20).map((h) => ({
        name: str(h && h.name, 60),
        count: num(h && h.count, 1, 1000),
      }))
    : [];
  const recent = Array.isArray(honours.recent)
    ? honours.recent.slice(0, 12).map((h) => ({
        year: num(h && h.year, 1900, 2200),
        name: str(h && h.name, 60),
        team: str(h && h.team, 60),
        cat: str(h && h.cat, 20),
      }))
    : [];

  return {
    build: str(raw.build, 40),
    date: str(raw.date, 20),
    player: {
      age: num(p.age, 14, 60),
      nation: str(p.nation, 30),
      position: str(p.position, 10),
      role: str(p.role, 30),
      club: str(p.club, 60),
      league: str(p.league, 60),
      level: num(p.level, 0, 100),
      overall: num(p.overall, 0, 99),
      reputation: num(p.reputation, 0, 100),
      coachTrust: num(p.coachTrust, 0, 100),
      squadRank: num(p.squadRank, 0, 100),
      chapters: num(p.chapters, 0, 100),
      retired: !!p.retired,
      season: stats(p.season),
      career: stats(p.career),
      national: {
        caps: num(p.national && p.national.caps, 0, 1000),
        goals: num(p.national && p.national.goals, 0, 1000),
      },
      honours: {
        count: num(honours.count, 0, 1000),
        names,
        recent,
      },
    },
  };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method not allowed' });
  }

  let raw = req.body;
  try {
    if (typeof raw === 'string') raw = JSON.parse(raw);
  } catch {
    return res.status(400).json({ error: 'invalid json' });
  }
  if (!raw || typeof raw !== 'object') {
    return res.status(400).json({ error: 'invalid body' });
  }
  if (JSON.stringify(raw).length > MAX_BODY) {
    return res.status(413).json({ error: 'too large' });
  }

  const anon = str(raw.anon, 40).toLowerCase();
  if (!/^[a-f0-9]{16,40}$/.test(anon)) {
    return res.status(400).json({ error: 'invalid anon id' });
  }

  const ip = String(
    req.headers['x-forwarded-for'] ||
      req.headers['x-real-ip'] ||
      (req.socket && req.socket.remoteAddress) ||
      'unknown'
  ).split(',')[0].trim();

  const now = Date.now();
  const key = `${anon}:${ip}`;
  const last = hits.get(key);
  if (last && now - last < 15000) {
    return res.status(202).json({ ok: true, skipped: true });
  }
  hits.set(key, now);
  if (hits.size > 2000) {
    for (const [k, t] of hits) {
      if (now - t > 10 * 60 * 1000) hits.delete(k);
    }
  }

  const payload = sanitize(raw);
  const date = new Date(now).toISOString().slice(0, 10);
  const pathname = `snapshots/${date}/${anon}-${now}-${Math.random()
    .toString(36)
    .slice(2, 8)}.json`;

  try {
    await put(pathname, JSON.stringify({ v: 1, anon, receivedAt: new Date(now).toISOString(), ...payload }), {
      access: 'private',
      contentType: 'application/json',
      addRandomSuffix: false,
      cacheControlMaxAge: 60,
    });
  } catch (error) {
    console.error('telemetry put failed', error);
    return res.status(500).json({ error: 'store failed' });
  }

  return res.status(200).json({ ok: true });
}

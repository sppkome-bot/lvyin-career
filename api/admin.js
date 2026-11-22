import { get, list } from '@vercel/blob';

function top(map, limit = 12) {
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name, count]) => ({ name, count }));
}

async function mapLimit(items, concurrency, fn) {
  const results = new Array(items.length);
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'method not allowed' });
  }

  const required = process.env.ADMIN_TOKEN;
  if (!required) {
    return res.status(503).json({ error: 'ADMIN_TOKEN is not configured' });
  }

  const header = String(req.headers.authorization || '');
  const queryToken = String(req.query.token || '');
  const provided = header.startsWith('Bearer ') ? header.slice(7) : queryToken;
  if (provided !== required) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const limit = Math.max(1, Math.min(Number(req.query.limit) || 100, 200));

  let blobs = [];
  let cursor;
  try {
    for (let page = 0; page < 5; page++) {
      const result = await list({ prefix: 'snapshots/', limit: 1000, cursor });
      blobs.push(...result.blobs);
      if (!result.hasMore || !result.cursor) break;
      cursor = result.cursor;
    }
  } catch (error) {
    console.error('admin list failed', error);
    return res.status(500).json({ error: 'list failed' });
  }

  blobs.sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime());
  const picked = blobs.slice(0, limit);

  const rows = (
    await mapLimit(picked, 6, async (blob) => {
      try {
        const file = await get(blob.pathname, { access: 'private' });
        if (!file || file.statusCode !== 200 || !file.stream) return null;
        const text = await new Response(file.stream).text();
        const row = JSON.parse(text);
        row._pathname = blob.pathname;
        row._uploadedAt = blob.uploadedAt;
        return row;
      } catch (error) {
        console.error('admin get failed', blob.pathname, error);
        return null;
      }
    })
  ).filter(Boolean);

  const clubs = {};
  const leagues = {};
  const positions = {};
  const honours = {};
  const anons = new Set();
  let honourTotal = 0;

  for (const row of rows) {
    const p = row.player || {};
    if (row.anon) anons.add(row.anon);
    if (p.club) clubs[p.club] = (clubs[p.club] || 0) + 1;
    if (p.league) leagues[p.league] = (leagues[p.league] || 0) + 1;
    if (p.position || p.role) {
      const key = `${p.position || ''}${p.role ? ' · ' + p.role : ''}`;
      positions[key] = (positions[key] || 0) + 1;
    }
    const h = p.honours || {};
    honourTotal += Number(h.count) || 0;
    for (const item of h.names || []) {
      if (item && item.name) honours[item.name] = (honours[item.name] || 0) + (Number(item.count) || 1);
    }
  }

  return res.status(200).json({
    totalSnapshots: blobs.length,
    shown: rows.length,
    uniquePlayers: anons.size,
    honourTotal,
    clubs: top(clubs),
    leagues: top(leagues),
    positions: top(positions),
    honours: top(honours),
    rows,
  });
}

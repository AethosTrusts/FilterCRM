// Netlify DB (Neon Postgres) — partnerships & contacts CRUD
// Separate from investors (db.js) to isolate risk

let neonPromise = null;
function getNeon() {
  if (!neonPromise) {
    neonPromise = import('@neondatabase/serverless').then(m => {
      const url = process.env.NETLIFY_DATABASE_URL || process.env.DATABASE_URL;
      return m.neon(url);
    });
  }
  return neonPromise;
}

exports.handler = async function(event, context) {
  if (!process.env.NETLIFY_DATABASE_URL && !process.env.DATABASE_URL) {
    return json(500, { error: 'NETLIFY_DATABASE_URL not set' });
  }

  try {
    const sql = await getNeon();
    const action = (event.queryStringParameters || {}).action || '';
    const method = event.httpMethod;

    await ensureTable(sql);

    // GET — load all partnerships
    if (method === 'GET' && !action) {
      const rows = await sql`SELECT * FROM partnerships ORDER BY name ASC LIMIT 1000`;
      return json(200, rows.map(dbToApp));
    }

    // POST upsert — single
    if (method === 'POST' && action === 'upsert') {
      const p = JSON.parse(event.body);
      const row = appToDb(p);
      const result = await sql`
        INSERT INTO partnerships (id, name, org, category, stage, emails, owner, link, products, notes, timeline, last_contact, next_followup, created_at)
        VALUES (${row.id}, ${row.name}, ${row.org}, ${row.category}, ${row.stage}, ${row.emails}, ${row.owner}, ${row.link}, ${row.products}, ${row.notes}, ${JSON.stringify(row.timeline)}::jsonb, ${row.last_contact}, ${row.next_followup}, ${row.created_at})
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name, org = EXCLUDED.org, category = EXCLUDED.category,
          stage = EXCLUDED.stage, emails = EXCLUDED.emails, owner = EXCLUDED.owner,
          link = EXCLUDED.link, products = EXCLUDED.products, notes = EXCLUDED.notes,
          timeline = EXCLUDED.timeline, last_contact = EXCLUDED.last_contact,
          next_followup = EXCLUDED.next_followup
        RETURNING *
      `;
      return json(200, result[0] ? dbToApp(result[0]) : {});
    }

    // POST bulk
    if (method === 'POST' && action === 'bulk') {
      const items = JSON.parse(event.body);
      let saved = 0;
      const failed = [];
      for (const p of items) {
        try {
          const row = appToDb(p);
          await sql`
            INSERT INTO partnerships (id, name, org, category, stage, emails, owner, link, products, notes, timeline, last_contact, next_followup, created_at)
            VALUES (${row.id}, ${row.name}, ${row.org}, ${row.category}, ${row.stage}, ${row.emails}, ${row.owner}, ${row.link}, ${row.products}, ${row.notes}, ${JSON.stringify(row.timeline)}::jsonb, ${row.last_contact}, ${row.next_followup}, ${row.created_at})
            ON CONFLICT (id) DO UPDATE SET
              name = EXCLUDED.name, org = EXCLUDED.org, category = EXCLUDED.category,
              stage = EXCLUDED.stage, emails = EXCLUDED.emails, owner = EXCLUDED.owner,
              link = EXCLUDED.link, products = EXCLUDED.products, notes = EXCLUDED.notes,
              timeline = EXCLUDED.timeline, last_contact = EXCLUDED.last_contact,
              next_followup = EXCLUDED.next_followup
          `;
          saved++;
        } catch (e) {
          failed.push({ id: p.id, name: p.name, err: e.message });
        }
      }
      return json(200, { saved, total: items.length, failed });
    }

    // DELETE
    if (method === 'DELETE') {
      const id = (event.queryStringParameters || {}).id;
      if (!id) return json(400, { error: 'id required' });
      await sql`DELETE FROM partnerships WHERE id = ${id}`;
      return json(200, { deleted: id });
    }

    return json(400, { error: 'Unknown action' });
  } catch (e) {
    console.error('Partnerships DB error:', e.message);
    return json(500, { error: e.message });
  }
};

async function ensureTable(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS partnerships (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      org TEXT DEFAULT '',
      category TEXT DEFAULT '',
      stage TEXT DEFAULT 'prospect',
      emails TEXT DEFAULT '',
      owner TEXT DEFAULT '',
      link TEXT DEFAULT '',
      products TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      timeline JSONB DEFAULT '[]'::jsonb,
      last_contact DATE,
      next_followup DATE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_partnerships_stage ON partnerships(stage)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_partnerships_category ON partnerships(category)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_partnerships_owner ON partnerships(owner)`;
}

function appToDb(p) {
  let tl = p.timeline || [];
  if (typeof tl === 'string') { try { tl = JSON.parse(tl); } catch (e) { tl = []; } }
  if (!Array.isArray(tl)) tl = [];

  return {
    id: String(p.id || 'ptn_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5)),
    name: String(p.name || ''),
    org: String(p.org || ''),
    category: String(p.category || ''),
    stage: String(p.stage || 'prospect'),
    emails: String(p.emails || ''),
    owner: String(p.owner || ''),
    link: String(p.link || ''),
    products: String(p.products || ''),
    notes: String(p.notes || ''),
    timeline: tl,
    last_contact: validDate(p.lastContact),
    next_followup: validDate(p.nextFollowup),
    created_at: validTs(p.created) || new Date().toISOString()
  };
}

function dbToApp(row) {
  let tl = row.timeline || [];
  if (typeof tl === 'string') { try { tl = JSON.parse(tl); } catch (e) { tl = []; } }
  if (!Array.isArray(tl)) tl = [];

  return {
    id: row.id,
    name: row.name || '',
    org: row.org || '',
    category: row.category || '',
    stage: row.stage || 'prospect',
    emails: row.emails || '',
    owner: row.owner || '',
    link: row.link || '',
    products: row.products || '',
    notes: row.notes || '',
    timeline: tl,
    lastContact: row.last_contact ? new Date(row.last_contact).toISOString().substring(0, 10) : '',
    nextFollowup: row.next_followup ? new Date(row.next_followup).toISOString().substring(0, 10) : '',
    created: row.created_at ? new Date(row.created_at).toISOString() : ''
  };
}

function validDate(v) {
  if (!v) return null;
  const s = String(v).substring(0, 10);
  return (s.length === 10 && !isNaN(Date.parse(s))) ? s : null;
}
function validTs(v) {
  if (!v) return null;
  const s = String(v);
  return (s.length >= 4 && !isNaN(Date.parse(s))) ? new Date(s).toISOString() : null;
}
function json(status, data) {
  return { statusCode: status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) };
}

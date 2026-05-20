// Netlify DB (Neon Postgres) — all investor CRUD
// Uses @neondatabase/serverless directly (the underlying driver)

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
  // Check connection string is set
  if (!process.env.NETLIFY_DATABASE_URL && !process.env.DATABASE_URL) {
    return json(500, {
      error: 'NETLIFY_DATABASE_URL not set',
      hint: 'Add the Neon connection string as an environment variable in Netlify.'
    });
  }

  try {
    const sql = await getNeon();
    const action = (event.queryStringParameters || {}).action || '';
    const method = event.httpMethod;

    // Auto-create table on first call
    await ensureTable(sql);

    // GET — load all investors
    if (method === 'GET' && !action) {
      const rows = await sql`SELECT * FROM investors ORDER BY firm ASC LIMIT 1000`;
      return json(200, rows.map(dbToApp));
    }

    // POST upsert — single investor
    if (method === 'POST' && action === 'upsert') {
      const inv = JSON.parse(event.body);
      const row = appToDb(inv);
      const result = await sql`
        INSERT INTO investors (id, firm, contact, email, website, linkedin, status, nda, check_size, owner, stage, thesis, notes, timeline, last_contact, next_meeting, profiled_at, created_at)
        VALUES (${row.id}, ${row.firm}, ${row.contact}, ${row.email}, ${row.website}, ${row.linkedin}, ${row.status}, ${row.nda}, ${row.check_size}, ${row.owner}, ${row.stage}, ${row.thesis}, ${row.notes}, ${JSON.stringify(row.timeline)}::jsonb, ${row.last_contact}, ${row.next_meeting}, ${row.profiled_at}, ${row.created_at})
        ON CONFLICT (id) DO UPDATE SET
          firm = EXCLUDED.firm,
          contact = EXCLUDED.contact,
          email = EXCLUDED.email,
          website = EXCLUDED.website,
          linkedin = EXCLUDED.linkedin,
          status = EXCLUDED.status,
          nda = EXCLUDED.nda,
          check_size = EXCLUDED.check_size,
          owner = EXCLUDED.owner,
          stage = EXCLUDED.stage,
          thesis = EXCLUDED.thesis,
          notes = EXCLUDED.notes,
          timeline = EXCLUDED.timeline,
          last_contact = EXCLUDED.last_contact,
          next_meeting = EXCLUDED.next_meeting,
          profiled_at = EXCLUDED.profiled_at
        RETURNING *
      `;
      return json(200, result[0] ? dbToApp(result[0]) : {});
    }

    // POST bulk — upsert many investors
    if (method === 'POST' && action === 'bulk') {
      const invs = JSON.parse(event.body);
      let saved = 0;
      const failed = [];

      for (const inv of invs) {
        try {
          const row = appToDb(inv);
          await sql`
            INSERT INTO investors (id, firm, contact, email, website, linkedin, status, nda, check_size, owner, stage, thesis, notes, timeline, last_contact, next_meeting, profiled_at, created_at)
            VALUES (${row.id}, ${row.firm}, ${row.contact}, ${row.email}, ${row.website}, ${row.linkedin}, ${row.status}, ${row.nda}, ${row.check_size}, ${row.owner}, ${row.stage}, ${row.thesis}, ${row.notes}, ${JSON.stringify(row.timeline)}::jsonb, ${row.last_contact}, ${row.next_meeting}, ${row.profiled_at}, ${row.created_at})
            ON CONFLICT (id) DO UPDATE SET
              firm = EXCLUDED.firm,
              contact = EXCLUDED.contact,
              email = EXCLUDED.email,
              website = EXCLUDED.website,
              linkedin = EXCLUDED.linkedin,
              status = EXCLUDED.status,
              nda = EXCLUDED.nda,
              check_size = EXCLUDED.check_size,
              owner = EXCLUDED.owner,
              stage = EXCLUDED.stage,
              thesis = EXCLUDED.thesis,
              notes = EXCLUDED.notes,
              timeline = EXCLUDED.timeline,
              last_contact = EXCLUDED.last_contact,
              next_meeting = EXCLUDED.next_meeting,
              profiled_at = EXCLUDED.profiled_at
          `;
          saved++;
        } catch (e) {
          failed.push({ id: inv.id, firm: inv.firm, err: e.message });
        }
      }
      return json(200, { saved: saved, total: invs.length, failed: failed });
    }

    // DELETE
    if (method === 'DELETE') {
      const id = (event.queryStringParameters || {}).id;
      if (!id) return json(400, { error: 'id required' });
      await sql`DELETE FROM investors WHERE id = ${id}`;
      return json(200, { deleted: id });
    }

    return json(400, { error: 'Unknown action' });
  } catch (e) {
    console.error('DB error:', e.message, e.stack);
    return json(500, { error: e.message, stack: e.stack });
  }
};

async function ensureTable(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS investors (
      id TEXT PRIMARY KEY,
      firm TEXT NOT NULL DEFAULT '',
      contact TEXT DEFAULT '',
      email TEXT DEFAULT '',
      website TEXT DEFAULT '',
      linkedin TEXT DEFAULT '',
      status TEXT DEFAULT 'new',
      nda TEXT DEFAULT 'none',
      check_size TEXT DEFAULT '',
      owner TEXT DEFAULT '',
      stage TEXT DEFAULT '',
      thesis TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      timeline JSONB DEFAULT '[]'::jsonb,
      last_contact DATE,
      next_meeting DATE,
      profiled_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_investors_status ON investors(status)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_investors_firm ON investors(firm)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_investors_owner ON investors(owner)`;
}

function appToDb(inv) {
  let tl = inv.timeline || [];
  if (typeof tl === 'string') { try { tl = JSON.parse(tl); } catch (e) { tl = []; } }
  if (!Array.isArray(tl)) tl = [];

  return {
    id: String(inv.id || 'inv_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5)),
    firm: String(inv.firm || ''),
    contact: String(inv.contact || ''),
    email: String(inv.email || ''),
    website: String(inv.website || ''),
    linkedin: String(inv.linkedin || ''),
    status: String(inv.status || 'new'),
    nda: String(inv.nda || 'none'),
    check_size: String(inv.checkSize || ''),
    owner: String(inv.owner || ''),
    stage: String(inv.stage || ''),
    thesis: String(inv.thesis || ''),
    notes: String(inv.notes || ''),
    timeline: tl,
    last_contact: validDate(inv.lastContact),
    next_meeting: validDate(inv.nextMeeting),
    profiled_at: validTs(inv.profiledAt),
    created_at: validTs(inv.created) || new Date().toISOString()
  };
}

function dbToApp(row) {
  let tl = row.timeline || [];
  if (typeof tl === 'string') { try { tl = JSON.parse(tl); } catch (e) { tl = []; } }
  if (!Array.isArray(tl)) tl = [];

  return {
    id: row.id,
    firm: row.firm || '',
    contact: row.contact || '',
    email: row.email || '',
    website: row.website || '',
    linkedin: row.linkedin || '',
    status: row.status || 'new',
    nda: row.nda || 'none',
    checkSize: row.check_size || '',
    owner: row.owner || '',
    stage: row.stage || '',
    thesis: row.thesis || '',
    notes: row.notes || '',
    timeline: tl,
    lastContact: row.last_contact ? new Date(row.last_contact).toISOString().substring(0, 10) : '',
    nextMeeting: row.next_meeting ? new Date(row.next_meeting).toISOString().substring(0, 10) : '',
    profiledAt: row.profiled_at ? new Date(row.profiled_at).toISOString() : '',
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
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  };
}

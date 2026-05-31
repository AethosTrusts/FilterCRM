// Netlify DB (Neon Postgres) — documents & notes library CRUD

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

    if (method === 'GET' && !action) {
      const rows = await sql`SELECT * FROM documents ORDER BY title ASC LIMIT 2000`;
      return json(200, rows.map(dbToApp));
    }

    if (method === 'POST' && action === 'upsert') {
      const d = JSON.parse(event.body);
      const row = appToDb(d);
      const result = await sql`
        INSERT INTO documents (id, title, type, category, url, owner, notes, tags, created_at)
        VALUES (${row.id}, ${row.title}, ${row.type}, ${row.category}, ${row.url}, ${row.owner}, ${row.notes}, ${row.tags}, ${row.created_at})
        ON CONFLICT (id) DO UPDATE SET
          title=EXCLUDED.title, type=EXCLUDED.type, category=EXCLUDED.category,
          url=EXCLUDED.url, owner=EXCLUDED.owner, notes=EXCLUDED.notes, tags=EXCLUDED.tags
        RETURNING *`;
      return json(200, result[0] ? dbToApp(result[0]) : {});
    }

    if (method === 'POST' && action === 'bulk') {
      const items = JSON.parse(event.body);
      let saved = 0; const failed = [];
      for (const d of items) {
        try {
          const row = appToDb(d);
          await sql`
            INSERT INTO documents (id, title, type, category, url, owner, notes, tags, created_at)
            VALUES (${row.id}, ${row.title}, ${row.type}, ${row.category}, ${row.url}, ${row.owner}, ${row.notes}, ${row.tags}, ${row.created_at})
            ON CONFLICT (id) DO UPDATE SET
              title=EXCLUDED.title, type=EXCLUDED.type, category=EXCLUDED.category,
              url=EXCLUDED.url, owner=EXCLUDED.owner, notes=EXCLUDED.notes, tags=EXCLUDED.tags`;
          saved++;
        } catch (e) { failed.push({ id: d.id, title: d.title, err: e.message }); }
      }
      return json(200, { saved, total: items.length, failed });
    }

    if (method === 'DELETE') {
      const id = (event.queryStringParameters || {}).id;
      if (!id) return json(400, { error: 'id required' });
      await sql`DELETE FROM documents WHERE id = ${id}`;
      return json(200, { deleted: id });
    }

    return json(400, { error: 'Unknown action' });
  } catch (e) {
    console.error('Documents DB error:', e.message);
    return json(500, { error: e.message });
  }
};

async function ensureTable(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      type TEXT DEFAULT 'link',
      category TEXT DEFAULT '',
      url TEXT DEFAULT '',
      owner TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      tags TEXT DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_documents_category ON documents(category)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_documents_type ON documents(type)`;
}

function appToDb(d) {
  return {
    id: String(d.id || 'doc_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5)),
    title: String(d.title || ''),
    type: String(d.type || 'link'),
    category: String(d.category || ''),
    url: String(d.url || ''),
    owner: String(d.owner || ''),
    notes: String(d.notes || ''),
    tags: String(d.tags || ''),
    created_at: (d.created && !isNaN(Date.parse(d.created))) ? new Date(d.created).toISOString() : new Date().toISOString()
  };
}

function dbToApp(row) {
  return {
    id: row.id,
    title: row.title || '',
    type: row.type || 'link',
    category: row.category || '',
    url: row.url || '',
    owner: row.owner || '',
    notes: row.notes || '',
    tags: row.tags || '',
    created: row.created_at ? new Date(row.created_at).toISOString() : ''
  };
}

function json(status, data) {
  return { statusCode: status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) };
}

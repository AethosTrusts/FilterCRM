// Netlify DB (Neon Postgres) — user permissions / access control
// Permanent admin: liang@filterbaby.com (hardcoded, cannot be removed)

const PERMANENT_ADMIN = 'liang@filterbaby.com';

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

    // GET — load all permission records
    if (method === 'GET' && !action) {
      const rows = await sql`SELECT * FROM user_permissions ORDER BY email ASC`;
      return json(200, { permanentAdmin: PERMANENT_ADMIN, users: rows.map(dbToApp) });
    }

    // POST upsert — single permission record
    if (method === 'POST' && action === 'upsert') {
      const p = JSON.parse(event.body);
      const email = String(p.email || '').trim().toLowerCase();
      if (!email) return json(400, { error: 'email required' });
      // Never allow editing the permanent admin's record into something lesser
      const isPermanent = email === PERMANENT_ADMIN;
      const row = {
        email,
        can_investors: isPermanent ? true : !!p.canInvestors,
        can_partnerships: isPermanent ? true : !!p.canPartnerships,
        is_admin: isPermanent ? true : !!p.isAdmin
      };
      const result = await sql`
        INSERT INTO user_permissions (email, can_investors, can_partnerships, is_admin, updated_at)
        VALUES (${row.email}, ${row.can_investors}, ${row.can_partnerships}, ${row.is_admin}, NOW())
        ON CONFLICT (email) DO UPDATE SET
          can_investors = EXCLUDED.can_investors,
          can_partnerships = EXCLUDED.can_partnerships,
          is_admin = EXCLUDED.is_admin,
          updated_at = NOW()
        RETURNING *
      `;
      return json(200, result[0] ? dbToApp(result[0]) : {});
    }

    // DELETE — remove a user's permission record
    if (method === 'DELETE') {
      const email = String((event.queryStringParameters || {}).email || '').trim().toLowerCase();
      if (!email) return json(400, { error: 'email required' });
      if (email === PERMANENT_ADMIN) return json(400, { error: 'Cannot remove permanent admin' });
      await sql`DELETE FROM user_permissions WHERE email = ${email}`;
      return json(200, { deleted: email });
    }

    return json(400, { error: 'Unknown action' });
  } catch (e) {
    console.error('Permissions DB error:', e.message);
    return json(500, { error: e.message });
  }
};

async function ensureTable(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS user_permissions (
      email TEXT PRIMARY KEY,
      can_investors BOOLEAN DEFAULT false,
      can_partnerships BOOLEAN DEFAULT false,
      is_admin BOOLEAN DEFAULT false,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
}

function dbToApp(row) {
  return {
    email: row.email,
    canInvestors: !!row.can_investors,
    canPartnerships: !!row.can_partnerships,
    isAdmin: !!row.is_admin,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : ''
  };
}

function json(status, data) {
  return { statusCode: status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) };
}

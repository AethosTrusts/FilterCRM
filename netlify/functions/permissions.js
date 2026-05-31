// Netlify DB (Neon Postgres) — user permissions / access control
// Permanent admin: liang@filterbaby.com (hardcoded, cannot be removed)

const crypto = require('crypto');
const PERMANENT_ADMIN = 'liang@filterbaby.com';

// Verify the signed session cookie and return the caller's email (or null)
function getCallerEmail(event) {
  try {
    const sessionSecret = process.env.SESSION_SECRET || 'fb-crm-default-secret-2025';
    const cookies = (event.headers && event.headers.cookie) || '';
    const match = cookies.match(/fb_session=([^;]+)/);
    if (!match) return null;
    const raw = match[1];
    const idx = raw.lastIndexOf('.');
    if (idx < 1) return null;
    const data = raw.substring(0, idx);
    const sig = raw.substring(idx + 1);
    const expected = crypto.createHmac('sha256', sessionSecret).update(data).digest('base64url');
    if (sig !== expected) return null;
    const session = JSON.parse(Buffer.from(data, 'base64').toString('utf8'));
    if (Date.now() - session.loggedInAt > 604800000) return null;
    return (session.email || '').toLowerCase();
  } catch (e) {
    return null;
  }
}

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

    const caller = getCallerEmail(event);

    // GET — load all permission records (any authenticated user may read)
    if (method === 'GET' && !action) {
      const rows = await sql`SELECT * FROM user_permissions ORDER BY email ASC`;
      return json(200, { permanentAdmin: PERMANENT_ADMIN, users: rows.map(dbToApp) });
    }

    // All writes below require the caller to be an admin.
    // Admin = permanent admin OR a user flagged is_admin in the table.
    let callerIsAdmin = (caller === PERMANENT_ADMIN);
    if (!callerIsAdmin && caller) {
      const rec = await sql`SELECT is_admin FROM user_permissions WHERE email = ${caller}`;
      callerIsAdmin = rec[0] && rec[0].is_admin === true;
    }
    if ((method === 'POST' || method === 'DELETE') && !callerIsAdmin) {
      return json(403, { error: 'Admin access required' });
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
        can_documents: isPermanent ? true : !!p.canDocuments,
        is_admin: isPermanent ? true : !!p.isAdmin
      };
      const result = await sql`
        INSERT INTO user_permissions (email, can_investors, can_partnerships, can_documents, is_admin, updated_at)
        VALUES (${row.email}, ${row.can_investors}, ${row.can_partnerships}, ${row.can_documents}, ${row.is_admin}, NOW())
        ON CONFLICT (email) DO UPDATE SET
          can_investors = EXCLUDED.can_investors,
          can_partnerships = EXCLUDED.can_partnerships,
          can_documents = EXCLUDED.can_documents,
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
      can_documents BOOLEAN DEFAULT false,
      is_admin BOOLEAN DEFAULT false,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  // Add column if upgrading an existing table
  await sql`ALTER TABLE user_permissions ADD COLUMN IF NOT EXISTS can_documents BOOLEAN DEFAULT false`;
}

function dbToApp(row) {
  return {
    email: row.email,
    canInvestors: !!row.can_investors,
    canPartnerships: !!row.can_partnerships,
    canDocuments: !!row.can_documents,
    isAdmin: !!row.is_admin,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : ''
  };
}

function json(status, data) {
  return { statusCode: status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) };
}

// Supabase database proxy — all investor CRUD goes through here
// Environment variables needed: SUPABASE_URL, SUPABASE_KEY

exports.handler = async function(event, context) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_KEY;

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: "SUPABASE_URL or SUPABASE_KEY not set" }) };
  }

  const headers = {
    "apikey": SUPABASE_KEY,
    "Authorization": "Bearer " + SUPABASE_KEY,
    "Content-Type": "application/json",
    "Prefer": "return=representation"
  };

  const baseUrl = SUPABASE_URL + "/rest/v1/investors";

  // Route based on HTTP method + query params
  const params = event.queryStringParameters || {};
  const action = params.action || '';

  try {
    // GET /api/db — load all investors
    if (event.httpMethod === "GET" && !action) {
      const resp = await fetch(baseUrl + "?order=firm.asc&limit=1000", { headers });
      if (!resp.ok) {
        const err = await resp.text();
        return { statusCode: resp.status, body: JSON.stringify({ error: "DB read failed", detail: err }) };
      }
      const rows = await resp.json();
      // Convert DB rows to app format (timeline is stored as JSONB)
      const investors = rows.map(dbToApp);
      return { statusCode: 200, headers: cors(), body: JSON.stringify(investors) };
    }

    // POST /api/db?action=upsert — create or update one investor
    if (event.httpMethod === "POST" && action === "upsert") {
      const inv = JSON.parse(event.body);
      const row = appToDb(inv);

      const resp = await fetch(baseUrl + "?on_conflict=id", {
        method: "POST",
        headers: { ...headers, "Prefer": "return=representation,resolution=merge-duplicates" },
        body: JSON.stringify(row)
      });

      if (!resp.ok) {
        const err = await resp.text();
        return { statusCode: resp.status, body: JSON.stringify({ error: "Upsert failed", detail: err }) };
      }
      const result = await resp.json();
      return { statusCode: 200, headers: cors(), body: JSON.stringify(result[0] ? dbToApp(result[0]) : {}) };
    }

    // POST /api/db?action=bulk — upsert many investors at once
    if (event.httpMethod === "POST" && action === "bulk") {
      const invs = JSON.parse(event.body);
      const rows = invs.map(appToDb);

      // Supabase supports bulk upsert
      const resp = await fetch(baseUrl + "?on_conflict=id", {
        method: "POST",
        headers: { ...headers, "Prefer": "return=representation,resolution=merge-duplicates" },
        body: JSON.stringify(rows)
      });

      if (!resp.ok) {
        const err = await resp.text();
        return { statusCode: resp.status, body: JSON.stringify({ error: "Bulk upsert failed", detail: err }) };
      }
      const result = await resp.json();
      return { statusCode: 200, headers: cors(), body: JSON.stringify({ saved: result.length }) };
    }

    // DELETE /api/db?id=xxx — delete one investor
    if (event.httpMethod === "DELETE") {
      const id = params.id;
      if (!id) return { statusCode: 400, body: JSON.stringify({ error: "id required" }) };

      const resp = await fetch(baseUrl + "?id=eq." + encodeURIComponent(id), {
        method: "DELETE",
        headers
      });

      if (!resp.ok) {
        const err = await resp.text();
        return { statusCode: resp.status, body: JSON.stringify({ error: "Delete failed", detail: err }) };
      }
      return { statusCode: 200, headers: cors(), body: JSON.stringify({ deleted: id }) };
    }

    return { statusCode: 400, body: JSON.stringify({ error: "Unknown action" }) };

  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};

// Convert app investor object → Supabase row (snake_case, flatten timeline to JSONB)
function appToDb(inv) {
  return {
    id: inv.id,
    firm: inv.firm || '',
    contact: inv.contact || '',
    email: inv.email || '',
    website: inv.website || '',
    linkedin: inv.linkedin || '',
    status: inv.status || 'new',
    nda: inv.nda || 'none',
    check_size: inv.checkSize || '',
    owner: inv.owner || '',
    stage: inv.stage || '',
    thesis: inv.thesis || '',
    notes: inv.notes || '',
    timeline: JSON.stringify(inv.timeline || []),
    profiled_at: inv.profiledAt || null,
    created_at: inv.created || new Date().toISOString()
  };
}

// Convert Supabase row → app investor object (camelCase)
function dbToApp(row) {
  var timeline = [];
  try {
    timeline = typeof row.timeline === 'string' ? JSON.parse(row.timeline) : (row.timeline || []);
  } catch(e) { timeline = []; }

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
    timeline: timeline,
    profiledAt: row.profiled_at || '',
    created: row.created_at || ''
  };
}

function cors() {
  return { "Content-Type": "application/json" };
}

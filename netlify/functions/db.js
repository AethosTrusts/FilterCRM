// Supabase database proxy — all investor CRUD
// Environment variables: SUPABASE_URL, SUPABASE_KEY

var knownColumns = null; // cached after first discovery

exports.handler = async function(event, context) {
  var SUPABASE_URL = process.env.SUPABASE_URL;
  var SUPABASE_KEY = process.env.SUPABASE_KEY;

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: "SUPABASE_URL or SUPABASE_KEY not set" }) };
  }

  var hdrs = {
    "apikey": SUPABASE_KEY,
    "Authorization": "Bearer " + SUPABASE_KEY,
    "Content-Type": "application/json"
  };

  var base = SUPABASE_URL + "/rest/v1/investors";
  var params = event.queryStringParameters || {};
  var action = params.action || '';

  try {
    // Discover table columns on first write operation
    if (!knownColumns && (event.httpMethod === "POST" || event.httpMethod === "DELETE")) {
      knownColumns = await discoverColumns(base, hdrs);
    }

    // GET — load all
    if (event.httpMethod === "GET" && !action) {
      var resp = await fetch(base + "?order=firm.asc&limit=1000", { headers: hdrs });
      if (!resp.ok) {
        return { statusCode: resp.status, body: JSON.stringify({ error: "DB read failed", detail: await resp.text() }) };
      }
      var rows = await resp.json();
      return { statusCode: 200, headers: cors(), body: JSON.stringify(rows.map(dbToApp)) };
    }

    // POST upsert — single
    if (event.httpMethod === "POST" && action === "upsert") {
      var inv = JSON.parse(event.body);
      var row = safeRow(appToDb(inv));
      var resp = await fetch(base + "?on_conflict=id", {
        method: "POST",
        headers: Object.assign({}, hdrs, { "Prefer": "return=representation,resolution=merge-duplicates" }),
        body: JSON.stringify(row)
      });
      if (!resp.ok) {
        return { statusCode: resp.status, body: JSON.stringify({ error: "Upsert failed", detail: await resp.text() }) };
      }
      var result = await resp.json();
      return { statusCode: 200, headers: cors(), body: JSON.stringify(result[0] ? dbToApp(result[0]) : {}) };
    }

    // POST bulk — chunked
    if (event.httpMethod === "POST" && action === "bulk") {
      var invs = JSON.parse(event.body);
      var allRows = invs.map(function(inv) { return safeRow(appToDb(inv)); });
      var saved = 0;
      var errors = [];

      for (var i = 0; i < allRows.length; i += 50) {
        var chunk = allRows.slice(i, i + 50);
        var resp = await fetch(base + "?on_conflict=id", {
          method: "POST",
          headers: Object.assign({}, hdrs, { "Prefer": "return=minimal,resolution=merge-duplicates" }),
          body: JSON.stringify(chunk)
        });
        if (resp.ok) {
          saved += chunk.length;
        } else {
          var batchErr = await resp.text();
          errors.push({ batch: Math.floor(i/50), status: resp.status, detail: batchErr });
          // Fallback: individual saves
          for (var j = 0; j < chunk.length; j++) {
            var s = await fetch(base + "?on_conflict=id", {
              method: "POST",
              headers: Object.assign({}, hdrs, { "Prefer": "return=minimal,resolution=merge-duplicates" }),
              body: JSON.stringify(chunk[j])
            });
            if (s.ok) saved++;
            else errors.push({ id: chunk[j].id, firm: chunk[j].firm, detail: await s.text() });
          }
        }
      }

      return { statusCode: errors.length > 0 ? 207 : 200, headers: cors(), body: JSON.stringify({ saved: saved, total: allRows.length, errors: errors }) };
    }

    // DELETE
    if (event.httpMethod === "DELETE") {
      var id = params.id;
      if (!id) return { statusCode: 400, body: JSON.stringify({ error: "id required" }) };
      var resp = await fetch(base + "?id=eq." + encodeURIComponent(id), { method: "DELETE", headers: hdrs });
      if (!resp.ok) {
        return { statusCode: resp.status, body: JSON.stringify({ error: "Delete failed", detail: await resp.text() }) };
      }
      return { statusCode: 200, headers: cors(), body: JSON.stringify({ deleted: id }) };
    }

    return { statusCode: 400, body: JSON.stringify({ error: "Unknown action" }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};

// Discover which columns exist by reading one row or the table definition
async function discoverColumns(base, hdrs) {
  try {
    // Fetch one row to see which columns come back
    var resp = await fetch(base + "?limit=1", { headers: hdrs });
    if (resp.ok) {
      var rows = await resp.json();
      if (rows.length > 0) {
        return Object.keys(rows[0]);
      }
    }
  } catch(e) {}
  // Fallback: assume the core columns from the original CREATE TABLE
  return ["id","firm","contact","email","website","linkedin","status","nda","check_size","owner","stage","thesis","notes","timeline","created_at"];
}

// Strip any keys from row that aren't in the known columns
function safeRow(row) {
  if (!knownColumns) return row;
  var safe = {};
  for (var key in row) {
    if (knownColumns.indexOf(key) !== -1) {
      safe[key] = row[key];
    }
  }
  return safe;
}

// Build the full row object — safeRow will strip unknown columns before sending
function appToDb(inv) {
  var tl = inv.timeline || [];
  if (typeof tl === 'string') { try { tl = JSON.parse(tl); } catch(e) { tl = []; } }
  if (!Array.isArray(tl)) tl = [];

  var row = {
    id: String(inv.id || 'inv_' + Date.now() + '_' + Math.random().toString(36).substr(2,5)),
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
    created_at: validTs(inv.created) || new Date().toISOString()
  };

  // Optional date columns — only add if value is valid
  var lc = String(inv.lastContact || '');
  if (lc.length >= 10 && !isNaN(Date.parse(lc.substring(0,10)))) row.last_contact = lc.substring(0,10);

  var nm = String(inv.nextMeeting || '');
  if (nm.length >= 10 && !isNaN(Date.parse(nm.substring(0,10)))) row.next_meeting = nm.substring(0,10);

  var pa = String(inv.profiledAt || '');
  if (pa.length > 4 && !isNaN(Date.parse(pa))) row.profiled_at = pa;

  return row;
}

function dbToApp(row) {
  var tl = row.timeline || [];
  if (typeof tl === 'string') { try { tl = JSON.parse(tl); } catch(e) { tl = []; } }
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
    lastContact: row.last_contact || '',
    nextMeeting: row.next_meeting || '',
    profiledAt: row.profiled_at || '',
    created: row.created_at || ''
  };
}

function validTs(val) {
  if (!val) return null;
  var s = String(val);
  if (s.length < 4 || isNaN(Date.parse(s))) return null;
  return s;
}

function cors() {
  return { "Content-Type": "application/json" };
}

// Supabase database proxy — all investor CRUD
// Environment variables: SUPABASE_URL, SUPABASE_KEY

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
    // GET — load all
    if (event.httpMethod === "GET" && !action) {
      var resp = await fetch(base + "?order=firm.asc&limit=1000", { headers: hdrs });
      if (!resp.ok) return err(resp.status, await resp.text());
      return ok(200, (await resp.json()).map(dbToApp));
    }

    // Discover columns for write operations
    var cols = await discoverColumns(base, hdrs);

    // POST upsert — single
    if (event.httpMethod === "POST" && action === "upsert") {
      var inv = JSON.parse(event.body);
      var row = filterCols(appToDb(inv), cols);
      var resp = await fetch(base + "?on_conflict=id", {
        method: "POST",
        headers: merge(hdrs, { "Prefer": "return=representation,resolution=merge-duplicates" }),
        body: JSON.stringify(row)
      });
      if (!resp.ok) return err(resp.status, await resp.text());
      var result = await resp.json();
      return ok(200, result[0] ? dbToApp(result[0]) : {});
    }

    // POST bulk — chunked with individual fallback
    if (event.httpMethod === "POST" && action === "bulk") {
      var invs = JSON.parse(event.body);
      var allRows = invs.map(function(inv) { return filterCols(appToDb(inv), cols); });
      var saved = 0;
      var failed = [];

      for (var i = 0; i < allRows.length; i += 25) {
        var chunk = allRows.slice(i, i + 25);
        var resp = await fetch(base + "?on_conflict=id", {
          method: "POST",
          headers: merge(hdrs, { "Prefer": "return=minimal,resolution=merge-duplicates" }),
          body: JSON.stringify(chunk)
        });
        if (resp.ok) {
          saved += chunk.length;
        } else {
          // Batch failed — try each row individually
          for (var j = 0; j < chunk.length; j++) {
            var s = await fetch(base + "?on_conflict=id", {
              method: "POST",
              headers: merge(hdrs, { "Prefer": "return=minimal,resolution=merge-duplicates" }),
              body: JSON.stringify(chunk[j])
            });
            if (s.ok) {
              saved++;
            } else {
              failed.push({ id: chunk[j].id, firm: chunk[j].firm, err: await s.text() });
            }
          }
        }
      }

      return ok(200, { saved: saved, total: allRows.length, failed: failed });
    }

    // DELETE
    if (event.httpMethod === "DELETE") {
      var id = params.id;
      if (!id) return err(400, "id required");
      var resp = await fetch(base + "?id=eq." + encodeURIComponent(id), { method: "DELETE", headers: hdrs });
      if (!resp.ok) return err(resp.status, await resp.text());
      return ok(200, { deleted: id });
    }

    return err(400, "Unknown action");
  } catch (e) {
    return err(500, e.message);
  }
};

async function discoverColumns(base, hdrs) {
  try {
    var resp = await fetch(base + "?limit=1", { headers: hdrs });
    if (resp.ok) {
      var rows = await resp.json();
      if (rows.length > 0) return Object.keys(rows[0]);
    }
  } catch(e) {}
  return ["id","firm","contact","email","website","linkedin","status","nda","check_size","owner","stage","thesis","notes","timeline","created_at"];
}

function filterCols(row, cols) {
  var out = {};
  for (var k in row) {
    if (cols.indexOf(k) !== -1) out[k] = row[k];
  }
  return out;
}

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
    id: row.id, firm: row.firm || '', contact: row.contact || '', email: row.email || '',
    website: row.website || '', linkedin: row.linkedin || '', status: row.status || 'new',
    nda: row.nda || 'none', checkSize: row.check_size || '', owner: row.owner || '',
    stage: row.stage || '', thesis: row.thesis || '', notes: row.notes || '', timeline: tl,
    lastContact: row.last_contact || '', nextMeeting: row.next_meeting || '',
    profiledAt: row.profiled_at || '', created: row.created_at || ''
  };
}

function validTs(v) {
  if (!v) return null;
  var s = String(v);
  return (s.length >= 4 && !isNaN(Date.parse(s))) ? s : null;
}

function ok(status, data) {
  return { statusCode: status, headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) };
}
function err(status, detail) {
  return { statusCode: status, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ error: detail }) };
}
function merge(a, b) {
  var out = {};
  for (var k in a) out[k] = a[k];
  for (var k in b) out[k] = b[k];
  return out;
}

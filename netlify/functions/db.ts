import { getDatabase } from "@netlify/database";

export default async (req: Request) => {
  const url = new URL(req.url);
  const action = url.searchParams.get("action") || "";

  try {
    const db = getDatabase();

    if (req.method === "GET" && !action) {
      const rows = await db.sql`
        SELECT id, firm, contact, email, website, linkedin, status, nda,
               check_size, owner, stage, thesis, notes, timeline,
               created_at, last_contact, next_meeting, profiled_at
        FROM investors ORDER BY firm ASC LIMIT 1000
      `;
      return Response.json(rows.map(dbToApp));
    }

    if (req.method === "POST" && action === "upsert") {
      const inv = await req.json();
      const row = appToDb(inv);
      const result = await db.sql`
        INSERT INTO investors (id, firm, contact, email, website, linkedin, status, nda,
          check_size, owner, stage, thesis, notes, timeline, created_at,
          last_contact, next_meeting, profiled_at)
        VALUES (${row.id}, ${row.firm}, ${row.contact}, ${row.email}, ${row.website},
          ${row.linkedin}, ${row.status}, ${row.nda}, ${row.check_size}, ${row.owner},
          ${row.stage}, ${row.thesis}, ${row.notes}, ${JSON.stringify(row.timeline)}::jsonb,
          ${row.created_at}::timestamp, ${row.last_contact}::date, ${row.next_meeting}::date,
          ${row.profiled_at}::timestamp)
        ON CONFLICT (id) DO UPDATE SET
          firm = ${row.firm}, contact = ${row.contact}, email = ${row.email},
          website = ${row.website}, linkedin = ${row.linkedin}, status = ${row.status},
          nda = ${row.nda}, check_size = ${row.check_size}, owner = ${row.owner},
          stage = ${row.stage}, thesis = ${row.thesis}, notes = ${row.notes},
          timeline = ${JSON.stringify(row.timeline)}::jsonb, created_at = ${row.created_at}::timestamp,
          last_contact = ${row.last_contact}::date, next_meeting = ${row.next_meeting}::date,
          profiled_at = ${row.profiled_at}::timestamp
        RETURNING *
      `;
      return Response.json(result[0] ? dbToApp(result[0]) : {});
    }

    if (req.method === "POST" && action === "bulk") {
      const invs = await req.json();
      if (!Array.isArray(invs)) {
        return Response.json({ error: "Expected array" }, { status: 400 });
      }
      let saved = 0;
      const failed: { id: string; firm: string; err: string }[] = [];

      for (const inv of invs) {
        try {
          const row = appToDb(inv);
          await db.sql`
            INSERT INTO investors (id, firm, contact, email, website, linkedin, status, nda,
              check_size, owner, stage, thesis, notes, timeline, created_at,
              last_contact, next_meeting, profiled_at)
            VALUES (${row.id}, ${row.firm}, ${row.contact}, ${row.email}, ${row.website},
              ${row.linkedin}, ${row.status}, ${row.nda}, ${row.check_size}, ${row.owner},
              ${row.stage}, ${row.thesis}, ${row.notes}, ${JSON.stringify(row.timeline)}::jsonb,
              ${row.created_at}::timestamp, ${row.last_contact}::date, ${row.next_meeting}::date,
              ${row.profiled_at}::timestamp)
            ON CONFLICT (id) DO UPDATE SET
              firm = ${row.firm}, contact = ${row.contact}, email = ${row.email},
              website = ${row.website}, linkedin = ${row.linkedin}, status = ${row.status},
              nda = ${row.nda}, check_size = ${row.check_size}, owner = ${row.owner},
              stage = ${row.stage}, thesis = ${row.thesis}, notes = ${row.notes},
              timeline = ${JSON.stringify(row.timeline)}::jsonb, created_at = ${row.created_at}::timestamp,
              last_contact = ${row.last_contact}::date, next_meeting = ${row.next_meeting}::date,
              profiled_at = ${row.profiled_at}::timestamp
          `;
          saved++;
        } catch (e: any) {
          failed.push({
            id: inv.id || "unknown",
            firm: inv.firm || "",
            err: e?.cause?.message || e.message,
          });
        }
      }

      return Response.json({ saved, total: invs.length, failed });
    }

    if (req.method === "DELETE") {
      const id = url.searchParams.get("id");
      if (!id) return Response.json({ error: "id required" }, { status: 400 });
      await db.sql`DELETE FROM investors WHERE id = ${id}`;
      return Response.json({ deleted: id });
    }

    return Response.json({ error: "Unknown action" }, { status: 400 });
  } catch (e: any) {
    const code = e?.cause?.code || "";
    return Response.json({ error: e.message, code }, { status: 500 });
  }
};

function appToDb(inv: any) {
  let tl = inv.timeline || [];
  if (typeof tl === "string") {
    try { tl = JSON.parse(tl); } catch { tl = []; }
  }
  if (!Array.isArray(tl)) tl = [];

  const id = String(inv.id || "inv_" + Date.now() + "_" + Math.random().toString(36).substr(2, 5));
  const created = validTs(inv.created || inv.createdAt) || new Date().toISOString();

  const lc = String(inv.lastContact || inv.last_contact || "");
  const lastContact = lc.length >= 10 && !isNaN(Date.parse(lc.substring(0, 10))) ? lc.substring(0, 10) : null;

  const nm = String(inv.nextMeeting || inv.next_meeting || "");
  const nextMeeting = nm.length >= 10 && !isNaN(Date.parse(nm.substring(0, 10))) ? nm.substring(0, 10) : null;

  const pa = String(inv.profiledAt || inv.profiled_at || "");
  const profiledAt = pa.length > 4 && !isNaN(Date.parse(pa)) ? pa : null;

  return {
    id,
    firm: String(inv.firm || ""),
    contact: String(inv.contact || ""),
    email: String(inv.email || ""),
    website: String(inv.website || ""),
    linkedin: String(inv.linkedin || ""),
    status: String(inv.status || "new"),
    nda: String(inv.nda || "none"),
    check_size: String(inv.checkSize || inv.check_size || ""),
    owner: String(inv.owner || ""),
    stage: String(inv.stage || ""),
    thesis: String(inv.thesis || ""),
    notes: String(inv.notes || ""),
    timeline: tl,
    created_at: created,
    last_contact: lastContact,
    next_meeting: nextMeeting,
    profiled_at: profiledAt,
  };
}

function dbToApp(row: any) {
  let tl = row.timeline || [];
  if (typeof tl === "string") {
    try { tl = JSON.parse(tl); } catch { tl = []; }
  }
  if (!Array.isArray(tl)) tl = [];
  return {
    id: row.id,
    firm: row.firm || "",
    contact: row.contact || "",
    email: row.email || "",
    website: row.website || "",
    linkedin: row.linkedin || "",
    status: row.status || "new",
    nda: row.nda || "none",
    checkSize: row.check_size || "",
    owner: row.owner || "",
    stage: row.stage || "",
    thesis: row.thesis || "",
    notes: row.notes || "",
    timeline: tl,
    lastContact: row.last_contact || "",
    nextMeeting: row.next_meeting || "",
    profiledAt: row.profiled_at || "",
    created: row.created_at || "",
  };
}

function validTs(v: any) {
  if (!v) return null;
  const s = String(v);
  return s.length >= 4 && !isNaN(Date.parse(s)) ? s : null;
}

import { db } from "../../db/index.js";
import { investors } from "../../db/schema.js";
import { eq, asc } from "drizzle-orm";

export default async (req: Request) => {
  const url = new URL(req.url);
  const action = url.searchParams.get("action") || "";

  try {
    if (req.method === "GET" && !action) {
      const rows = await db.select().from(investors).orderBy(asc(investors.firm)).limit(1000);
      return Response.json(rows.map(dbToApp));
    }

    if (req.method === "POST" && action === "upsert") {
      const inv = await req.json();
      const row = appToDb(inv);
      const result = await db
        .insert(investors)
        .values(row)
        .onConflictDoUpdate({ target: investors.id, set: row })
        .returning();
      return Response.json(result[0] ? dbToApp(result[0]) : {});
    }

    if (req.method === "POST" && action === "bulk") {
      const invs: any[] = await req.json();
      const allRows = invs.map(appToDb);
      let saved = 0;
      const failed: { id: string; firm: string; err: string }[] = [];

      for (let i = 0; i < allRows.length; i += 25) {
        const chunk = allRows.slice(i, i + 25);
        try {
          for (const row of chunk) {
            await db
              .insert(investors)
              .values(row)
              .onConflictDoUpdate({ target: investors.id, set: row });
          }
          saved += chunk.length;
        } catch (e: any) {
          for (const row of chunk) {
            try {
              await db
                .insert(investors)
                .values(row)
                .onConflictDoUpdate({ target: investors.id, set: row });
              saved++;
            } catch (e2: any) {
              failed.push({ id: row.id, firm: row.firm, err: e2.message });
            }
          }
        }
      }

      return Response.json({ saved, total: allRows.length, failed });
    }

    if (req.method === "DELETE") {
      const id = url.searchParams.get("id");
      if (!id) return Response.json({ error: "id required" }, { status: 400 });
      await db.delete(investors).where(eq(investors.id, id));
      return Response.json({ deleted: id });
    }

    return Response.json({ error: "Unknown action" }, { status: 400 });
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 500 });
  }
};

function appToDb(inv: any) {
  let tl = inv.timeline || [];
  if (typeof tl === "string") { try { tl = JSON.parse(tl); } catch { tl = []; } }
  if (!Array.isArray(tl)) tl = [];

  const row: any = {
    id: String(inv.id || "inv_" + Date.now() + "_" + Math.random().toString(36).substr(2, 5)),
    firm: String(inv.firm || ""),
    contact: String(inv.contact || ""),
    email: String(inv.email || ""),
    website: String(inv.website || ""),
    linkedin: String(inv.linkedin || ""),
    status: String(inv.status || "new"),
    nda: String(inv.nda || "none"),
    checkSize: String(inv.checkSize || ""),
    owner: String(inv.owner || ""),
    stage: String(inv.stage || ""),
    thesis: String(inv.thesis || ""),
    notes: String(inv.notes || ""),
    timeline: tl,
    createdAt: validTs(inv.created) || new Date().toISOString(),
  };

  const lc = String(inv.lastContact || "");
  if (lc.length >= 10 && !isNaN(Date.parse(lc.substring(0, 10)))) row.lastContact = lc.substring(0, 10);

  const nm = String(inv.nextMeeting || "");
  if (nm.length >= 10 && !isNaN(Date.parse(nm.substring(0, 10)))) row.nextMeeting = nm.substring(0, 10);

  const pa = String(inv.profiledAt || "");
  if (pa.length > 4 && !isNaN(Date.parse(pa))) row.profiledAt = pa;

  return row;
}

function dbToApp(row: any) {
  let tl = row.timeline || [];
  if (typeof tl === "string") { try { tl = JSON.parse(tl); } catch { tl = []; } }
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
    checkSize: row.checkSize || "",
    owner: row.owner || "",
    stage: row.stage || "",
    thesis: row.thesis || "",
    notes: row.notes || "",
    timeline: tl,
    lastContact: row.lastContact || "",
    nextMeeting: row.nextMeeting || "",
    profiledAt: row.profiledAt || "",
    created: row.createdAt || "",
  };
}

function validTs(v: any) {
  if (!v) return null;
  const s = String(v);
  return s.length >= 4 && !isNaN(Date.parse(s)) ? s : null;
}

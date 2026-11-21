import { ObjectId, type Db } from "mongodb";
import { z } from "zod";
import { getAuthenticatedAdmin } from "@/lib/auth";
import { connectToDatabase } from "@/lib/mongodb";
import {
  ANNOUNCEMENTS_COLLECTION, ANNOUNCEMENT_READS_COLLECTION, NOTIFICATION_DELIVERIES_COLLECTION,
} from "@/lib/announcements";

const normal = { $or: [{ isImportant: false }, { isImportant: { $exists: false } }] };
const maxCustomSelection = 5000;
const input = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("custom"), confirmed: z.literal(true),
    ids: z.array(z.string().regex(/^[a-f0-9]{24}$/i)).min(1).max(maxCustomSelection) }).strict(),
  z.object({ mode: z.literal("general"), confirmed: z.literal(true),
    expected: z.number().int().nonnegative() }).strict(),
]);
const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

async function preview(db: Db) {
  const [counts] = await db.collection(ANNOUNCEMENTS_COLLECTION).aggregate<{
    total: number; important: number; eligible: number;
  }>([{ $group: { _id: null, total: { $sum: 1 },
    important: { $sum: { $cond: [{ $eq: ["$isImportant", true] }, 1, 0] } },
    eligible: { $sum: { $cond: [{ $or: [
      { $eq: ["$isImportant", false] }, { $eq: [{ $type: "$isImportant" }, "missing"] },
    ] }, 1, 0] } },
  } }, { $project: { _id: 0 } }]).toArray();
  return counts ?? { total: 0, important: 0, eligible: 0 };
}

export async function GET(request: Request) {
  try {
    if (!(await getAuthenticatedAdmin())) return json({ error: "Unauthorized" }, 401);
    const { db } = await connectToDatabase();
    if (new URL(request.url).searchParams.get("select") === "all") {
      const rows = await db.collection(ANNOUNCEMENTS_COLLECTION)
        .find(normal, { projection: { _id: 1 } }).limit(maxCustomSelection + 1).toArray();
      if (rows.length > maxCustomSelection) {
        return json({ error: "More than 5,000 announcements are eligible. Use General Delete or select a smaller group." }, 409);
      }
      return json({ ids: rows.map((row) => row._id.toHexString()) });
    }
    return json(await preview(db));
  } catch (error) {
    console.error("Announcement deletion preview failed", error);
    return json({ error: "Unable to load deletion preview." }, 500);
  }
}

export async function POST(request: Request) {
  try {
    if (!(await getAuthenticatedAdmin())) return json({ error: "Unauthorized" }, 401);
    if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") {
      return json({ error: "Use an application/json request." }, 415);
    }
    const parsed = input.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return json({ error: "Choose a delete mode and confirm the operation." }, 400);
    const body = parsed.data;
    const { client, db } = await connectToDatabase();
    const requested = body.mode === "custom"
      ? [...new Set(body.ids.map((id) => id.toLowerCase()))].map((id) => new ObjectId(id)) : null;

    const result = await client.withSession((session) => session.withTransaction(async () => {
      const announcements = db.collection(ANNOUNCEMENTS_COLLECTION);
      const filter = requested ? { ...normal, _id: { $in: requested } } : normal;
      const matches = await announcements.find(filter, { session, projection: { _id: 1 } }).toArray();
      if (body.mode === "general" && matches.length !== body.expected) return null;
      const ids = matches.map((match) => match._id);
      let deleted = 0;
      let readsDeleted = 0;
      let deliveriesDeleted = 0;
      for (let offset = 0; offset < ids.length; offset += 500) {
        const batch = ids.slice(offset, offset + 500);
        const removed = await announcements.deleteMany({ ...normal, _id: { $in: batch } }, { session });
        if (removed.deletedCount !== batch.length) throw new Error("Announcement eligibility changed");
        deleted += removed.deletedCount;
        readsDeleted += (await db.collection(ANNOUNCEMENT_READS_COLLECTION)
          .deleteMany({ announcementId: { $in: batch } }, { session })).deletedCount;
        deliveriesDeleted += (await db.collection(NOTIFICATION_DELIVERIES_COLLECTION)
          .deleteMany({ announcementId: { $in: batch } }, { session })).deletedCount;
      }
      return { deleted, readsDeleted, deliveriesDeleted, skipped: requested ? requested.length - deleted : 0 };
    }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } }));
    if (!result) return json({ error: "The number eligible for deletion changed. Review the refreshed preview and confirm again." }, 409);
    return json(result);
  } catch (error) {
    console.error("Bulk announcement deletion failed", error);
    return json({ error: "Deletion could not be confirmed. Refresh history before retrying." }, 500);
  }
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { ObjectId } from "mongodb";
import { getAuthenticatedAdmin } from "@/lib/auth";
import { getDb } from "@/lib/mongodb";
import {
  ANNOUNCEMENTS_COLLECTION,
  ANNOUNCEMENT_READS_COLLECTION,
  NOTIFICATION_DELIVERIES_COLLECTION,
  ensureAnnouncementIndexes,
  recomputeAnnouncementStats,
  serializeAnnouncementForAdmin,
} from "@/lib/announcements";

const importance = z.object({ isImportant: z.boolean() }).strict();

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    if (!(await getAuthenticatedAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") {
      return NextResponse.json({ error: "Use an application/json request." }, { status: 415 });
    }
    const { id } = await ctx.params;
    const parsed = importance.safeParse(await request.json().catch(() => null));
    if (!ObjectId.isValid(id) || !parsed.success) return NextResponse.json({ error: "Invalid importance update" }, { status: 400 });
    const db = await getDb();
    const result = await db.collection(ANNOUNCEMENTS_COLLECTION).updateOne(
      { _id: new ObjectId(id) }, { $set: { ...parsed.data, updatedAt: new Date() } }
    );
    return result.matchedCount ? NextResponse.json(parsed.data)
      : NextResponse.json({ error: "Announcement not found" }, { status: 404 });
  } catch (error) {
    console.error("Announcement importance update failed", error);
    return NextResponse.json({ error: "Failed to update importance" }, { status: 500 });
  }
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const admin = await getAuthenticatedAdmin();
    if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await ctx.params;
    if (!ObjectId.isValid(id)) return NextResponse.json({ error: "Invalid announcement id" }, { status: 400 });

    const db = await getDb();
    await ensureAnnouncementIndexes(db);
    const announcementId = new ObjectId(id);
    const announcement = await db.collection(ANNOUNCEMENTS_COLLECTION).findOne({ _id: announcementId });
    if (!announcement) return NextResponse.json({ error: "Announcement not found" }, { status: 404 });

    const deliveryStats = await recomputeAnnouncementStats(db, announcementId);
    const readCount = await db.collection(ANNOUNCEMENT_READS_COLLECTION).countDocuments({ announcementId });

    const deliveryBreakdown = await db
      .collection(NOTIFICATION_DELIVERIES_COLLECTION)
      .aggregate([
        { $match: { announcementId } },
        { $group: { _id: "$errorCode", count: { $sum: 1 }, status: { $first: "$status" } } },
        { $sort: { count: -1 } },
        { $limit: 10 },
      ])
      .toArray();

    return NextResponse.json({
      success: true,
      announcement: { ...serializeAnnouncementForAdmin({ ...(announcement as any), deliveryStats }), deliveryStats },
      details: {
        readCount,
        deliveryBreakdown: deliveryBreakdown.map((d: any) => ({
          errorCode: d._id ?? null,
          status: d.status ?? null,
          count: d.count ?? 0,
        })),
      },
    });
  } catch (error) {
    console.error("GET /api/admin/announcements/[id] error:", error);
    return NextResponse.json({ error: "Failed to fetch announcement" }, { status: 500 });
  }
}

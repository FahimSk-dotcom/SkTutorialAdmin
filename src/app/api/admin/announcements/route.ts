import { NextResponse } from "next/server";
import { getAuthenticatedAdmin } from "@/lib/auth";
import { getDb } from "@/lib/mongodb";
import { announcementCreateSchema } from "@/schemas";
import {
  ANNOUNCEMENTS_COLLECTION,
  createAndDeliverAnnouncement,
  ensureAnnouncementIndexes,
  serializeAnnouncementForAdmin,
} from "@/lib/announcements";

export async function GET(req: Request) {
  try {
    const admin = await getAuthenticatedAdmin();
    if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const limit = Math.min(Math.max(parseInt(searchParams.get("limit") || "50", 10) || 50, 1), 200);
    const page = Math.max(1, Math.min(10000, Number.parseInt(searchParams.get("page") ?? "", 10) || 1));
    const db = await getDb();
    await ensureAnnouncementIndexes(db);

    const announcements = await db
      .collection(ANNOUNCEMENTS_COLLECTION)
      .find({})
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit + 1)
      .toArray();

    return NextResponse.json({
      success: true,
      announcements: announcements.slice(0, limit).map((a: any) => serializeAnnouncementForAdmin(a)),
      hasMore: announcements.length > limit,
    });
  } catch (error) {
    console.error("GET /api/admin/announcements error:", error);
    return NextResponse.json({ error: "Failed to fetch announcements" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const admin = await getAuthenticatedAdmin();
    if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    const parsed = announcementCreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid announcement data" },
        { status: 400 }
      );
    }

    const db = await getDb();
    const result = await createAndDeliverAnnouncement({
      db,
      title: parsed.data.title,
      message: parsed.data.message,
      type: parsed.data.type,
      targetClasses: parsed.data.targetClasses,
      clientPublishId: parsed.data.clientPublishId ?? null,
      isImportant: parsed.data.isImportant,
      createdBy: { adminId: admin.adminId, email: admin.email, name: admin.name },
    });

    if (result.duplicate) {
      return NextResponse.json(
        {
          success: true,
          duplicate: true,
          announcement: serializeAnnouncementForAdmin(result.announcement as any),
          message: "Announcement already published",
        },
        { status: 200 }
      );
    }

    return NextResponse.json(
      {
        success: true,
        announcement: serializeAnnouncementForAdmin(result.announcement as any),
        delivery: result.delivery
          ? {
              fcm: result.delivery.fcm,
              attemptedTokens: result.delivery.attemptedTokens,
              deliveryStats: result.delivery.deliveryStats,
              deviceCount: result.delivery.deviceCount,
            }
          : undefined,
      },
      { status: 201 }
    );
  } catch (error: any) {
    const msg = String(error?.message || "");
    if (msg === "NO_VALID_CLASSES_SELECTED") {
      return NextResponse.json({ error: "Select at least one valid class" }, { status: 400 });
    }
    if (error?.code === 11000) {
      return NextResponse.json({ error: "Duplicate publish request detected" }, { status: 409 });
    }
    console.error("POST /api/admin/announcements error:", error);
    return NextResponse.json({ error: "Failed to publish announcement" }, { status: 500 });
  }
}

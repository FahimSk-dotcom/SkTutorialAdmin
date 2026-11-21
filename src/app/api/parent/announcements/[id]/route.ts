import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { parentJson, parentOptions } from "@/lib/parent-cors";
import { getAuthenticatedParent, ParentAuthConfigError } from "@/lib/parent-auth";
import {
  ANNOUNCEMENTS_COLLECTION,
  ANNOUNCEMENT_READS_COLLECTION,
  ensureAnnouncementIndexes,
  isAnnouncementEligibleForParent,
  serializeAnnouncementForParent,
} from "@/lib/announcements";

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const auth = await getAuthenticatedParent(request, { requireActiveStudents: true });
    if (!auth.ok) {
      return parentJson(request, { success: false, error: auth.error ?? "Authentication failed" }, auth.status);
    }

    const { id } = await ctx.params;
    if (!ObjectId.isValid(id)) {
      return parentJson(request, { success: false, error: "Announcement not found" }, 404);
    }

    const db = await getDb();
    await ensureAnnouncementIndexes(db);
    const announcementId = new ObjectId(id);
    const announcement = await db.collection(ANNOUNCEMENTS_COLLECTION).findOne({ _id: announcementId, status: "PUBLISHED" });
    if (!announcement || !(await isAnnouncementEligibleForParent(db, announcement as any, auth.parent))) {
      return parentJson(request, { success: false, error: "Announcement not found" }, 404);
    }

    const parentId = auth.parent._id.toString();
    const read = await db
      .collection(ANNOUNCEMENT_READS_COLLECTION)
      .findOne({ announcementId, parentId }, { projection: { readAt: 1 } });

    return parentJson(request, {
      success: true,
      announcement: serializeAnnouncementForParent(announcement as any, (read as any)?.readAt ?? null),
    });
  } catch (error) {
    if (error instanceof ParentAuthConfigError) {
      return parentJson(request, { success: false, error: "Parent service is temporarily unavailable" }, 503);
    }
    console.error("GET /api/parent/announcements/[id] error:", error);
    return parentJson(request, { success: false, error: "Failed to load announcement" }, 500);
  }
}

export function OPTIONS(request: Request) {
  return parentOptions(request);
}

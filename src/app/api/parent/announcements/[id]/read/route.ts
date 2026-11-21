import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { parentJson, parentOptions } from "@/lib/parent-cors";
import { getAuthenticatedParent, ParentAuthConfigError } from "@/lib/parent-auth";
import {
  ANNOUNCEMENTS_COLLECTION,
  ANNOUNCEMENT_READS_COLLECTION,
  ensureAnnouncementIndexes,
  isAnnouncementEligibleForParent,
  writeAnnouncementRelations,
} from "@/lib/announcements";

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
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
    const now = new Date();
    const read = await writeAnnouncementRelations(db, announcementId, async (session) => {
      const collection = db.collection(ANNOUNCEMENT_READS_COLLECTION);
      await collection.updateOne(
      { announcementId, parentId },
      { $setOnInsert: { announcementId, parentId, readAt: now, createdAt: now }, $set: { updatedAt: now } },
        { upsert: true, session }
      );
      return collection.findOne({ announcementId, parentId }, { projection: { readAt: 1 }, session });
    });
    if (!read) return parentJson(request, { success: false, error: "Announcement not found" }, 404);

    return parentJson(request, {
      success: true,
      isRead: true,
      readAt: (read as any)?.readAt instanceof Date ? (read as any).readAt.toISOString() : (read as any)?.readAt ?? now.toISOString(),
    });
  } catch (error) {
    if (error instanceof ParentAuthConfigError) {
      return parentJson(request, { success: false, error: "Parent service is temporarily unavailable" }, 503);
    }
    console.error("POST /api/parent/announcements/[id]/read error:", error);
    return parentJson(request, { success: false, error: "Failed to update read status" }, 500);
  }
}

export function OPTIONS(request: Request) {
  return parentOptions(request);
}

import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { parentJson, parentOptions } from "@/lib/parent-cors";
import { getActiveLinkedStudents, getAuthenticatedParent, ParentAuthConfigError } from "@/lib/parent-auth";
import { normalizeClass } from "@/lib/class-utils";
import {
  ANNOUNCEMENTS_COLLECTION,
  ANNOUNCEMENT_READS_COLLECTION,
  ensureAnnouncementIndexes,
  type AnnouncementDoc,
  serializeAnnouncementForParent,
} from "@/lib/announcements";

export async function GET(request: Request) {
  try {
    const auth = await getAuthenticatedParent(request, { requireActiveStudents: true });
    if (!auth.ok) {
      return parentJson(request, { success: false, error: auth.error ?? "Authentication failed" }, auth.status);
    }

    const { searchParams } = new URL(request.url);
    const limit = Math.min(Math.max(parseInt(searchParams.get("limit") || "20", 10) || 20, 1), 50);
    const page = Math.min(10000, Math.max(1, parseInt(searchParams.get("page") ?? "", 10) || 1));
    const cursor = /^(?:(i|n):)?([a-f0-9]{24})$/i.exec(searchParams.get("cursor") ?? "");

    const db = await getDb();
    await ensureAnnouncementIndexes(db);
    const parentId = auth.parent._id.toString();

    const students = await getActiveLinkedStudents(db, auth.parent.linkedStudentIds);
    const classKeys = [...new Set(students.map((student) => normalizeClass(student.class)).filter(Boolean))];
    const cursorId = cursor ? new ObjectId(cursor[2]) : null;
    const cursorFilter = cursorId && (cursor?.[1] === "i"
      ? { $or: [{ priority: false }, { priority: true, _id: { $lt: cursorId } }] }
      : { priority: false, _id: { $lt: cursorId } });
    const rows = students.length ? await db.collection(ANNOUNCEMENTS_COLLECTION)
      .aggregate<AnnouncementDoc & { _id: ObjectId }>([
        { $match: { status: "PUBLISHED", $or: [
          { type: "GENERAL" }, { type: "CLASS_WISE", targetClassKeys: { $in: classKeys } },
        ] } },
        { $set: { priority: { $eq: [{ $ifNull: ["$isImportant", false] }, true] } } },
        ...(cursorFilter ? [{ $match: cursorFilter }] : []),
        { $sort: { priority: -1, _id: -1 } },
        { $skip: cursorId ? 0 : (page - 1) * limit },
        { $limit: limit + 1 },
      ]).toArray() : [];
    const announcements = rows.slice(0, limit);

    const ids = announcements.map((a) => a._id as ObjectId);
    const reads = ids.length
      ? await db
          .collection(ANNOUNCEMENT_READS_COLLECTION)
          .find({ parentId, announcementId: { $in: ids } })
          .project({ announcementId: 1, readAt: 1 })
          .toArray()
      : [];
    const readMap = new Map<string, Date>();
    for (const r of reads as any[]) {
      readMap.set(String(r.announcementId), r.readAt instanceof Date ? r.readAt : new Date(r.readAt));
    }

    const items = announcements.map((a) => serializeAnnouncementForParent(a, readMap.get(String(a._id)) ?? null));
    const last = announcements.at(-1);
    const hasMore = rows.length > limit;
    const nextCursor = hasMore && last ? `${last.isImportant === true ? "i" : "n"}:${last._id}` : null;
    const unreadCount = items.filter((i) => !i.isRead).length;

    const response = parentJson(request, {
      success: true, announcements: items, nextCursor, unreadCount, pagination: { page, limit, hasMore },
    });
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch (error) {
    if (error instanceof ParentAuthConfigError) {
      return parentJson(request, { success: false, error: "Parent service is temporarily unavailable" }, 503);
    }
    console.error("GET /api/parent/announcements error:", error);
    return parentJson(request, { success: false, error: "Failed to load announcements" }, 500);
  }
}

export function OPTIONS(request: Request) {
  return parentOptions(request);
}

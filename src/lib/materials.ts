import { MongoServerError, type Db, type Filter } from "mongodb";
import { z } from "zod";
import { createAndDeliverAnnouncement, getDistinctActiveClasses, normalizeAnnouncementClasses } from "@/lib/announcements";
import { getClassSortRank, normalizeClass } from "@/lib/class-utils";
import { ALL_CLASSES } from "@/types";
import {
  destroyMaterialFile, fileInput, MaterialError, reserveFiles, uploadTickets,
  verifyUploadedFile, type MaterialFile, type ReservedFile,
} from "@/lib/materials-storage";

const materialType = z.enum(["assignment", "notes"]);
const publication = z.enum(["draft", "published"]);
const uuid = z.uuid();
export const materialFields = z.object({
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(3000),
  type: materialType,
  classes: z.array(z.string().trim().min(1).max(64)).min(1).max(40),
  subject: z.string().trim().min(1).max(80),
  status: publication,
}).strict();
const newFiles = z.array(fileInput).min(1).max(6);
export const newMaterial = z.object({ id: uuid, details: materialFields, files: newFiles, notifyStudents: z.boolean().optional() }).strict();
export const materialUpdate = z.discriminatedUnion("action", [
  z.object({ action: z.literal("details"), revision: z.number().int(), details: materialFields }).strict(),
  z.object({ action: z.literal("prepare"), revision: z.number().int(), operationId: uuid, details: materialFields,
    files: newFiles, notifyStudents: z.boolean().optional() }).strict(),
  z.object({ action: z.enum(["commit", "resume", "discard"]), operationId: uuid }).strict(),
  z.object({ action: z.literal("cleanup") }).strict(),
  z.object({ action: z.literal("notify") }).strict(),
]);

type Details = z.infer<typeof materialFields> & { classKeys: string[]; subjectKey: string };
interface PendingUpload {
  id: string;
  startedAt: Date;
  details: Details;
  files: ReservedFile[];
  notifyStudents?: boolean;
}

interface Material extends Details {
  _id: string;
  files: MaterialFile[];
  cleanup: ReservedFile[];
  pending?: PendingUpload;
  lastOperationId?: string;
  notificationPending?: boolean;
  state: "active" | "uploading" | "deleting";
  revision: number;
  createdAt: Date;
  updatedAt: Date;
  publishedAt: Date | null;
}

const materials = (db: Db) => db.collection<Material>("study_materials", {
  readPreference: "primary", writeConcern: { w: "majority" },
});

let indexes: Promise<unknown> | undefined;
function ensureIndexes(db: Db) {
  indexes ??= materials(db).createIndexes([
    { key: { state: 1, status: 1, classKeys: 1, type: 1, publishedAt: -1, _id: -1 } },
    { key: { state: 1, status: 1, classKeys: 1, type: 1, subjectKey: 1, publishedAt: -1, _id: -1 } },
    { key: { createdAt: -1, _id: -1 } },
  ]).catch((error) => { indexes = undefined; throw error; });
  return indexes;
}

export async function materialClassOptions(db: Db) {
  return normalizeAnnouncementClasses([...(await getDistinctActiveClasses(db)), ...ALL_CLASSES])
    .sort((a, b) => getClassSortRank(a) - getClassSortRank(b) || a.localeCompare(b));
}

async function validateDetails(db: Db, input: z.infer<typeof materialFields>): Promise<Details> {
  const valid = new Map((await materialClassOptions(db)).map((value) => [normalizeClass(value), value]));
  const classKeys = [...new Set(input.classes.map(normalizeClass))];
  if (classKeys.some((key) => !valid.has(key))) throw new MaterialError("Select valid student classes.");
  return {
    ...input, classes: classKeys.map((key) => valid.get(key)!), classKeys,
    subjectKey: input.subject.toLowerCase(),
  };
}

const isId = (id: string) => uuid.safeParse(id).success;
const publicFile = ({ id, originalName, format, size }: ReservedFile) => ({ id, originalName, format, size });

function publicDetails(row: Details) {
  return { title: row.title, description: row.description, type: row.type,
    classes: row.classes, subject: row.subject, status: row.status };
}

function publicMaterial(row: Material) {
  return { id: row._id, ...publicDetails(row), files: row.files.map(publicFile),
    publishedAt: row.publishedAt, createdAt: row.createdAt };
}

function adminMaterial(row: Material) {
  return {
    ...publicMaterial(row), state: row.state, revision: row.revision, updatedAt: row.updatedAt,
    cleanupCount: row.cleanup.length, notificationPending: Boolean(row.notificationPending),
    pending: row.pending ? {
      id: row.pending.id, details: publicDetails(row.pending.details), files: row.pending.files.map(publicFile),
      uploadUntil: new Date(row.pending.startedAt.getTime() + 10 * 60_000),
      discardAfter: row.pending.files[0].cleanupAfter, notifyStudents: Boolean(row.pending.notifyStudents),
    } : null,
  };
}

export type AdminMaterial = ReturnType<typeof adminMaterial>;
export type MaterialUploadTicket = ReturnType<typeof uploadTickets>[number];

function requireMatch(matchedCount: number) {
  if (!matchedCount) throw new MaterialError("The material changed. Refresh the list and try again.", 409);
}

async function readMaterial(db: Db, id: string) {
  if (!isId(id)) throw new MaterialError("Material not found.", 404);
  const row = await materials(db).findOne({ _id: id });
  if (!row) throw new MaterialError("Material not found.", 404);
  return row;
}

function pendingResponse(row: Material, includeTickets = false) {
  return { material: adminMaterial(row), tickets: includeTickets && row.pending
    ? uploadTickets(row.pending.files, row.pending.startedAt) : [] };
}

export async function createMaterial(db: Db, input: z.infer<typeof newMaterial>) {
  const existing = await materials(db).findOne({ _id: input.id });
  if (existing) return pendingResponse(existing, Boolean(existing.pending));
  const details = await validateDetails(db, input.details);
  const now = new Date();
  const row: Material = {
    _id: input.id, ...details, status: "draft", state: "uploading", revision: 0,
    files: [], cleanup: [], createdAt: now, updatedAt: now, publishedAt: null,
    pending: { id: input.id, details, startedAt: now, files: reserveFiles(input.id, input.files, now),
      notifyStudents: input.notifyStudents && details.status === "published" },
  };
  try {
    await materials(db).insertOne(row);
    return pendingResponse(row, true);
  } catch (error) {
    if (!(error instanceof MongoServerError) || error.code !== 11000) throw error;
    const latest = await readMaterial(db, input.id);
    return pendingResponse(latest, Boolean(latest.pending));
  }
}

function publicationDate(row: Material, status: Details["status"], now: Date) {
  return status === "published" ? row.publishedAt ?? now : null;
}

async function cleanFiles(db: Db, row: Material) {
  const files = row.state === "deleting" ? [
    ...row.files, ...row.cleanup, ...(row.pending?.files ?? []),
  ] : row.cleanup;
  const due = files.filter((file) => file.cleanupAfter.getTime() <= Date.now());
  const outcomes = await Promise.allSettled(due.map(destroyMaterialFile));
  const failed = outcomes.filter((outcome) => outcome.status === "rejected").length;
  const remaining = files.length - due.length;
  const retryAt = remaining ? new Date(Math.min(...files.filter((file) => !due.includes(file))
    .map((file) => file.cleanupAfter.getTime()))) : null;
  const wait = retryAt ? ` Retry after ${retryAt.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit" })} IST.` : "";
  const failure = failed ? ` Cloudinary could not remove ${failed} ${failed === 1 ? "file" : "files"}. Retry cleanup.` : "";
  if (row.state === "deleting") {
    if (remaining || failed) {
      return { deleted: false, message: `Hidden from parents. Cloudinary cleanup is pending.${wait}${failure}` };
    }
    await materials(db).deleteOne({ _id: row._id, state: "deleting" });
    return { deleted: true, message: "Material and its Cloudinary files were deleted." };
  }
  const removed = due.filter((_, index) => outcomes[index].status === "fulfilled").map((file) => file.id);
  if (removed.length) await materials(db).updateOne(
    { _id: row._id }, { $pull: { cleanup: { id: { $in: removed } } } }
  );
  return { deleted: false, message: removed.length === files.length
    ? "File cleanup completed." : `Some replaced files still need cleanup.${wait}${failure}` };
}

type AnnouncementAdmin = { adminId: string; email: string; name: string };

async function notifyMaterial(db: Db, row: Material, admin: AnnouncementAdmin) {
  if (!row.notificationPending || !row.lastOperationId || row.status !== "published") return pendingResponse(row);
  const kind = row.type === "notes" ? "notes are" : "assignment is";
  try {
    const result = await createAndDeliverAnnouncement({
      db, type: "CLASS_WISE", targetClasses: row.classes, createdBy: admin,
      clientPublishId: `material:${row._id}:${row.lastOperationId}`,
      title: `${row.type === "notes" ? "New Notes" : "New Assignment"} · ${row.subject}`,
      message: `New ${row.subject} ${kind} available. Open Assignments & Notes to view or download the material.`,
    });
    await materials(db).updateOne({ _id: row._id, lastOperationId: row.lastOperationId },
      { $set: { notificationPending: false } });
    return { ...pendingResponse({ ...row, notificationPending: false }),
      notice: `Announcement published. ${result.announcement.deliveryStats.sent} device notifications accepted by Firebase.` };
  } catch (error) {
    console.error("Study material announcement failed", row._id, error instanceof Error ? error.name : "unknown");
    return { ...pendingResponse(row), notice: "Material saved. Announcement status could not be confirmed. Use Retry Notification." };
  }
}

export async function updateMaterial(db: Db, id: string, input: z.infer<typeof materialUpdate>, admin: AnnouncementAdmin) {
  const row = await readMaterial(db, id);
  if (row.state === "deleting") throw new MaterialError("Deletion is pending. Retry Delete.", 409);
  const collection = materials(db);
  const match = { _id: id, revision: row.revision };
  const now = new Date();

  if (input.action === "cleanup") return cleanFiles(db, row);
  if (input.action === "notify") return notifyMaterial(db, row, admin);
  if (input.action === "details" || input.action === "prepare") {
    if (input.action === "prepare" && row.pending?.id === input.operationId) return pendingResponse(row, true);
    if (input.revision !== row.revision || row.pending || row.state !== "active") {
      throw new MaterialError("Refresh the material or finish its pending upload first.", 409);
    }
    const details = await validateDetails(db, input.details);
    const set = input.action === "prepare"
      ? { pending: { id: input.operationId, details, startedAt: now, files: reserveFiles(id, input.files, now),
        notifyStudents: input.notifyStudents && details.status === "published" } }
      : { ...details, publishedAt: publicationDate(row, details.status, now),
        ...(details.status === "draft" ? { notificationPending: false } : {}) };
    requireMatch((await collection.updateOne(match, { $set: { ...set, updatedAt: now }, $inc: { revision: 1 } })).matchedCount);
    return pendingResponse(await readMaterial(db, id), input.action === "prepare");
  }

  if (input.action === "commit" && row.lastOperationId === input.operationId) return notifyMaterial(db, row, admin);
  if (!row.pending || row.pending.id !== input.operationId) throw new MaterialError("This upload is no longer pending.", 409);
  if (input.action === "resume") return pendingResponse(row, true);
  if (input.action === "discard") {
    if (row.pending.files.some((file) => file.cleanupAfter > now)) {
      throw new MaterialError("Wait until the upload window and its cleanup grace period have closed.", 409);
    }
    if (row.state === "uploading") return deleteMaterial(db, id, row.revision);
    requireMatch((await collection.updateOne(match, {
      $unset: { pending: "" }, $push: { cleanup: { $each: row.pending.files } },
      $set: { updatedAt: now }, $inc: { revision: 1 },
    })).matchedCount);
    return cleanFiles(db, await readMaterial(db, id));
  }

  const files: MaterialFile[] = [];
  for (let start = 0; start < row.pending.files.length; start += 3) {
    files.push(...await Promise.all(row.pending.files.slice(start, start + 3).map(verifyUploadedFile)));
  }
  const details = row.pending.details;
  requireMatch((await collection.updateOne(match, {
    $set: { ...details, files, state: "active", updatedAt: now,
      publishedAt: publicationDate(row, details.status, now), lastOperationId: input.operationId,
      notificationPending: Boolean(row.pending.notifyStudents && details.status === "published") },
    $unset: { pending: "" }, $push: { cleanup: { $each: row.files } }, $inc: { revision: 1 },
  })).matchedCount);
  const saved = await readMaterial(db, id);
  if (row.files.length) await cleanFiles(db, saved).catch(() => undefined);
  return notifyMaterial(db, await readMaterial(db, id), admin);
}

export async function deleteMaterial(db: Db, id: string, revision: number) {
  const row = await readMaterial(db, id);
  if (row.state === "deleting") return cleanFiles(db, row);
  if (row.revision !== revision) throw new MaterialError("The material changed. Refresh before deleting.", 409);
  requireMatch((await materials(db).updateOne({ _id: id, revision }, {
    $set: { state: "deleting", updatedAt: new Date() }, $inc: { revision: 1 },
  })).matchedCount);
  return cleanFiles(db, await readMaterial(db, id));
}

export async function listMaterials(db: Db, params: URLSearchParams, parentClassKey?: string) {
  await ensureIndexes(db);
  const filter: Filter<Material> = parentClassKey === undefined ? {} : {
    state: "active", status: "published", classKeys: parentClassKey,
  };
  const classKey = normalizeClass((params.get("class") ?? "").slice(0, 64));
  const search = (params.get("q") ?? "").trim().slice(0, 100);
  const regex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  const type = materialType.safeParse(params.get("type"));
  const status = publication.safeParse(params.get("status"));
  if (parentClassKey === undefined && classKey) filter.classKeys = classKey;
  if (parentClassKey === undefined && status.success) filter.status = status.data;
  if (type.success) filter.type = type.data;
  const subjectFilter = (params.get("subject") ?? "").trim().slice(0, 80).toLowerCase();
  const subjectsFilter = { ...filter };
  if (subjectFilter) filter.subjectKey = subjectFilter;
  if (search) filter.$or = [{ title: regex }, { description: regex }, { subject: regex }];
  const page = Math.min(1000, Math.max(1, Number.parseInt(params.get("page") ?? "", 10) || 1));
  const pageSize = 15;
  const collection = materials(db);
  const order = parentClassKey === undefined ? "createdAt" : "publishedAt";
  const [rows, subjects] = await Promise.all([
    collection.find(filter).sort({ [order]: -1, _id: -1 }).skip((page - 1) * pageSize).limit(pageSize + 1).toArray(),
    collection.aggregate<{ name: string }>([
      { $match: subjectsFilter }, { $group: { _id: "$subjectKey", name: { $first: "$subject" } } },
      { $sort: { name: 1 } }, { $limit: 100 },
    ]).toArray(),
  ]);
  return {
    items: rows.slice(0, pageSize).map(parentClassKey === undefined ? adminMaterial : publicMaterial),
    subjects: subjects.map(({ name }) => name), page, hasMore: rows.length > pageSize,
  };
}

export async function parentMaterial(db: Db, id: string, classKey: string) {
  if (!isId(id) || !classKey) throw new MaterialError("Material not found.", 404);
  const row = await materials(db).findOne({ _id: id, classKeys: classKey, state: "active", status: "published" });
  if (!row) throw new MaterialError("Material not found.", 404);
  return row;
}

export const getParentMaterialDetails = async (db: Db, id: string, classKey: string) =>
  publicMaterial(await parentMaterial(db, id, classKey));

export async function getMaterialFile(db: Db, id: string, fileId: string, classKey?: string) {
  const row = classKey === undefined ? await readMaterial(db, id) : await parentMaterial(db, id, classKey);
  const file = row.state === "active" && row.files.find((entry) => entry.id === fileId);
  if (!file) throw new MaterialError("File not found.", 404);
  return file;
}

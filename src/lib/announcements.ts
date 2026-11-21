import { ObjectId, type AnyBulkWriteOperation, type ClientSession, type Db, type Document } from "mongodb";
import { connectToDatabase } from "./mongodb";
import { normalizeClass } from "./class-utils";
import {
  PARENTS_COLLECTION,
  STUDENTS_COLLECTION,
  getActiveLinkedStudents,
  isParentActive,
  normalizeLinkedStudentIds,
  type ParentDocument,
} from "./parent-auth";
import { chunkArray, getFcmStatus, sendFcmToTokens } from "./fcm";

export const ANNOUNCEMENTS_COLLECTION = "announcements";
export const PARENT_DEVICES_COLLECTION = "parent_devices";
export const NOTIFICATION_DELIVERIES_COLLECTION = "notification_deliveries";
export const ANNOUNCEMENT_READS_COLLECTION = "announcement_reads";

export type AnnouncementType = "GENERAL" | "CLASS_WISE";
export type DeliveryStatus = "PENDING" | "SENT" | "FAILED";

export interface AnnouncementDoc {
  isImportant?: boolean;
  _id?: ObjectId;
  title: string;
  message: string;
  type: AnnouncementType;
  targetClasses: string[];
  targetClassKeys: string[]; // normalized for matching
  createdBy: { adminId?: string; email?: string; name?: string };
  createdAt: Date;
  updatedAt: Date;
  status: "PUBLISHED" | "FAILED";
  notificationSound: "default";
  visibility: "BOTH";
  clientPublishId?: string | null;
  relatedWriteVersion?: number;
  audience: {
    targetType: AnnouncementType;
    selectedClasses: string[];
  };
  recipientCount: number;
  deviceCount: number;
  deliveryStats: { pending: number; sent: number; failed: number };
}

export interface ParentDeviceDoc {
  _id?: ObjectId;
  parentId: string;
  parentMobile: string;
  fcmToken: string;
  platform: "android" | "ios" | "web";
  deviceId?: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  lastTokenRefreshAt: Date;
  lastSeenAt: Date;
  invalidatedAt?: Date | null;
  invalidReason?: string | null;
}

type IndexCache = { done: boolean; promise?: Promise<void> };
type GlobalWithAnnouncementIndexes = typeof globalThis & { __skAnnouncementIndexes?: IndexCache };

function getIndexCache(): IndexCache {
  const g = globalThis as GlobalWithAnnouncementIndexes;
  if (!g.__skAnnouncementIndexes) g.__skAnnouncementIndexes = { done: false };
  return g.__skAnnouncementIndexes;
}

function isIgnorableIndexConflict(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const err = error as { code?: number; codeName?: string; message?: string };
  if (err.code === 85 || err.code === 86) return true;
  if (err.codeName === "IndexOptionsConflict" || err.codeName === "IndexKeySpecsConflict") return true;
  return /already exists/i.test(err.message ?? "");
}

async function safeCreateIndex(col: any, keys: Record<string, 1 | -1>, options: Record<string, any>) {
  try {
    await col.createIndex(keys, options);
  } catch (error) {
    if (!isIgnorableIndexConflict(error)) throw error;
  }
}

export async function ensureAnnouncementIndexes(db: Db): Promise<void> {
  const cache = getIndexCache();
  if (cache.done) return;
  if (cache.promise) { await cache.promise; return; }
  cache.promise = (async () => {
    await Promise.all([
      safeCreateIndex(db.collection(ANNOUNCEMENTS_COLLECTION), { createdAt: -1 }, {}),
      safeCreateIndex(db.collection(ANNOUNCEMENTS_COLLECTION), { type: 1, createdAt: -1 }, {}),
      safeCreateIndex(db.collection(ANNOUNCEMENTS_COLLECTION), { "audience.selectedClasses": 1, createdAt: -1 }, {}),
      safeCreateIndex(db.collection(ANNOUNCEMENTS_COLLECTION), { clientPublishId: 1 }, { unique: true, sparse: true }),

      safeCreateIndex(db.collection(PARENT_DEVICES_COLLECTION), { fcmToken: 1 }, { unique: true }),
      safeCreateIndex(db.collection(PARENT_DEVICES_COLLECTION), { parentId: 1, isActive: 1, updatedAt: -1 }, {}),
      safeCreateIndex(db.collection(PARENT_DEVICES_COLLECTION), { deviceId: 1, isActive: 1 }, {}),
      safeCreateIndex(db.collection(PARENT_DEVICES_COLLECTION), { parentMobile: 1, isActive: 1 }, {}),

      safeCreateIndex(db.collection(NOTIFICATION_DELIVERIES_COLLECTION), { announcementId: 1, parentId: 1 }, {}),
      safeCreateIndex(db.collection(NOTIFICATION_DELIVERIES_COLLECTION), { announcementId: 1, deviceId: 1 }, { unique: true, sparse: true }),
      safeCreateIndex(db.collection(NOTIFICATION_DELIVERIES_COLLECTION), { announcementId: 1, fcmToken: 1 }, {}),
      safeCreateIndex(db.collection(NOTIFICATION_DELIVERIES_COLLECTION), { status: 1, createdAt: -1 }, {}),

      safeCreateIndex(db.collection(ANNOUNCEMENT_READS_COLLECTION), { announcementId: 1, parentId: 1 }, { unique: true }),
      safeCreateIndex(db.collection(ANNOUNCEMENT_READS_COLLECTION), { parentId: 1, readAt: -1 }, {}),
    ]);
    cache.done = true;
  })().finally(() => { if (!cache.done) cache.promise = undefined; });
  await cache.promise;
}

export function normalizeAnnouncementClasses(classes: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of classes) {
    const value = String(raw ?? "").trim();
    if (!value) continue;
    const key = normalizeClass(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

export async function getDistinctActiveClasses(db: Db): Promise<string[]> {
  const rows = await db
    .collection(STUDENTS_COLLECTION)
    .aggregate([
      { $match: { status: "Active" } },
      { $group: { _id: "$class" } },
      { $sort: { _id: 1 } },
    ])
    .toArray();
  const seen = new Set<string>();
  const classes: string[] = [];
  for (const row of rows) {
    const value = String((row as any)._id ?? "").trim();
    if (!value) continue;
    const key = normalizeClass(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    classes.push(value);
  }
  return classes;
}

export interface EligibleParentRecipient {
  parentId: string;
  parentMobile: string;
  parentName: string;
  linkedStudentIds: string[];
  eligibleStudentIds: string[];
  eligibleClasses: string[];
}

export async function resolveEligibleRecipients(
  db: Db,
  input: { type: AnnouncementType; targetClasses: string[] }
): Promise<{ recipients: EligibleParentRecipient[]; targetClassKeys: string[]; selectedClasses: string[] }> {
  const selectedClasses = input.type === "CLASS_WISE" ? normalizeAnnouncementClasses(input.targetClasses) : [];
  const targetClassKeys = selectedClasses.map((c) => normalizeClass(c)).filter(Boolean);
  const targetKeySet = new Set(targetClassKeys);

  const parents = await db
    .collection<ParentDocument>(PARENTS_COLLECTION)
    .find({ isActive: true }, { projection: { passwordHash: 0 } })
    .toArray();

  const recipients: EligibleParentRecipient[] = [];
  for (const parent of parents) {
    if (!isParentActive(parent)) continue;
    const linkedStudentIds = normalizeLinkedStudentIds(parent.linkedStudentIds);
    if (linkedStudentIds.length === 0) continue;
    const activeStudents = await getActiveLinkedStudents(db, linkedStudentIds);
    if (activeStudents.length === 0) continue;

    let eligibleStudents = activeStudents;
    if (input.type === "CLASS_WISE") {
      eligibleStudents = activeStudents.filter((s) => targetKeySet.has(normalizeClass(s.class)));
    }
    if (eligibleStudents.length === 0) continue;

    const eligibleClasses: string[] = [];
    const seenClasses = new Set<string>();
    for (const s of eligibleStudents) {
      const key = normalizeClass(s.class);
      if (!key || seenClasses.has(key)) continue;
      seenClasses.add(key);
      eligibleClasses.push(s.class);
    }

    recipients.push({
      parentId: parent._id.toString(),
      parentMobile: String(parent.parentMobile || ""),
      parentName: String(parent.parentName || ""),
      linkedStudentIds,
      eligibleStudentIds: eligibleStudents.map((s) => s.studentId),
      eligibleClasses,
    });
  }

  // Dedupe by parentId (logical recipient)
  const byParent = new Map<string, EligibleParentRecipient>();
  for (const r of recipients) {
    if (!byParent.has(r.parentId)) byParent.set(r.parentId, r);
  }

  return { recipients: Array.from(byParent.values()), targetClassKeys, selectedClasses };
}

export async function getActiveDevicesForParents(
  db: Db,
  parentIds: string[]
): Promise<Map<string, ParentDeviceDoc[]>> {
  const map = new Map<string, ParentDeviceDoc[]>();
  if (parentIds.length === 0) return map;
  const devices = await db
    .collection<ParentDeviceDoc>(PARENT_DEVICES_COLLECTION)
    .find({ parentId: { $in: parentIds }, isActive: true })
    .toArray();
  for (const d of devices) {
    const list = map.get(d.parentId) ?? [];
    list.push(d);
    map.set(d.parentId, list);
  }
  return map;
}

export async function invalidateParentPushToken(db: Db, token: string, reason: string, parentId?: string) {
  const now = new Date();
  await db.collection(PARENT_DEVICES_COLLECTION).updateMany(
    { fcmToken: token, isActive: true, ...(parentId ? { parentId } : {}) },
    { $set: { isActive: false, invalidatedAt: now, invalidReason: reason, updatedAt: now } }
  );
}

export async function recomputeAnnouncementStats(db: Db, announcementId: ObjectId) {
  const rows = await db
    .collection(NOTIFICATION_DELIVERIES_COLLECTION)
    .aggregate([
      { $match: { announcementId } },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ])
    .toArray();
  const stats = { pending: 0, sent: 0, failed: 0 };
  for (const r of rows) {
    // Delivery rows use uppercase statuses (PENDING/SENT/FAILED) while the
    // stats object uses lowercase keys. Normalise before counting.
    const key = String(r._id ?? '').toLowerCase() as keyof typeof stats;
    if (key in stats) stats[key] = Number(r.count || 0);
  }
  await db.collection(ANNOUNCEMENTS_COLLECTION).updateOne(
    { _id: announcementId },
    { $set: { deliveryStats: stats, updatedAt: new Date() } }
  );
  return stats;
}

// Serialize child-record writes with deletion by writing the parent in the same transaction.
export async function writeAnnouncementRelations<T>(db: Db, id: ObjectId, write: (session: ClientSession) => Promise<T>) {
  const { client } = await connectToDatabase();
  return client.withSession((session) => session.withTransaction(async () => {
    const guard = await db.collection(ANNOUNCEMENTS_COLLECTION).updateOne(
      { _id: id }, { $inc: { relatedWriteVersion: 1 } }, { session }
    );
    return guard.matchedCount ? write(session) : null;
  }));
}

export async function deliverAnnouncement(
  db: Db,
  announcement: AnnouncementDoc & { _id: ObjectId },
  recipients: EligibleParentRecipient[]
) {
  await ensureAnnouncementIndexes(db);
  const fcmStatus = getFcmStatus();
  const parentIds = recipients.map((r) => r.parentId);
  const devicesByParent = await getActiveDevicesForParents(db, parentIds);
  const now = new Date();

  // Ensure delivery records exist (idempotent per announcement+device token hash/id surrogate)
  const deviceWrites = new Map<string, AnyBulkWriteOperation<Document>>();
  for (const recipient of recipients) {
    const devices = devicesByParent.get(recipient.parentId) ?? [];
    for (const device of devices) {
      const deliveryDeviceId = device.deviceId ? `${recipient.parentId}:${device.deviceId}` : `${recipient.parentId}:token:${device.fcmToken}`;
      deviceWrites.set(deliveryDeviceId, { updateOne: {
          filter: { announcementId: announcement._id, deviceId: deliveryDeviceId },
          update: {
            $setOnInsert: {
              announcementId: announcement._id,
              parentId: recipient.parentId,
              parentMobile: recipient.parentMobile,
              deviceId: deliveryDeviceId,
              fcmToken: device.fcmToken,
              status: "PENDING" as DeliveryStatus,
              createdAt: now,
              updatedAt: now,
            },
          },
          upsert: true,
        } });
    }
  }
  if (deviceWrites.size) await writeAnnouncementRelations(db, announcement._id, (session) =>
    db.collection(NOTIFICATION_DELIVERIES_COLLECTION).bulkWrite([...deviceWrites.values()], { session })
  );

  // Refresh pending deliveries to send (including retries of prior failed? no - only pending/unsent)
  const pending = await db
    .collection(NOTIFICATION_DELIVERIES_COLLECTION)
    .find({ announcementId: announcement._id, status: "PENDING" })
    .project({ _id: 1, fcmToken: 1, deviceId: 1, parentId: 1 })
    .toArray();

  const tokenToDeliveryIds = new Map<string, ObjectId[]>();
  for (const d of pending) {
    const token = String((d as any).fcmToken || "");
    if (!token) continue;
    const list = tokenToDeliveryIds.get(token) ?? [];
    list.push((d as any)._id as ObjectId);
    tokenToDeliveryIds.set(token, list);
  }
  const tokens = Array.from(tokenToDeliveryIds.keys());

  let sentCount = 0;
  let failedCount = 0;
  if (tokens.length > 0) {
    for (const batch of chunkArray(tokens, 500)) {
      const result = await sendFcmToTokens({
        tokens: batch,
        title: announcement.title,
        body: announcement.message.length > 180 ? `${announcement.message.slice(0, 177)}...` : announcement.message,
        data: {
          type: "announcement",
          announcementId: announcement._id.toString(),
          announcementType: announcement.type,
        },
      });
      for (const r of result.results) {
        const ids = tokenToDeliveryIds.get(r.token) ?? [];
        if (ids.length === 0) continue;
        if (r.ok) {
          sentCount += ids.length;
          await db.collection(NOTIFICATION_DELIVERIES_COLLECTION).updateMany(
            { _id: { $in: ids } },
            { $set: { status: "SENT", messageId: r.messageId ?? null, sentAt: new Date(), updatedAt: new Date(), errorCode: null, errorMessage: null } }
          );
        } else {
          failedCount += ids.length;
          await db.collection(NOTIFICATION_DELIVERIES_COLLECTION).updateMany(
            { _id: { $in: ids } },
            { $set: { status: "FAILED", errorCode: r.errorCode ?? "FCM_SEND_FAILED", errorMessage: r.errorMessage ?? "Failed to send", updatedAt: new Date() } }
          );
          if (r.invalidToken) {
            await invalidateParentPushToken(db, r.token, r.errorCode ?? "invalid_token");
          }
        }
      }
    }
  }

  const stats = await recomputeAnnouncementStats(db, announcement._id);
  return {
    fcm: fcmStatus,
    attemptedTokens: tokens.length,
    sentCount,
    failedCount,
    deliveryStats: stats,
    deviceCount: tokens.length,
  };
}

export async function createAndDeliverAnnouncement(input: {
  db: Db;
  title: string;
  message: string;
  type: AnnouncementType;
  targetClasses: string[];
  createdBy: { adminId?: string; email?: string; name?: string };
  clientPublishId?: string | null;
  isImportant?: boolean;
}) {
  const { db } = input;
  await ensureAnnouncementIndexes(db);

  if (input.clientPublishId) {
    const existing = await db.collection<AnnouncementDoc>(ANNOUNCEMENTS_COLLECTION).findOne({ clientPublishId: input.clientPublishId });
    if (existing && existing._id) {
      return { announcement: existing, duplicate: true };
    }
  }

  const resolved = await resolveEligibleRecipients(db, { type: input.type, targetClasses: input.targetClasses });
  if (input.type === "CLASS_WISE" && resolved.selectedClasses.length === 0) {
    throw new Error("NO_VALID_CLASSES_SELECTED");
  }
  if (input.type === "CLASS_WISE" && resolved.targetClassKeys.length === 0) {
    throw new Error("NO_VALID_CLASSES_SELECTED");
  }

  const parentIds = resolved.recipients.map((r) => r.parentId);
  const devicesByParent = await getActiveDevicesForParents(db, parentIds);
  let deviceCount = 0;
  for (const pid of parentIds) deviceCount += (devicesByParent.get(pid) ?? []).length;

  const now = new Date();
  const doc: AnnouncementDoc = {
    isImportant: input.isImportant === true,
    title: input.title.trim(),
    message: input.message.trim(),
    type: input.type,
    targetClasses: resolved.selectedClasses,
    targetClassKeys: resolved.targetClassKeys,
    createdBy: input.createdBy,
    createdAt: now,
    updatedAt: now,
    status: "PUBLISHED",
    notificationSound: "default",
    visibility: "BOTH",
    clientPublishId: input.clientPublishId ?? null,
    audience: {
      targetType: input.type,
      selectedClasses: resolved.selectedClasses,
    },
    recipientCount: resolved.recipients.length,
    deviceCount,
    deliveryStats: { pending: 0, sent: 0, failed: 0 },
  };

  let insertedId: ObjectId;
  try {
    const res = await db.collection<AnnouncementDoc>(ANNOUNCEMENTS_COLLECTION).insertOne(doc as any);
    insertedId = res.insertedId;
  } catch (error: any) {
    if (input.clientPublishId && error?.code === 11000) {
      const existing = await db.collection<AnnouncementDoc>(ANNOUNCEMENTS_COLLECTION).findOne({ clientPublishId: input.clientPublishId });
      if (existing) return { announcement: existing, duplicate: true };
    }
    throw error;
  }

  const announcement = { ...doc, _id: insertedId };
  // Precompute pending stats for recipients with devices and deliver
  const delivery = await deliverAnnouncement(db, announcement, resolved.recipients);
  const fresh = await db.collection<AnnouncementDoc>(ANNOUNCEMENTS_COLLECTION).findOne({ _id: insertedId });
  return { announcement: fresh ?? { ...announcement, deliveryStats: delivery.deliveryStats, deviceCount: delivery.deviceCount }, duplicate: false, delivery };
}

export async function registerParentDevice(input: {
  db: Db;
  parentId: string;
  parentMobile: string;
  fcmToken: string;
  platform: "android" | "ios" | "web";
  deviceId?: string | null;
}) {
  const { db } = input;
  await ensureAnnouncementIndexes(db);
  const now = new Date();
  const token = input.fcmToken.trim();
  const deviceId = input.deviceId?.trim() || null;

  // If token exists, reassign/update to this parent (same device/app reinstall cases) safely
  await db.collection<ParentDeviceDoc>(PARENT_DEVICES_COLLECTION).updateOne(
    { fcmToken: token },
    {
      $set: {
        parentId: input.parentId,
        parentMobile: input.parentMobile,
        platform: input.platform,
        deviceId,
        isActive: true,
        updatedAt: now,
        lastTokenRefreshAt: now,
        lastSeenAt: now,
        invalidatedAt: null,
        invalidReason: null,
      },
      $setOnInsert: { createdAt: now },
    },
    { upsert: true }
  );

  // If a deviceId is known, deactivate older active tokens for same parent+deviceId except current token
  if (deviceId) {
    await db.collection<ParentDeviceDoc>(PARENT_DEVICES_COLLECTION).updateMany(
      { parentId: input.parentId, deviceId, fcmToken: { $ne: token }, isActive: true },
      { $set: { isActive: false, updatedAt: now, invalidatedAt: now, invalidReason: "replaced_by_new_token" } }
    );
  }

  return db.collection<ParentDeviceDoc>(PARENT_DEVICES_COLLECTION).findOne(
    { fcmToken: token },
    { projection: { fcmToken: 0 } }
  );
}

export async function unregisterParentDevice(input: {
  db: Db;
  parentId: string;
  fcmToken?: string;
  deviceId?: string;
}) {
  const { db, parentId } = input;
  await ensureAnnouncementIndexes(db);
  const now = new Date();
  const query: Record<string, any> = { parentId, isActive: true };
  if (input.fcmToken) query.fcmToken = input.fcmToken.trim();
  if (input.deviceId) query.deviceId = input.deviceId.trim();
  const res = await db.collection<ParentDeviceDoc>(PARENT_DEVICES_COLLECTION).updateMany(query, {
    $set: { isActive: false, updatedAt: now, invalidatedAt: now, invalidReason: "unregistered" },
  });
  return { modifiedCount: res.modifiedCount };
}

export async function isAnnouncementEligibleForParent(
  db: Db,
  announcement: AnnouncementDoc & { _id?: ObjectId },
  parent: ParentDocument
): Promise<boolean> {
  if (!isParentActive(parent)) return false;
  const activeStudents = await getActiveLinkedStudents(db, parent.linkedStudentIds);
  if (activeStudents.length === 0) return false;
  if (announcement.type === "GENERAL") return true;
  const keys = new Set((announcement.targetClassKeys || []).map((k) => normalizeClass(k)));
  return activeStudents.some((s) => keys.has(normalizeClass(s.class)));
}

export function serializeAnnouncementForParent(
  a: AnnouncementDoc & { _id: ObjectId },
  readAt?: Date | null
) {
  return {
    _id: a._id.toString(),
    title: a.title,
    isImportant: a.isImportant === true,
    message: a.message,
    type: a.type,
    targetClasses: a.targetClasses || [],
    createdAt: a.createdAt instanceof Date ? a.createdAt.toISOString() : a.createdAt,
    status: a.status,
    notificationSound: a.notificationSound,
    visibility: a.visibility,
    isRead: Boolean(readAt),
    readAt: readAt ? (readAt instanceof Date ? readAt.toISOString() : readAt) : null,
  };
}

export function serializeAnnouncementForAdmin(a: AnnouncementDoc & { _id: ObjectId }) {
  return {
    _id: a._id.toString(),
    title: a.title,
    isImportant: a.isImportant === true,
    message: a.message,
    type: a.type,
    targetClasses: a.targetClasses || [],
    createdBy: a.createdBy,
    createdAt: a.createdAt instanceof Date ? a.createdAt.toISOString() : a.createdAt,
    updatedAt: a.updatedAt instanceof Date ? a.updatedAt.toISOString() : a.updatedAt,
    status: a.status,
    notificationSound: a.notificationSound,
    visibility: a.visibility,
    recipientCount: a.recipientCount || 0,
    deviceCount: a.deviceCount || 0,
    deliveryStats: a.deliveryStats || { pending: 0, sent: 0, failed: 0 },
  };
}

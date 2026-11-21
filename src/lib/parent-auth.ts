import { createHash, randomUUID } from "node:crypto";
import jwt, { type JwtPayload } from "jsonwebtoken";
import { ObjectId, type Db } from "mongodb";
import { getEnv } from "./env";
import { getDb } from "./mongodb";

export const PARENT_TOKEN_ISSUER = "sk-tutorials-parent";
export const PARENT_TOKEN_AUDIENCE = "sk-tutorials-parent-app";
export const PARENT_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;
export const PARENT_SESSIONS_COLLECTION = "parent_sessions";
export const PARENTS_COLLECTION = "parents";
export const STUDENTS_COLLECTION = "students";

const MOBILE_PATTERN = /^[0-9]{10}$/;
const BEARER_PATTERN = /^Bearer\s+(\S+)$/i;

export class ParentAuthConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ParentAuthConfigError";
  }
}

export interface ParentTokenPayload {
  parentId: string;
  tokenType: "parent";
  jti: string;
  iat: number;
  exp: number;
}

export interface ParentDocument {
  _id: ObjectId;
  parentMobile: string;
  parentName: string;
  passwordHash?: string;
  linkedStudentIds?: unknown;
  isActive?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface ParentSessionDocument {
  _id?: ObjectId;
  jti: string;
  parentId: string;
  deviceIdHash?: string | null;
  createdAt: Date;
  lastUsedAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  userAgent?: string | null;
  ip?: string | null;
}

export interface LinkedParentStudent {
  studentId: string;
  name: string;
  class: string;
  status: "Active";
}

export interface SerializedParent {
  parentId: string;
  parentName: string;
  parentMobile: string;
  status: "ACTIVE" | "INACTIVE";
}

export type ParentAccessRestriction =
  | {
      code: "PARENT_ACCESS_RESTRICTED";
      reason: "PARENT_ACCOUNT_INACTIVE";
      message: "Your parent account is currently inactive.";
    }
  | {
      code: "PARENT_ACCESS_RESTRICTED";
      reason: "NO_ACTIVE_STUDENTS";
      message: "Your linked student account is currently inactive.";
    };

export function parentAccessRestrictedBody(restriction: ParentAccessRestriction) {
  return {
    success: false as const,
    code: restriction.code,
    reason: restriction.reason,
    message: restriction.message,
  };
}

export type ParentAuthFailure = {
  ok: false;
  status: number;
  error?: string;
  restriction?: ParentAccessRestriction;
};

export type ParentAuthSuccess = {
  ok: true;
  token: ParentTokenPayload;
  parent: ParentDocument;
};

export type ParentAuthResult = ParentAuthSuccess | ParentAuthFailure;

type IndexCache = {
  promise?: Promise<void>;
  done: boolean;
};

type GlobalWithParentIndexes = typeof globalThis & {
  __skParentSessionIndexes?: IndexCache;
};

function getIndexCache(): IndexCache {
  const globalWithIndexes = globalThis as GlobalWithParentIndexes;
  if (!globalWithIndexes.__skParentSessionIndexes) {
    globalWithIndexes.__skParentSessionIndexes = { done: false };
  }
  return globalWithIndexes.__skParentSessionIndexes;
}

export function ensureParentAuthConfig(): void {
  try {
    getEnv();
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Missing required configuration";
    throw new ParentAuthConfigError(message);
  }
}

export function isValidParentMobile(value: string): boolean {
  return MOBILE_PATTERN.test(value);
}

export function normalizeParentMobile(value: string): string {
  return value.replace(/[\s-]/g, "").trim();
}

/**
 * Reconcile the parent-side links for a student while the caller's MongoDB
 * transaction is active. Student records remain the source of truth for the
 * parent's mobile number; absent parent accounts are not created here.
 */
export async function reassignStudentParentLinks(
  db: Db,
  session: import("mongodb").ClientSession,
  input: {
    studentId: string;
    previousParentMobile: string;
    nextParentMobile: string;
    now: Date;
  }
): Promise<string[]> {
  const parents = db.collection(PARENTS_COLLECTION);
  const previousMobile = normalizeParentMobile(input.previousParentMobile);
  const nextMobile = normalizeParentMobile(input.nextParentMobile);
  const candidateMobiles: string[] = Array.from(
    new Set([input.previousParentMobile, previousMobile, input.nextParentMobile, nextMobile].filter(Boolean))
  );
  if (candidateMobiles.length === 0) return [];

  const candidates = await parents
    .find({ parentMobile: { $in: candidateMobiles } }, { session })
    .toArray();
  const previousParents = candidates.filter(
    (parent) => normalizeParentMobile(String(parent.parentMobile || "")) === previousMobile
  );
  const nextParents = candidates.filter(
    (parent) => normalizeParentMobile(String(parent.parentMobile || "")) === nextMobile
  );
  const sameParent = previousMobile === nextMobile;
  const affectedPreviousParentIds = previousParents.map((parent) => parent._id.toString());

  if (sameParent) {
    for (const parent of nextParents) {
      await parents.updateOne(
        { _id: parent._id },
        {
          $addToSet: { linkedStudentIds: input.studentId },
          $set: { updatedAt: input.now },
        },
        { session }
      );
    }
    return [];
  }

  for (const parent of previousParents) {
    await parents.updateOne(
      { _id: parent._id },
      ({
        $pull: { linkedStudentIds: { $in: [input.studentId] } },
        $set: { updatedAt: input.now },
      } as any),
      { session }
    );
  }
  for (const parent of nextParents) {
    await parents.updateOne(
      { _id: parent._id },
      {
        $addToSet: { linkedStudentIds: input.studentId },
        $set: { updatedAt: input.now },
      },
      { session }
    );
  }

  return affectedPreviousParentIds;
}

export async function revokeParentSessionsIfNoActiveLinkedStudentsForParents(
  db: Db,
  parentIds: string[]
): Promise<void> {
  const validIds = Array.from(new Set(parentIds.filter(ObjectId.isValid))).map(
    (id) => new ObjectId(id)
  );
  if (validIds.length === 0) return;

  const parents = await db
    .collection<ParentDocument>(PARENTS_COLLECTION)
    .find({ _id: { $in: validIds } }, { projection: { _id: 1, linkedStudentIds: 1, parentMobile: 1 } })
    .toArray();

  for (const parent of parents) {
    const activeStudents = await getActiveLinkedStudents(db, parent.linkedStudentIds, parent.parentMobile);
    if (activeStudents.length === 0) {
      await revokeAllParentSessions(db, parent._id.toString());
    }
  }
}

export function parseBearerToken(
  authorizationHeader: string | null
): string | null {
  if (!authorizationHeader) return null;
  const match = authorizationHeader.match(BEARER_PATTERN);
  const token = match?.[1]?.trim();
  return token ? token : null;
}

export function hashDeviceId(deviceId: string): string {
  return createHash("sha256").update(deviceId).digest("hex");
}

export function signParentToken(parentId: string): {
  token: string;
  jti: string;
  expiresAt: Date;
} {
  const jti = randomUUID();
  const expiresAt = new Date(Date.now() + PARENT_TOKEN_TTL_SECONDS * 1000);
  const secret = getEnv().JWT_PARENT_SECRET;
  if (!secret) {
    throw new ParentAuthConfigError("JWT_PARENT_SECRET is required for parent authentication");
  }
  const token = jwt.sign(
    {
      parentId,
      tokenType: "parent",
    },
    secret,
    {
      algorithm: "HS256",
      expiresIn: PARENT_TOKEN_TTL_SECONDS,
      issuer: PARENT_TOKEN_ISSUER,
      audience: PARENT_TOKEN_AUDIENCE,
      jwtid: jti,
    }
  );

  return { token, jti, expiresAt };
}

export function verifyParentToken(token: string): ParentTokenPayload | null {
  try {
    const secret = getEnv().JWT_PARENT_SECRET;
    if (!secret) return null;
    const decoded = jwt.verify(token, secret, {
      algorithms: ["HS256"],
      issuer: PARENT_TOKEN_ISSUER,
      audience: PARENT_TOKEN_AUDIENCE,
    });

    if (typeof decoded === "string") return null;
    return normalizeParentTokenPayload(decoded);
  } catch {
    return null;
  }
}

function normalizeParentTokenPayload(
  payload: JwtPayload
): ParentTokenPayload | null {
  if (
    payload.tokenType !== "parent" ||
    typeof payload.parentId !== "string" ||
    payload.parentId.length === 0 ||
    typeof payload.jti !== "string" ||
    payload.jti.length === 0 ||
    typeof payload.iat !== "number" ||
    typeof payload.exp !== "number"
  ) {
    return null;
  }

  return {
    parentId: payload.parentId,
    tokenType: "parent",
    jti: payload.jti,
    iat: payload.iat,
    exp: payload.exp,
  };
}

function isIgnorableIndexConflict(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const err = error as { code?: number; codeName?: string; message?: string };
  const code = err.code;
  const codeName = err.codeName ?? "";
  const message = err.message ?? "";

  if (code === 85 || code === 86) return true;
  if (codeName === "IndexOptionsConflict" || codeName === "IndexKeySpecsConflict") {
    return true;
  }

  return /already exists/i.test(message);
}

async function createParentSessionIndex(
  collection: {
    createIndex: (
      keys: Record<string, 1 | -1>,
      options?: { unique?: boolean; expireAfterSeconds?: number }
    ) => Promise<unknown>;
  },
  keys: Record<string, 1 | -1>,
  options: { unique?: boolean; expireAfterSeconds?: number }
): Promise<void> {
  try {
    await collection.createIndex(keys, options);
  } catch (error) {
    if (!isIgnorableIndexConflict(error)) throw error;
  }
}

export async function ensureParentSessionIndexes(db: Db): Promise<void> {
  const cache = getIndexCache();
  if (cache.done) return;
  if (cache.promise) {
    await cache.promise;
    return;
  }

  cache.promise = (async () => {
    const collection = db.collection<ParentSessionDocument>(
      PARENT_SESSIONS_COLLECTION
    );
    await Promise.all([
      createParentSessionIndex(collection, { jti: 1 }, { unique: true }),
      createParentSessionIndex(collection, { parentId: 1, revokedAt: 1 }, {}),
      createParentSessionIndex(collection, { expiresAt: 1 }, { expireAfterSeconds: 0 }),
    ]);
    cache.done = true;
  })().finally(() => {
    if (!cache.done) {
      cache.promise = undefined;
    }
  });

  await cache.promise;
}

export async function createParentSession(
  db: Db,
  input: {
    jti: string;
    parentId: string;
    expiresAt: Date;
    deviceId?: string;
    userAgent?: string | null;
    ip?: string | null;
  }
): Promise<void> {
  await ensureParentSessionIndexes(db);
  const now = new Date();
  const session: ParentSessionDocument = {
    jti: input.jti,
    parentId: input.parentId,
    deviceIdHash: input.deviceId ? hashDeviceId(input.deviceId) : null,
    createdAt: now,
    lastUsedAt: now,
    expiresAt: input.expiresAt,
    revokedAt: null,
    userAgent: input.userAgent ?? null,
    ip: input.ip ?? null,
  };

  await db.collection<ParentSessionDocument>(PARENT_SESSIONS_COLLECTION).insertOne(session);
}

export async function revokeParentSession(
  db: Db,
  jti: string,
  parentId: string
): Promise<void> {
  await ensureParentSessionIndexes(db);
  await db.collection<ParentSessionDocument>(PARENT_SESSIONS_COLLECTION).updateOne(
    { jti, parentId, revokedAt: null },
    { $set: { revokedAt: new Date(), lastUsedAt: new Date() } }
  );
}

export async function revokeAllParentSessions(
  db: Db,
  parentId: string
): Promise<void> {
  await ensureParentSessionIndexes(db);
  const now = new Date();
  await db.collection<ParentSessionDocument>(PARENT_SESSIONS_COLLECTION).updateMany(
    { parentId, revokedAt: null },
    { $set: { revokedAt: now, lastUsedAt: now } }
  );
}

export function normalizeLinkedStudentIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (studentId): studentId is string =>
      typeof studentId === "string" && studentId.trim().length > 0
  );
}

export function isParentActive(parent: Pick<ParentDocument, "isActive"> | null | undefined): boolean {
  return parent?.isActive === true;
}

export function serializeParent(parent: ParentDocument): SerializedParent {
  return {
    parentId: parent._id.toString(),
    parentName: parent.parentName,
    parentMobile: parent.parentMobile,
    status: isParentActive(parent) ? "ACTIVE" : "INACTIVE",
  };
}

export async function getActiveLinkedStudents(
  db: Db,
  linkedStudentIds: unknown,
  parentMobile?: string
): Promise<LinkedParentStudent[]> {
  const studentIds = normalizeLinkedStudentIds(linkedStudentIds);
  if (studentIds.length === 0) return [];

  const students = await db
    .collection(STUDENTS_COLLECTION)
    .find(
      { studentId: { $in: studentIds }, status: "Active" },
      { projection: { _id: 0, studentId: 1, name: 1, class: 1, status: 1, parentMobile: 1 } }
    )
    .toArray();

  const byId = new Map<string, LinkedParentStudent>();
  for (const student of students) {
    if (
      typeof student.studentId === "string" &&
      typeof student.name === "string" &&
      typeof student.class === "string" &&
      (parentMobile === undefined ||
        normalizeParentMobile(String(student.parentMobile || "")) === normalizeParentMobile(parentMobile))
    ) {
      byId.set(student.studentId, {
        studentId: student.studentId,
        name: student.name,
        class: student.class,
        status: "Active",
      });
    }
  }

  // preserve linked order
  return studentIds
    .map((studentId) => byId.get(studentId))
    .filter((student): student is LinkedParentStudent => Boolean(student));
}

/** @deprecated prefer getActiveLinkedStudents for parent-facing access */
export async function getLinkedStudents(
  db: Db,
  linkedStudentIds: unknown
): Promise<LinkedParentStudent[]> {
  return getActiveLinkedStudents(db, linkedStudentIds);
}

export function filterLinkedStudents(
  linkedStudentIds: unknown,
  studentId: string
): boolean {
  return normalizeLinkedStudentIds(linkedStudentIds).includes(studentId);
}

export async function getAuthenticatedParent(
  request: Request,
  options?: { requireActiveStudents?: boolean }
): Promise<ParentAuthResult> {
  ensureParentAuthConfig();

  const bearerToken = parseBearerToken(request.headers.get("authorization"));
  if (!bearerToken) {
    return { ok: false, status: 401, error: "Authentication required" };
  }

  const token = verifyParentToken(bearerToken);
  if (!token) {
    return { ok: false, status: 401, error: "Invalid or expired token" };
  }

  if (!ObjectId.isValid(token.parentId)) {
    return { ok: false, status: 401, error: "Invalid session" };
  }

  const db = await getDb();
  await ensureParentSessionIndexes(db);

  const session = await db
    .collection<ParentSessionDocument>(PARENT_SESSIONS_COLLECTION)
    .findOne({
      jti: token.jti,
      parentId: token.parentId,
      revokedAt: null,
      expiresAt: { $gt: new Date() },
    });

  if (!session) {
    return { ok: false, status: 401, error: "Invalid or expired token" };
  }

  const parent = await db
    .collection<ParentDocument>(PARENTS_COLLECTION)
    .findOne(
      { _id: new ObjectId(token.parentId) },
      { projection: { passwordHash: 0 } }
    );

  if (!parent) {
    return { ok: false, status: 401, error: "Parent account not found" };
  }

  if (!isParentActive(parent)) {
    // invalidate existing sessions for disabled parent
    await revokeAllParentSessions(db, token.parentId).catch(() => undefined);
    return {
      ok: false,
      status: 403,
      restriction: {
        code: "PARENT_ACCESS_RESTRICTED",
        reason: "PARENT_ACCOUNT_INACTIVE",
        message: "Your parent account is currently inactive.",
      },
    };
  }

  if (options?.requireActiveStudents) {
    const activeStudents = await getActiveLinkedStudents(db, parent.linkedStudentIds, parent.parentMobile);
    if (activeStudents.length === 0) {
      await revokeAllParentSessions(db, token.parentId).catch(() => undefined);
      return {
        ok: false,
        status: 403,
        restriction: {
          code: "PARENT_ACCESS_RESTRICTED",
          reason: "NO_ACTIVE_STUDENTS",
          message: "Your linked student account is currently inactive.",
        },
      };
    }
  }

  void db
    .collection<ParentSessionDocument>(PARENT_SESSIONS_COLLECTION)
    .updateOne(
      { _id: session._id },
      { $set: { lastUsedAt: new Date() } }
    )
    .catch(() => undefined);

  return { ok: true, token, parent };
}

export type StudentAccessFailure =
  | { status: 404; body: { success: false; error: string } }
  | {
      status: 403;
      body: {
        success: false;
        code: "STUDENT_ACCESS_RESTRICTED";
        reason: "STUDENT_INACTIVE";
        message: string;
      };
    };

export function studentInactiveBody() {
  return {
    success: false as const,
    code: "STUDENT_ACCESS_RESTRICTED" as const,
    reason: "STUDENT_INACTIVE" as const,
    message: "This student account is currently inactive." as const,
  };
}

/**
 * Verifies the student is linked to the authenticated parent and is active.
 * - 404 if student does not exist or is not linked (no cross-parent leak)
 * - 403 STUDENT_ACCESS_RESTRICTED/STUDENT_INACTIVE if linked but archived/inactive
 */
export async function verifyParentStudentAccess(
  db: Db,
  parent: ParentDocument,
  studentId: string
): Promise<
  | { ok: true; student: { studentId: string; name?: string; class?: string; status?: string; admissionDate?: unknown; monthlyFee?: unknown } & Record<string, any> }
  | { ok: false; failure: StudentAccessFailure }
> {
  if (!filterLinkedStudents(parent.linkedStudentIds, studentId)) {
    return { ok: false, failure: { status: 404, body: { success: false, error: "Student not found" } } };
  }

  const student = await db
    .collection(STUDENTS_COLLECTION)
    .findOne({ studentId });
  if (!student) {
    return { ok: false, failure: { status: 404, body: { success: false, error: "Student not found" } } };
  }

  // Treat the student's current guardian mobile as canonical. This blocks stale
  // parent link records from granting access after a reassignment.
  if (
    normalizeParentMobile(String((student as any).parentMobile || "")) !==
    normalizeParentMobile(parent.parentMobile)
  ) {
    return { ok: false, failure: { status: 404, body: { success: false, error: "Student not found" } } };
  }

  if (String((student as any).status) !== "Active") {
    return { ok: false, failure: { status: 403, body: studentInactiveBody() } };
  }

  return { ok: true, student: student as any };
}

/**
 * After a student becomes inactive/deleted, revoke parent sessions if that parent
 * has no remaining active linked students. Preserves access when siblings remain active.
 */
export async function revokeParentSessionsIfNoActiveLinkedStudents(
  db: Db,
  studentId: string
): Promise<void> {
  const parents = await db
    .collection(PARENTS_COLLECTION)
    .find(
      { linkedStudentIds: studentId },
      { projection: { _id: 1, linkedStudentIds: 1, parentMobile: 1 } }
    )
    .toArray();

  for (const p of parents) {
    const active = await getActiveLinkedStudents(db, (p as any).linkedStudentIds, (p as any).parentMobile);
    if (active.length === 0) {
      await revokeAllParentSessions(db, (p as any)._id.toString());
    }
  }
}

/**
 * Find parents linked to any of the given student IDs and revoke their sessions if none remain active.
 */
export async function revokeParentSessionsForAffectedStudentsIfNoActive(
  db: Db,
  studentIds: string[]
): Promise<void> {
  const unique = Array.from(new Set(studentIds.filter(Boolean)));
  if (unique.length === 0) return;
  const parents = await db
    .collection(PARENTS_COLLECTION)
    .find(
      { linkedStudentIds: { $in: unique } },
      { projection: { _id: 1, linkedStudentIds: 1, parentMobile: 1 } }
    )
    .toArray();

  for (const p of parents) {
    const active = await getActiveLinkedStudents(db, (p as any).linkedStudentIds, (p as any).parentMobile);
    if (active.length === 0) {
      await revokeAllParentSessions(db, (p as any)._id.toString());
    }
  }
}

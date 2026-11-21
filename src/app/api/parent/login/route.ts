import { comparePassword } from "@/lib/auth";
import { getDb } from "@/lib/mongodb";
import {
  createParentSession,
  ensureParentAuthConfig,
  ensureParentSessionIndexes,
  getActiveLinkedStudents,
  isParentActive,
  PARENTS_COLLECTION,
  parentAccessRestrictedBody,
  ParentAuthConfigError,
  type ParentDocument,
  revokeAllParentSessions,
  signParentToken,
} from "@/lib/parent-auth";
import { parentLoginSchema } from "@/schemas";
import { parentJson, parentOptions } from "@/lib/parent-cors";

const DUMMY_PASSWORD_HASH =
  "$2b$10$9yGqbwYyLgrZ6pmJKQi/Eu2OWzR7IcqHEnX4zSl7x9AjxRx/fY7/6";

export async function POST(request: Request) {
  try {
    ensureParentAuthConfig();

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return parentJson(
        request,
        { success: false, error: "Invalid request body" },
        400
      );
    }

    const parsed = parentLoginSchema.safeParse(body);
    if (!parsed.success) {
      return parentJson(
        request,
        {
          success: false,
          error: parsed.error.issues[0]?.message ?? "Invalid login details",
        },
        400
      );
    }

    const { parentMobile, password, deviceId } = parsed.data;
    const db = await getDb();
    const parent = await db
      .collection<ParentDocument>(PARENTS_COLLECTION)
      .findOne({ parentMobile });

    const storedHash =
      typeof parent?.passwordHash === "string" ? parent.passwordHash : null;
    const passwordMatches = await comparePassword(
      password,
      storedHash ?? DUMMY_PASSWORD_HASH
    );

    if (!parent || !storedHash || !passwordMatches) {
      return parentJson(
        request,
        { success: false, error: "Invalid mobile number or password" },
        401
      );
    }

    await ensureParentSessionIndexes(db);

    const parentId = parent._id.toString();

    if (!isParentActive(parent)) {
      await revokeAllParentSessions(db, parentId).catch(() => undefined);
      return parentJson(
        request,
        parentAccessRestrictedBody({
          code: "PARENT_ACCESS_RESTRICTED",
          reason: "PARENT_ACCOUNT_INACTIVE",
          message: "Your parent account is currently inactive.",
        }),
        403
      );
    }

    const students = await getActiveLinkedStudents(db, parent.linkedStudentIds, parent.parentMobile);
    if (students.length === 0) {
      await revokeAllParentSessions(db, parentId).catch(() => undefined);
      return parentJson(
        request,
        parentAccessRestrictedBody({
          code: "PARENT_ACCESS_RESTRICTED",
          reason: "NO_ACTIVE_STUDENTS",
          message: "Your linked student account is currently inactive.",
        }),
        403
      );
    }

    const { token, jti, expiresAt } = signParentToken(parentId);
    await createParentSession(db, {
      jti,
      parentId,
      expiresAt,
      deviceId,
      userAgent: request.headers.get("user-agent"),
      ip: request.headers.get("x-forwarded-for"),
    });

    return parentJson(request, {
      success: true,
      token,
      parent: {
        name: parent.parentName,
        mobile: parent.parentMobile,
        status: "ACTIVE",
      },
      access: {
        status: "ACTIVE",
        activeStudentCount: students.length,
      },
      students: students.map((s) => ({
        studentId: s.studentId,
        name: s.name,
        status: "ACTIVE",
      })),
      expiresAt: expiresAt.toISOString(),
    });
  } catch (error) {
    if (error instanceof ParentAuthConfigError) {
      console.error(
        "POST /api/parent/login configuration error:",
        error instanceof Error ? error.message : String(error)
      );
      return parentJson(
        request,
        { success: false, error: "Parent login is temporarily unavailable" },
        503
      );
    }

    console.error(
      "POST /api/parent/login failed:",
      error instanceof Error ? `${error.name}: ${error.message}` : String(error)
    );
    return parentJson(
      request,
      { success: false, error: "Unable to log in right now" },
      500
    );
  }
}

export function OPTIONS(request: Request) {
  return parentOptions(request);
}

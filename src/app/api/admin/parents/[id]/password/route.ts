import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getAuthenticatedAdmin, hashPassword } from "@/lib/auth";
import { connectToDatabase } from "@/lib/mongodb";
import { parentPasswordResetSchema } from "@/schemas";
import {
  normalizeLinkedStudentIds,
  normalizeParentMobile,
  PARENT_SESSIONS_COLLECTION,
  PARENTS_COLLECTION,
  STUDENTS_COLLECTION,
} from "@/lib/parent-auth";
import { PARENT_DEVICES_COLLECTION } from "@/lib/announcements";
import {
  consumeParentPasswordResetLimit,
  PasswordResetRateLimitUnavailableError,
} from "@/lib/parent-password-reset-limit";

class ParentAccountNotFoundError extends Error {}
class ParentStudentRelationshipError extends Error {}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  let adminId: string | null = null;
  let parentId = "";

  try {
    const admin = await getAuthenticatedAdmin();
    if (!admin) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    adminId = admin.adminId;

    const { id } = await params;
    parentId = id;
    if (!ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid parent account ID" }, { status: 400 });
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }
    const parsed = parentPasswordResetSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid password reset request" }, { status: 400 });
    }
    if (parsed.data.newPassword !== parsed.data.confirmPassword) {
      return NextResponse.json({ error: "Passwords do not match" }, { status: 400 });
    }

    let withinLimit: boolean;
    try {
      withinLimit = await consumeParentPasswordResetLimit(admin.adminId, id);
    } catch (error) {
      if (error instanceof PasswordResetRateLimitUnavailableError) {
        return NextResponse.json(
          { error: "Password reset is temporarily unavailable. Please try again later." },
          { status: 503 }
        );
      }
      throw error;
    }
    if (!withinLimit) {
      console.warn("parent_password_reset_throttled", { adminId, parentId });
      return NextResponse.json(
        { error: "Too many password reset attempts. Please try again later." },
        { status: 429 }
      );
    }

    const passwordHash = await hashPassword(parsed.data.newPassword);
    const now = new Date();
    const { client, db } = await connectToDatabase();
    const session = client.startSession();
    let linkedActiveStudents = 0;

    try {
      await session.withTransaction(async () => {
        const parents = db.collection(PARENTS_COLLECTION);
        const students = db.collection(STUDENTS_COLLECTION);
        const parent = await parents.findOne(
          { _id: new ObjectId(id) },
          { session, projection: { passwordHash: 0 } }
        );
        if (!parent) throw new ParentAccountNotFoundError();

        const linkedStudentIds = normalizeLinkedStudentIds(parent.linkedStudentIds);
        if (!linkedStudentIds.includes(parsed.data.studentId)) {
          throw new ParentStudentRelationshipError();
        }

        const student = await students.findOne(
          { studentId: parsed.data.studentId },
          { session, projection: { studentId: 1, parentMobile: 1 } }
        );
        if (
          !student ||
          normalizeParentMobile(String(student.parentMobile || "")) !==
            normalizeParentMobile(String(parent.parentMobile || ""))
        ) {
          throw new ParentStudentRelationshipError();
        }

        const updateResult = await parents.updateOne(
          {
            _id: new ObjectId(id),
            parentMobile: parent.parentMobile,
            linkedStudentIds: parsed.data.studentId,
          },
          { $set: { passwordHash, updatedAt: now } },
          { session }
        );
        if (updateResult.matchedCount !== 1) throw new ParentStudentRelationshipError();

        await db.collection(PARENT_SESSIONS_COLLECTION).updateMany(
          { parentId: id, revokedAt: null },
          { $set: { revokedAt: now, lastUsedAt: now } },
          { session }
        );

        // Keep the account's device records for audit/re-registration, but
        // deactivate only this parent's active tokens. Login will register them again.
        await db.collection(PARENT_DEVICES_COLLECTION).updateMany(
          { parentId: id, isActive: true },
          {
            $set: {
              isActive: false,
              updatedAt: now,
              invalidatedAt: now,
              invalidReason: "password_reset",
            },
          },
          { session }
        );

        linkedActiveStudents = linkedStudentIds.length
          ? await students.countDocuments(
              { studentId: { $in: linkedStudentIds }, status: "Active" },
              { session }
            )
          : 0;
      });
    } finally {
      await session.endSession();
    }

    console.info("parent_password_reset_succeeded", {
      adminId,
      parentId,
      studentId: parsed.data.studentId,
    });
    return NextResponse.json({
      success: true,
      message: "Parent password updated successfully. The parent must sign in again on their devices.",
      linkedActiveStudents,
    });
  } catch (error) {
    if (error instanceof ParentAccountNotFoundError) {
      return NextResponse.json({ error: "Parent account not found" }, { status: 404 });
    }
    if (error instanceof ParentStudentRelationshipError) {
      return NextResponse.json(
        { error: "No linked parent account was found for this student." },
        { status: 404 }
      );
    }
    console.error("parent_password_reset_failed", { adminId, parentId, code: "RESET_FAILED" });
    return NextResponse.json(
      { error: "Failed to reset parent password" },
      { status: 500 }
    );
  }
}

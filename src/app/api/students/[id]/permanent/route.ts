import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { connectToDatabase, getDb } from "@/lib/mongodb";
import { getAuthenticatedAdmin } from "@/lib/auth";
import {
  buildStudentDeleteMessage,
  buildStudentRelatedDeleteFilters,
  StudentRelatedCounts,
} from "@/lib/student-delete";
import { revokeParentSessionsIfNoActiveLinkedStudents } from "@/lib/parent-auth";

async function getStudent(db: any, id: string) {
  const filter = ObjectId.isValid(id)
    ? { _id: new ObjectId(id) }
    : { studentId: id };
  const student = await db.collection("students").findOne(filter);
  return { filter, student };
}

async function getRelatedCounts(
  db: any,
  studentId: string
): Promise<StudentRelatedCounts> {
  const filters = buildStudentRelatedDeleteFilters(studentId);
  const [payments, attendance] = await Promise.all([
    db.collection("payments").countDocuments(filters.payments),
    db.collection("attendance").countDocuments(filters.attendance),
  ]);

  return { payments, attendance };
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const admin = await getAuthenticatedAdmin();
    if (!admin) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const db = await getDb();
    const { student } = await getStudent(db, id);

    if (!student) {
      return NextResponse.json({ error: "Student not found" }, { status: 404 });
    }

    if (student.status === "Active") {
      return NextResponse.json(
        { error: "Active students must be archived before permanent deletion." },
        { status: 400 }
      );
    }

    const counts = await getRelatedCounts(db, student.studentId);
    return NextResponse.json({
      student: {
        studentId: student.studentId,
        name: student.name,
      },
      counts,
    });
  } catch (error) {
    console.error("GET /api/students/[id]/permanent error:", error);
    return NextResponse.json(
      { error: "Failed to load student deletion details" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const admin = await getAuthenticatedAdmin();
    if (!admin) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const { client, db } = await connectToDatabase();
    const session = client.startSession();
    let response:
      | { status: number; body: Record<string, unknown> }
      | null = null;

    try {
      await session.withTransaction(async () => {
        const { filter, student } = await getStudent(db, id);

        if (!student) {
          response = { status: 404, body: { error: "Student not found" } };
          return;
        }

        if (student.status === "Active") {
          response = {
            status: 400,
            body: {
              error: "Active students must be archived before permanent deletion.",
            },
          };
          return;
        }

        if (body.studentId && body.studentId !== student.studentId) {
          response = {
            status: 400,
            body: { error: "Student confirmation did not match." },
          };
          return;
        }

        const counts = await getRelatedCounts(db, student.studentId);
        const filters = buildStudentRelatedDeleteFilters(student.studentId);

        await Promise.all([
          db.collection("payments").deleteMany(filters.payments, { session }),
          db.collection("attendance").deleteMany(filters.attendance, { session }),
          db.collection("students").deleteOne(filter, { session }),
        ]);

        response = {
          status: 200,
          body: {
            success: true,
            studentId: student.studentId,
            deleted: {
              student: 1,
              payments: counts.payments,
              attendance: counts.attendance,
            },
            message: buildStudentDeleteMessage(student.name, counts),
          },
        };
      });
    } finally {
      await session.endSession();
    }

    const finalResponse = response as
      | { status: number; body: Record<string, unknown> }
      | null;

    if (!finalResponse) {
      return NextResponse.json(
        { error: "Failed to permanently delete student" },
        { status: 500 }
      );
    }

    // After permanent delete, revoke parent sessions if no active linked students remain.
    // (Deleted student no longer counts as active; shared parent preserved for active siblings.)
    if (finalResponse.status === 200 && typeof finalResponse.body.studentId === "string") {
      await revokeParentSessionsIfNoActiveLinkedStudents(db, finalResponse.body.studentId).catch(() => undefined);
    }

    return NextResponse.json(finalResponse.body, { status: finalResponse.status });
  } catch (error) {
    console.error("DELETE /api/students/[id]/permanent error:", error);
    return NextResponse.json(
      { error: "Failed to permanently delete student" },
      { status: 500 }
    );
  }
}

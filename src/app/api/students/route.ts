import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { connectToDatabase, getDb } from "@/lib/mongodb";
import { getAuthenticatedAdmin, hashPassword } from "@/lib/auth";
import { studentSchema } from "@/schemas";
import { calculateStudentDueStatus } from "@/lib/due-calculator";
import { getNextStudentId } from "@/lib/student-id";
import { loadAttendanceSettings } from "@/lib/app-settings";
import { getEffectiveBatch, formatClassDisplay } from "@/lib/class-utils";
import {
  PARENTS_COLLECTION,
  normalizeParentMobile,
  isValidParentMobile,
  normalizeLinkedStudentIds,
} from "@/lib/parent-auth";
import { Student, Payment } from "@/types";

export async function GET(req: Request) {
  try {
    const admin = await getAuthenticatedAdmin();
    if (!admin) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const search = searchParams.get("search") || "";
    const status = searchParams.get("status") || "Active";
    const className = searchParams.get("class") || "All";
    const batchFilter = searchParams.get("batch") || "All";
    const dueFilter = searchParams.get("dueFilter") || "All"; // All | PAID | DUE_TODAY | OVERDUE

    const db = await getDb();
    const attendanceSettings = await loadAttendanceSettings(db);

    // Query filter for MongoDB
    const query: Record<string, any> = {};

    if (status === "Active" || status === "Inactive") {
      query.status = status;
    }

    // Flexible class filter supporting both "Class Sr.Kg" and "Sr.Kg", "Class 6" and "6"
    if (className !== "All") {
      const clean = className.replace(/^class\s+/i, "").trim();
      const escaped = clean.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      query.class = new RegExp(`^(Class\\s+)?${escaped}$`, "i");
    }

    if (search.trim()) {
      const reg = new RegExp(search.trim(), "i");
      query.$or = [
        { name: reg },
        { parentName: reg },
        { parentMobile: reg },
        { class: reg },
        { studentId: reg },
      ];
    }

    const studentsRaw = await db.collection("students").find(query).sort({ createdAt: -1 }).toArray();

    // Fetch all payments to compute dynamic due status for each student
    const studentIds = studentsRaw.map((s: any) => s.studentId);
    const paymentsRaw = await db
      .collection("payments")
      .find({ studentId: { $in: studentIds } })
      .toArray();

    const paymentsByStudent: Record<string, Payment[]> = {};
    paymentsRaw.forEach((p: any) => {
      if (!paymentsByStudent[p.studentId]) {
        paymentsByStudent[p.studentId] = [];
      }
      paymentsByStudent[p.studentId].push({
        _id: p._id.toString(),
        studentId: p.studentId,
        paymentDate: p.paymentDate,
        month: p.month,
        year: p.year,
        amount: p.amount,
        mode: p.mode,
        receiptNo: p.receiptNo,
        collectedBy: p.collectedBy,
        remarks: p.remarks,
      });
    });

    const enrichedStudents = studentsRaw.map((s: any) => {
      const effectiveBatch = getEffectiveBatch(
        s,
        attendanceSettings.batch1Classes,
        attendanceSettings.batch2Classes
      );
      const student: Student = {
        _id: s._id.toString(),
        studentId: s.studentId,
        name: s.name,
        class: s.class,
        batch: s.batch,
        effectiveBatch,
        formattedClass: formatClassDisplay(s.class),
        monthlyFee: s.monthlyFee,
        parentName: s.parentName,
        parentMobile: s.parentMobile,
        alternateMobile: s.alternateMobile,
        admissionDate: s.admissionDate,
        status: s.status,
        archivedAt:
          s.archivedAt instanceof Date ? s.archivedAt.toISOString() : s.archivedAt,
        address: s.address,
        remarks: s.remarks,
        createdAt: s.createdAt?.toISOString(),
        updatedAt: s.updatedAt?.toISOString(),
      };

      const studentPayments = paymentsByStudent[s.studentId] || [];
      const dueInfo = calculateStudentDueStatus(student, studentPayments);

      return {
        ...student,
        dueInfo,
      };
    });

    // Filter by dynamic due status if requested
    let finalStudents = enrichedStudents;
    if (dueFilter !== "All") {
      finalStudents = finalStudents.filter((s: any) => s.dueInfo.status === dueFilter);
    }
    if (batchFilter !== "All") {
      finalStudents = finalStudents.filter((s: any) => s.effectiveBatch === batchFilter);
    }

    return NextResponse.json({ students: finalStudents });
  } catch (error: any) {
    console.error("GET /api/students error:", error);
    return NextResponse.json({ error: "Failed to fetch students" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const admin = await getAuthenticatedAdmin();
    if (!admin) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const parsed = studentSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 }
      );
    }

    const admission = (body && typeof body === "object" ? (body as any).admission : null) || {};
    const existingParentId =
      typeof admission.existingParentId === "string" ? admission.existingParentId.trim() : "";
    const parentPassword =
      typeof admission.parentPassword === "string" ? admission.parentPassword : "";
    const confirmParentPassword =
      typeof admission.confirmParentPassword === "string" ? admission.confirmParentPassword : "";

    // Clean class input to avoid "Class Class 6" or duplicate prefixes
    const rawClass = parsed.data.class;
    const cleanClassNumber = rawClass.replace(/^class\s+/i, "").trim();
    const formattedClass = cleanClassNumber ? `Class ${cleanClassNumber}` : rawClass;

    const normalizedMobile = normalizeParentMobile(parsed.data.parentMobile);
    if (!isValidParentMobile(normalizedMobile)) {
      return NextResponse.json(
        { error: "Parent mobile number must be exactly 10 digits" },
        { status: 400 }
      );
    }

    const { client, db } = await connectToDatabase();
    const session = client.startSession();

    try {
      let createdStudent: any = null;
      await session.withTransaction(async () => {
        const now = new Date();
        const studentsCol = db.collection("students");
        const parentsCol = db.collection(PARENTS_COLLECTION);

        // Lock/inspect parent by mobile for consistency
        const parentByMobile = await parentsCol.findOne(
          { parentMobile: normalizedMobile },
          { session }
        );

        let parentDoc: any = parentByMobile;

        if (existingParentId) {
          if (!ObjectId.isValid(existingParentId)) {
            throw new Error("INVALID_PARENT_ID");
          }
          const parentById = await parentsCol.findOne(
            { _id: new ObjectId(existingParentId) },
            { session }
          );
          if (!parentById) throw new Error("PARENT_NOT_FOUND");
          if (String((parentById as any).parentMobile) !== normalizedMobile) {
            throw new Error("PARENT_MOBILE_MISMATCH");
          }
          parentDoc = parentById;
        }

        // Determine parent handling
        if (parentDoc) {
          const hasPassword =
            typeof parentDoc.passwordHash === "string" && parentDoc.passwordHash.length > 0;
          // If admin provided password for a configured account, ignore but do not overwrite
          if (!hasPassword) {
            // Allow initial password configuration for existing account without password
            if (parentPassword || confirmParentPassword) {
              if (parentPassword.length < 8) throw new Error("PASSWORD_TOO_SHORT");
              if (parentPassword !== confirmParentPassword) throw new Error("PASSWORD_MISMATCH");
              const passwordHash = await hashPassword(parentPassword);
              await parentsCol.updateOne(
                { _id: parentDoc._id },
                { $set: { passwordHash, updatedAt: now, isActive: parentDoc.isActive !== false } },
                { session }
              );
            }
            // If not provided, allow linking (account remains without password) - but UI should prevent; backend stays safe
          } else {
            // Existing configured password: never update/overwrite
            if (parentPassword) {
              // ignore silently for safety
            }
          }
        } else {
          // New parent account: create once with password
          if (!parentPassword || !confirmParentPassword) {
            throw new Error("PASSWORD_REQUIRED_FOR_NEW_PARENT");
          }
          if (parentPassword.length < 8) throw new Error("PASSWORD_TOO_SHORT");
          if (parentPassword !== confirmParentPassword) throw new Error("PASSWORD_MISMATCH");
          const passwordHash = await hashPassword(parentPassword);
          const insertRes = await parentsCol.insertOne(
            {
              parentMobile: normalizedMobile,
              parentName: parsed.data.parentName,
              passwordHash,
              linkedStudentIds: [],
              isActive: true,
              createdAt: now,
              updatedAt: now,
            },
            { session }
          );
          parentDoc = await parentsCol.findOne({ _id: insertRes.insertedId }, { session });
        }

        // Generate studentId (inside transaction for consistency)
        const lastStudent = await studentsCol
          .find({}, { session })
          .sort({ studentId: -1 })
          .limit(1)
          .toArray();
        const studentId = getNextStudentId(lastStudent[0]?.studentId);

        const newStudent = {
          studentId,
          ...parsed.data,
          parentMobile: normalizedMobile,
          class: formattedClass,
          ...(parsed.data.status === "Inactive" ? { archivedAt: now } : {}),
          createdAt: now,
          updatedAt: now,
        };

        const result = await studentsCol.insertOne(newStudent, { session });

        // Link student to parent account
        if (parentDoc?._id) {
          await parentsCol.updateOne(
            { _id: parentDoc._id },
            {
              $addToSet: { linkedStudentIds: studentId },
              $set: { updatedAt: now, ...(parentDoc.parentName ? {} : { parentName: parsed.data.parentName }) },
            },
            { session }
          );
        }

        createdStudent = { _id: result.insertedId.toString(), ...newStudent };
      });

      return NextResponse.json({
        success: true,
        student: createdStudent,
      });
    } finally {
      await session.endSession();
    }
  } catch (error: any) {
    console.error("POST /api/students error:", error);
    const msg = String(error?.message || "");
    if (msg === "INVALID_PARENT_ID") {
      return NextResponse.json({ error: "Invalid parent account reference" }, { status: 400 });
    }
    if (msg === "PARENT_NOT_FOUND") {
      return NextResponse.json({ error: "Selected parent account was not found" }, { status: 400 });
    }
    if (msg === "PARENT_MOBILE_MISMATCH") {
      return NextResponse.json({ error: "Parent account does not match the entered mobile number" }, { status: 400 });
    }
    if (msg === "PASSWORD_REQUIRED_FOR_NEW_PARENT") {
      return NextResponse.json({ error: "Password is required for a new parent account" }, { status: 400 });
    }
    if (msg === "PASSWORD_TOO_SHORT") {
      return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
    }
    if (msg === "PASSWORD_MISMATCH") {
      return NextResponse.json({ error: "Passwords do not match" }, { status: 400 });
    }
    // Handle duplicate key on parentMobile race fallback
    if (error?.code === 11000) {
      return NextResponse.json({ error: "A parent account for this mobile number already exists. Please retry." }, { status: 409 });
    }
    return NextResponse.json({ error: "Failed to create student" }, { status: 500 });
  }
}

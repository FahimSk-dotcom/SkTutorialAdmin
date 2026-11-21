import { getDb } from "@/lib/mongodb";
import { parentJson, parentOptions } from "@/lib/parent-cors";
import {
  getAuthenticatedParent,
  parentAccessRestrictedBody,
  ParentAuthConfigError,
  verifyParentStudentAccess,
} from "@/lib/parent-auth";
import {
  buildMonthlyFeeOverview,
  isValidFeeYear,
  kolkataDateToCalendarDate,
} from "@/lib/parent-fees";
import { getKolkataToday } from "@/lib/date";

const PAYMENTS_COLLECTION = "payments";
const STUDENT_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

interface FeePaymentDocument {
  studentId?: unknown;
  receiptNo?: unknown;
  paymentDate?: unknown;
  month?: unknown;
  year?: unknown;
  amount?: unknown;
  mode?: unknown;
  createdAt?: unknown;
}

export async function GET(request: Request) {
  try {
    const auth = await getAuthenticatedParent(request, { requireActiveStudents: true });
    if (!auth.ok) {
      if (auth.restriction) {
        return parentJson(request, parentAccessRestrictedBody(auth.restriction), auth.status);
      }
      return parentJson(
        request,
        { success: false, error: auth.error ?? "Authentication failed" },
        auth.status
      );
    }

    const { searchParams } = new URL(request.url);
    const studentId = (searchParams.get("studentId") ?? "").trim();
    const yearParam = (searchParams.get("year") ?? "").trim();

    if (!studentId) {
      return parentJson(
        request,
        { success: false, error: "studentId is required" },
        400
      );
    }

    if (!STUDENT_ID_PATTERN.test(studentId)) {
      return parentJson(
        request,
        { success: false, error: "Invalid studentId" },
        400
      );
    }

    const defaultYear = Number.parseInt(getKolkataToday().slice(0, 4), 10);
    const yearValue = yearParam.length === 0 ? String(defaultYear) : yearParam;
    if (!isValidFeeYear(yearValue)) {
      return parentJson(
        request,
        { success: false, error: "year must be a valid YYYY value" },
        400
      );
    }
    const requestedYear = Number.parseInt(yearValue, 10);

    const db = await getDb();
    const access = await verifyParentStudentAccess(db, auth.parent, studentId);
    if (!access.ok) {
      return parentJson(request, access.failure.body, access.failure.status);
    }

    const student = access.student as any;
    const paymentDocs = await db
      .collection(PAYMENTS_COLLECTION)
      .find({ studentId, year: requestedYear })
      .project({
        _id: 0,
        studentId: 1,
        receiptNo: 1,
        paymentDate: 1,
        month: 1,
        year: 1,
        amount: 1,
        mode: 1,
        createdAt: 1,
      })
      .toArray();

    const todayDate = kolkataDateToCalendarDate(getKolkataToday()) ?? new Date();
    const overview = buildMonthlyFeeOverview({
      student: {
        studentId: String(student.studentId ?? studentId),
        name: String(student.name ?? ""),
        class: String(student.class ?? ""),
        monthlyFee: Number(student.monthlyFee ?? 0),
        admissionDate: String(student.admissionDate ?? ""),
        status: String(student.status ?? "Active"),
      } as any,
      payments: paymentDocs.map((payment) => {
        const record = payment as FeePaymentDocument;
        return {
          studentId: String(record.studentId ?? studentId),
          receiptNo: String(record.receiptNo ?? ""),
          paymentDate: String(record.paymentDate ?? ""),
          month: Number(record.month ?? 0),
          year: Number(record.year ?? 0),
          amount: Number(record.amount ?? 0),
          mode: record.mode === "UPI" ? "UPI" : "Cash",
          createdAt:
            record.createdAt instanceof Date
              ? record.createdAt.toISOString()
              : typeof record.createdAt === "string"
                ? record.createdAt
                : undefined,
        };
      }),
      year: requestedYear,
      today: todayDate,
    });

    return parentJson(request, { success: true, ...overview });
  } catch (error) {
    if (error instanceof ParentAuthConfigError) {
      console.error(
        "GET /api/parent/fees configuration error:",
        error instanceof Error ? error.message : String(error)
      );
      return parentJson(
        request,
        { success: false, error: "Parent service is temporarily unavailable" },
        503
      );
    }

    console.error(
      "GET /api/parent/fees failed:",
      error instanceof Error ? `${error.name}: ${error.message}` : String(error)
    );
    return parentJson(
      request,
      { success: false, error: "Unable to load fee details right now" },
      500
    );
  }
}

export function OPTIONS(request: Request) {
  return parentOptions(request);
}

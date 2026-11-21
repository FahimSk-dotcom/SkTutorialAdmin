import { ObjectId, type Db } from "mongodb";
import { getActiveDevicesForParents } from "@/lib/announcements";
import { getKolkataToday } from "@/lib/date";
import { renderFeeReminder, type ReminderSettings } from "@/lib/fee-reminder-config";
import { calculateOutstandingFees, kolkataDateToCalendarDate } from "@/lib/parent-fees";
import {
  normalizeLinkedStudentIds, PARENTS_COLLECTION, STUDENTS_COLLECTION, type ParentDocument,
} from "@/lib/parent-auth";
import type { PendingMonthDetail, Student } from "@/types";

export interface EligibleReminderParent {
  parentId: string;
  parentName: string;
  students: { studentId: string; name: string; months: PendingMonthDetail[] }[];
  total: number;
  body: string;
}

export async function getEligibleReminderParents(
  db: Db,
  settings: ReminderSettings,
  parentId?: string
): Promise<EligibleReminderParent[]> {
  const today = kolkataDateToCalendarDate(getKolkataToday());
  if (!today) throw new Error("Unable to determine the Kolkata calendar date");

  const parents = await db.collection<ParentDocument>(PARENTS_COLLECTION)
    .find({ isActive: true, _id: parentId ? new ObjectId(parentId) : { $type: "objectId" } }, { readPreference: "primary" })
    .project<Pick<ParentDocument, "_id" | "parentName" | "linkedStudentIds">>({
      parentName: 1, linkedStudentIds: 1,
    }).toArray();
  const linked = parents.map((parent) => ({
    parent,
    studentIds: [...new Set(normalizeLinkedStudentIds(parent.linkedStudentIds))],
  }));
  const studentIds = [...new Set(linked.flatMap((entry) => entry.studentIds))];
  if (!studentIds.length) return [];

  const [students, payments] = await Promise.all([
    db.collection<Student>(STUDENTS_COLLECTION)
      .find({ studentId: { $in: studentIds }, status: "Active" }, { readPreference: "primary" })
      .project<Pick<Student, "studentId" | "name" | "admissionDate" | "monthlyFee">>({
        _id: 0, studentId: 1, name: 1, admissionDate: 1, monthlyFee: 1,
      }).toArray(),
    db.collection("payments").find({ studentId: { $in: studentIds } }, { readPreference: "primary" })
      .project<{ studentId: string; month: unknown; year: unknown }>({
        _id: 0, studentId: 1, month: 1, year: 1,
      }).toArray(),
  ]);

  const paymentsByStudent = new Map<string, { month: number; year: number }[]>();
  for (const payment of payments) {
    const periods = paymentsByStudent.get(payment.studentId) ?? [];
    periods.push({ month: Number(payment.month), year: Number(payment.year) });
    paymentsByStudent.set(payment.studentId, periods);
  }

  const outstanding = new Map<string, EligibleReminderParent["students"][number]>();
  for (const student of students) {
    const monthlyFee = Number(student.monthlyFee);
    if (!Number.isFinite(monthlyFee) || monthlyFee <= 0) continue;
    const months = calculateOutstandingFees(student, paymentsByStudent.get(student.studentId) ?? [], today);
    if (months.length) {
      outstanding.set(student.studentId, { studentId: student.studentId, name: student.name || "Student", months });
    }
  }

  return linked.flatMap(({ parent, studentIds }) => {
    const fees = studentIds.flatMap((id) => {
      const entry = outstanding.get(id);
      return entry ? [entry] : [];
    });
    if (!fees.length) return [];
    return [{
      parentId: parent._id.toHexString(),
      parentName: parent.parentName || "Parent",
      students: fees,
      total: fees.flatMap((student) => student.months).reduce((sum, month) => sum + month.amount, 0),
      body: renderFeeReminder(settings.messageTemplate, fees),
    }];
  });
}

export async function getReminderTokens(db: Db, parentIds: string[]) {
  const devices = await getActiveDevicesForParents(db, parentIds);
  return new Map(Array.from(devices, ([parentId, records]) => [
    parentId, [...new Set(records.map((record) => record.fcmToken?.trim()).filter(Boolean))],
  ]));
}

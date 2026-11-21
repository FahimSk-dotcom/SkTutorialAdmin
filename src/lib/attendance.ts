import type { AttendanceStatus, BatchType, StudentAttendanceSummary } from "@/types";

export interface AttendanceLike {
  date: string;
  status: AttendanceStatus | string;
  studentId?: string;
}

export function buildAttendanceUpsertOps(
  date: string,
  batch: BatchType,
  records: { studentId: string; status: AttendanceStatus }[],
  now: string = new Date().toISOString()
) {
  return records.map((rec) => ({
    updateOne: {
      filter: {
        docType: "attendance",
        date,
        batch,
        studentId: rec.studentId,
      },
      update: {
        $set: {
          docType: "attendance",
          date,
          batch,
          studentId: rec.studentId,
          status: rec.status,
          updatedAt: now,
        },
        $setOnInsert: {
          markedAt: now,
        },
      },
      upsert: true,
    },
  }));
}

export function buildAttendanceUpdateOp(
  date: string,
  batch: BatchType,
  studentId: string,
  status: AttendanceStatus,
  now: string = new Date().toISOString()
) {
  return {
    filter: {
      docType: "attendance",
      date,
      batch,
      studentId,
    },
    update: {
      $set: {
        status,
        updatedAt: now,
      },
      $setOnInsert: {
        docType: "attendance",
        date,
        batch,
        studentId,
        markedAt: now,
      },
    },
    options: { upsert: true as const },
  };
}

export function filterValidAttendance<T extends AttendanceLike>(
  records: T[],
  holidayDates: Set<string> | string[],
  todayStr: string
): T[] {
  const holidaySet =
    holidayDates instanceof Set ? holidayDates : new Set(holidayDates);

  return records
    .filter((rec) => rec.date <= todayStr && !holidaySet.has(rec.date))
    .sort((a, b) => b.date.localeCompare(a.date));
}

export function computeConsecutiveCounts(records: AttendanceLike[]) {
  let consecutiveAbsences = 0;
  let consecutivePresence = 0;

  if (records.length === 0) {
    return { consecutiveAbsences, consecutivePresence };
  }

  if (records[0].status === "absent") {
    for (const rec of records) {
      if (rec.status === "absent") consecutiveAbsences++;
      else break;
    }
  } else if (records[0].status === "present") {
    for (const rec of records) {
      if (rec.status === "present") consecutivePresence++;
      else break;
    }
  }

  return { consecutiveAbsences, consecutivePresence };
}

export function computeAttendanceSummary(
  records: AttendanceLike[],
  holidayDates: Set<string> | string[],
  todayStr: string
): StudentAttendanceSummary {
  const valid = filterValidAttendance(records, holidayDates, todayStr);
  const currentMonthPrefix = todayStr.substring(0, 7);

  const totalConducted = valid.length;
  const presentCount = valid.filter((rec) => rec.status === "present").length;
  const absentCount = valid.filter((rec) => rec.status === "absent").length;
  const percentage =
    totalConducted > 0 ? Math.round((presentCount / totalConducted) * 100) : 0;

  const currentMonthRecords = valid.filter((rec) =>
    rec.date.startsWith(currentMonthPrefix)
  );
  const currentMonthConducted = currentMonthRecords.length;
  const currentMonthPresent = currentMonthRecords.filter(
    (rec) => rec.status === "present"
  ).length;
  const currentMonthAbsent = currentMonthRecords.filter(
    (rec) => rec.status === "absent"
  ).length;
  const currentMonthPercentage =
    currentMonthConducted > 0
      ? Math.round((currentMonthPresent / currentMonthConducted) * 100)
      : 0;

  const { consecutiveAbsences, consecutivePresence } =
    computeConsecutiveCounts(valid);

  return {
    totalConducted,
    presentCount,
    absentCount,
    percentage,
    currentMonthConducted,
    currentMonthPresent,
    currentMonthAbsent,
    currentMonthPercentage,
    consecutiveAbsences,
    consecutivePresence,
  };
}

export function buildHolidayDeleteFilter({
  id,
  date,
  batch,
}: {
  id?: string | null;
  date?: string | null;
  batch?: string | null;
}) {
  const filter: Record<string, any> = { docType: "holiday" };

  if (id) {
    filter._id = id;
  } else {
    filter.date = date;
    if (batch && batch !== "All") filter.batch = batch;
  }

  return filter;
}

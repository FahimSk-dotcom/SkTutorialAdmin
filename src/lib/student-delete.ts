export interface StudentRelatedDeleteFilters {
  payments: { studentId: string };
  attendance: { docType: "attendance"; studentId: string };
}

export interface StudentRelatedCounts {
  payments: number;
  attendance: number;
}

export function buildStudentRelatedDeleteFilters(
  studentId: string
): StudentRelatedDeleteFilters {
  return {
    payments: { studentId },
    attendance: { docType: "attendance", studentId },
  };
}

export function buildStudentDeleteMessage(
  studentName: string,
  counts: StudentRelatedCounts
): string {
  return `${studentName} permanently deleted along with ${counts.payments} payment record(s) and ${counts.attendance} attendance record(s).`;
}

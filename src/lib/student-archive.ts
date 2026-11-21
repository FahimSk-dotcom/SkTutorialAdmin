export type StudentStatus = "Active" | "Inactive";

export interface StudentArchiveState {
  status?: StudentStatus | string | null;
  archivedAt?: string | Date | null;
}

export function isArchivedStudent(student: StudentArchiveState): boolean {
  return student.status === "Inactive";
}

export function isStudentEligibleForNewPayment(student: StudentArchiveState): boolean {
  return student.status === "Active";
}

export function buildStudentArchiveUpdate(now: Date = new Date()) {
  return [
    {
      $set: {
        status: "Inactive" as const,
        archivedAt: { $ifNull: ["$archivedAt", now] },
        updatedAt: now,
      },
    },
  ];
}

export function buildStudentReactivationUpdate(now: Date = new Date()) {
  return {
    $set: {
      status: "Active" as const,
      updatedAt: now,
    },
    $unset: {
      archivedAt: "",
    },
  };
}

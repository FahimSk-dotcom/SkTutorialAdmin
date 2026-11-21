import type { BatchType } from "@/types";

export const ORDERED_CLASS_NORMS = [
  "jr.kg",
  "sr.kg",
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
];

export function normalizeClass(c: string = ""): string {
  if (!c) return "";
  return c
    .toLowerCase()
    .replace(/^(class\s*)+/i, "")
    .replace(/\s+/g, "")
    .trim();
}

export function formatClassDisplay(className: string = ""): string {
  if (!className) return "";
  const trimmed = className.trim();
  const stripped = trimmed.replace(/^(class\s*)+/i, "").trim();
  return `Class ${stripped}`;
}

export function isClassInList(studentClass: string = "", classList: string[] = []): boolean {
  if (!studentClass || !classList || classList.length === 0) return false;
  const normSt = normalizeClass(studentClass);
  return classList.some((c) => normalizeClass(c) === normSt);
}

export function getEffectiveBatch(
  student: { batch?: string; class?: string },
  batch1Classes: string[] = [],
  batch2Classes: string[] = []
): BatchType | "Unassigned" {
  if (student.batch === "5-7" || student.batch === "7-9") {
    return student.batch as BatchType;
  }

  if (isClassInList(student.class, batch1Classes)) {
    return "5-7";
  }

  if (isClassInList(student.class, batch2Classes)) {
    return "7-9";
  }

  return "Unassigned";
}

export function getClassSortRank(className: string = ""): number {
  const norm = normalizeClass(className);
  const idx = ORDERED_CLASS_NORMS.indexOf(norm);
  return idx === -1 ? 99 : idx;
}

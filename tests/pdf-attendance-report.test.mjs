/**
 * Tests for the PDF attendance report data-processing logic.
 *
 * Since jsPDF requires browser DOM APIs (canvas, HTMLImageElement, etc.),
 * we test the exported pure data-transformation helpers that
 * generateAttendancePDF uses before invoking jsPDF.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  normalizeAttendanceStudents,
  buildAttendanceClassStats,
} from "../src/lib/attendance-report-data.ts";
import { getClassSortRank } from "../src/lib/class-utils.ts";

const readSource = (relativePath) =>
  readFileSync(new URL(relativePath, import.meta.url), "utf8");

const normalizeStudentList = normalizeAttendanceStudents;
const buildClassStats = buildAttendanceClassStats;

// --- Test data fixtures ---

const monthlyTabData = {
  studentRows: [
    { studentId: "SK-001", name: "Ayaan Khan", class: "Class 9", batch: "7-9", conducted: 20, present: 18, absent: 2, percentage: 90 },
    { studentId: "SK-002", name: "Fatima Sheikh", class: "Class 5", batch: "5-7", conducted: 20, present: 15, absent: 5, percentage: 75 },
    { studentId: "SK-003", name: "Zara Ahmed", class: "Jr.Kg", batch: "5-7", conducted: 10, present: 10, absent: 0, percentage: 100 },
  ]
};

const studentTabData = {
  students: [
    { studentId: "SK-001", name: "Ayaan Khan", class: "Class 9", batch: "7-9", totalConducted: 20, presentCount: 18, absentCount: 2, percentage: 90, consecutiveAbsences: 0 },
    { studentId: "SK-004", name: "Ibrahim Ali", class: "Class 2", batch: "5-7", totalConducted: 20, presentCount: 12, absentCount: 8, percentage: 60, consecutiveAbsences: 3 },
  ]
};

// --- Tests ---

describe("normalizeAttendanceStudents — monthly tab (studentRows shape)", () => {
  it("reads from studentRows field", () => {
    const result = normalizeStudentList(monthlyTabData);
    assert.equal(result.length, 3);
  });

  it("maps conducted/present/absent fields", () => {
    const result = normalizeStudentList(monthlyTabData);
    assert.equal(result[0].conducted, 20);
    assert.equal(result[0].present, 18);
    assert.equal(result[0].absent, 2);
  });

  it("preserves percentage", () => {
    const result = normalizeStudentList(monthlyTabData);
    assert.equal(result[0].percentage, 90);
  });

  it("consecutiveAbsences defaults to 0 when missing", () => {
    const result = normalizeStudentList(monthlyTabData);
    assert.equal(result[0].consecutiveAbsences, 0);
  });
});

describe("normalizeAttendanceStudents — summary tab (students shape)", () => {
  it("reads from students field when studentRows absent", () => {
    const result = normalizeStudentList(studentTabData);
    assert.equal(result.length, 2);
  });

  it("maps totalConducted → conducted alias", () => {
    const result = normalizeStudentList(studentTabData);
    assert.equal(result[0].conducted, 20);
  });

  it("maps presentCount → present alias", () => {
    const result = normalizeStudentList(studentTabData);
    assert.equal(result[0].present, 18);
  });

  it("maps absentCount → absent alias", () => {
    const result = normalizeStudentList(studentTabData);
    assert.equal(result[0].absent, 2);
  });

  it("preserves consecutiveAbsences", () => {
    const result = normalizeStudentList(studentTabData);
    assert.equal(result[1].consecutiveAbsences, 3);
  });
});

describe("normalizeAttendanceStudents — empty reportData", () => {
  it("returns empty array for empty reportData", () => {
    const result = normalizeStudentList({});
    assert.equal(result.length, 0);
  });

  it("returns empty array for empty student list", () => {
    const result = normalizeStudentList({ students: [] });
    assert.equal(result.length, 0);
  });
});

describe("Class sort ranking (getClassSortRank)", () => {
  it("Jr.Kg ranks first (index 0)", () => {
    assert.equal(getClassSortRank("Jr.Kg"), 0);
  });

  it("Sr.Kg ranks second (index 1)", () => {
    assert.equal(getClassSortRank("Sr.Kg"), 1);
  });

  it("Class 1 ranks at index 2", () => {
    assert.equal(getClassSortRank("Class 1"), 2);
  });

  it("Class 10 ranks last in known list (index 11)", () => {
    assert.equal(getClassSortRank("Class 10"), 11);
  });

  it("Unknown class ranks 99 (sorts to end)", () => {
    assert.equal(getClassSortRank("Class 11"), 99);
    assert.equal(getClassSortRank(""), 99);
  });

  it("Sorting normalized studentList puts Jr.Kg before Class 9", () => {
    const list = normalizeStudentList(monthlyTabData);
    list.sort((a, b) => {
      const ra = getClassSortRank(a.class), rb = getClassSortRank(b.class);
      if (ra !== rb) return ra - rb;
      return a.name.localeCompare(b.name);
    });
    assert.equal(list[0].class, "Jr.Kg");
    assert.equal(list[list.length - 1].class, "Class 9");
  });
});

describe("buildAttendanceClassStats aggregation", () => {
  it("aggregates students by class", () => {
    const list = normalizeStudentList(monthlyTabData);
    const stats = buildClassStats(list);
    const class9 = stats.find(s => s.className === "Class 9");
    assert.ok(class9, "Should have Class 9 entry");
    assert.equal(class9.count, 1);
    assert.equal(class9.cond, 20);
    assert.equal(class9.pres, 18);
    assert.equal(class9.abs, 2);
  });

  it("calculates attendance rate correctly", () => {
    const list = normalizeStudentList(monthlyTabData);
    const stats = buildClassStats(list);
    const class9 = stats.find(s => s.className === "Class 9");
    assert.ok(Math.abs(class9.rate - 90) < 0.01, `Expected rate ~90, got ${class9.rate}`);
  });

  it("calculates absence rate correctly", () => {
    const list = normalizeStudentList(monthlyTabData);
    const stats = buildClassStats(list);
    const class9 = stats.find(s => s.className === "Class 9");
    assert.ok(Math.abs(class9.absRate - 10) < 0.01, `Expected absRate ~10, got ${class9.absRate}`);
  });

  it("100% attendance class has absRate of 0", () => {
    const list = normalizeStudentList(monthlyTabData);
    const stats = buildClassStats(list);
    const jrkg = stats.find(s => s.className === "Jr.Kg");
    assert.ok(jrkg, "Should have Jr.Kg entry");
    assert.equal(jrkg.absRate, 0);
    assert.equal(jrkg.rate, 100);
  });

  it("handles zero conducted gracefully (rate = 0)", () => {
    const data = { studentRows: [{ studentId: "SK-X", name: "Test", class: "Class 3", batch: "5-7", conducted: 0, present: 0, absent: 0, percentage: 0 }] };
    const list = normalizeStudentList(data);
    const stats = buildClassStats(list);
    assert.equal(stats[0].rate, 0);
    assert.equal(stats[0].absRate, 0);
  });
});

describe("Restored report structure and headings", () => {
  it("keeps the original header, insight cards, tables and footer", () => {
    const source = readSource("../src/lib/pdf-attendance-report.ts");
    const requiredContent = [
      "SK TUTORIALS",
      "SK Tutorials Attendance Management System",
      "Key Insights",
      "Class-wise Attendance Distribution",
      "Student Attendance Matrix Details",
      "Prof. Fahim Sir ( Proprietor )  |  SK Tutorials",
    ];

    for (const text of requiredContent) {
      assert.ok(source.includes(text), `PDF source should contain: ${text}`);
    }
  });

  it("uses the original report titles for every report tab", () => {
    const source = readSource(
      "../src/app/(dashboard)/attendance/reports/page.tsx"
    );

    assert.match(source, /generateAttendancePDF/);
    assert.match(source, /Monthly Attendance Report/);
    assert.match(source, /Low Attendance Alert Report/);
    assert.match(source, /Consecutive Absence Alert Report/);
    assert.match(source, /Student Attendance Summary Report/);
  });
});

describe("Best / Lowest class identification", () => {
  it("identifies best class by highest rate", () => {
    const list = normalizeStudentList(monthlyTabData);
    const stats = buildClassStats(list);
    const sortedByRate = [...stats].sort((a, b) => b.rate - a.rate);
    assert.equal(sortedByRate[0].className, "Jr.Kg");
  });

  it("identifies lowest class by lowest rate", () => {
    const list = normalizeStudentList(monthlyTabData);
    const stats = buildClassStats(list);
    const active = stats.filter(c => c.cond > 0);
    const sortedAsc = active.sort((a, b) => a.rate - b.rate);
    assert.equal(sortedAsc[0].className, "Class 5");
  });
});

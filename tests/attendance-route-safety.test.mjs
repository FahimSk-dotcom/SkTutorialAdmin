import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const readSource = (relativePath) =>
  readFileSync(new URL(relativePath, import.meta.url), "utf8");

test("attendance creation uses scoped upserts and never deletes records", () => {
  const source = readSource("../src/app/api/attendance/route.ts");

  assert.match(source, /buildAttendanceUpsertOps/);
  assert.match(source, /docType: "attendance"/);
  assert.doesNotMatch(source, /deleteMany/);
  assert.doesNotMatch(source, /collection\("payments"\)/);
});

test("attendance updates use scoped upserts and never touch payments", () => {
  const source = readSource("../src/app/api/attendance/route.ts");

  assert.match(source, /buildAttendanceUpdateOp/);
  assert.match(source, /updateOne/);
  assert.doesNotMatch(source, /collection\("payments"\)/);
});

test("attendance check and dashboard filter active students only", () => {
  const checkSource = readSource("../src/app/api/attendance/check/route.ts");
  const dashboardSource = readSource("../src/app/api/dashboard/attendance/route.ts");

  assert.match(checkSource, /status: "Active"/);
  assert.match(dashboardSource, /status: "Active"/);
});

test("holiday deletion is restricted to attendance holiday documents", () => {
  const source = readSource("../src/app/api/holidays/route.ts");

  assert.match(source, /docType: "holiday"/);
  assert.match(source, /collection\("attendance"\)\.deleteOne/);
  assert.doesNotMatch(source, /collection\("payments"\)/);
  assert.doesNotMatch(source, /deleteMany/);
});

test("attendance reports read attendance only and do not delete anything", () => {
  const source = readSource("../src/app/api/reports/attendance/route.ts");

  assert.match(source, /docType: "attendance"/);
  assert.match(source, /docType: "holiday"/);
  assert.doesNotMatch(source, /deleteMany/);
  assert.doesNotMatch(source, /deleteOne/);
  assert.doesNotMatch(source, /collection\("payments"\)/);
});

test("settings mirroring writes attendance settings without touching payments", () => {
  const source = readSource("../src/app/api/settings/route.ts");

  assert.match(source, /docType: "settings"/);
  assert.match(source, /key: "app_settings"/);
  assert.doesNotMatch(source, /collection\("payments"\)/);
  assert.doesNotMatch(source, /deleteMany/);
});

test("student detail reads attendance history without deleting records", () => {
  const source = readSource("../src/app/api/students/[id]/route.ts");

  assert.match(source, /computeAttendanceSummary/);
  assert.match(source, /filterValidAttendance/);
  assert.doesNotMatch(source, /collection\("payments"\)\.delete/);
  assert.doesNotMatch(source, /deleteMany/);
});

test("step 03 atomic receipt numbering is preserved", () => {
  const source = readSource("../src/app/api/payments/route.ts");

  assert.match(source, /nextReceiptNo/);
  assert.doesNotMatch(source, /countDocuments/);
});

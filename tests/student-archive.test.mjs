import test from "node:test";
import assert from "node:assert/strict";
import {
  isArchivedStudent,
  isStudentEligibleForNewPayment,
  buildStudentArchiveUpdate,
  buildStudentReactivationUpdate,
} from "../src/lib/student-archive.ts";

test("archived status is detected", () => {
  assert.equal(isArchivedStudent({ status: "Inactive" }), true);
  assert.equal(isArchivedStudent({ status: "Active" }), false);
  assert.equal(isArchivedStudent({}), false);
});

test("only active students are eligible for new payments", () => {
  assert.equal(isStudentEligibleForNewPayment({ status: "Active" }), true);
  assert.equal(isStudentEligibleForNewPayment({ status: "Inactive" }), false);
  assert.equal(isStudentEligibleForNewPayment({}), false);
});

test("archive update preserves an existing archivedAt timestamp", () => {
  const now = new Date("2026-06-15T10:00:00.000Z");
  const update = buildStudentArchiveUpdate(now);

  assert.equal(update[0].$set.status, "Inactive");
  assert.equal(update[0].$set.updatedAt, now);
  assert.deepEqual(update[0].$set.archivedAt, { $ifNull: ["$archivedAt", now] });
});

test("reactivation clears archivedAt and restores active status", () => {
  const now = new Date("2026-06-15T10:00:00.000Z");
  const update = buildStudentReactivationUpdate(now);

  assert.equal(update.$set.status, "Active");
  assert.equal(update.$set.updatedAt, now);
  assert.deepEqual(update.$unset, { archivedAt: "" });
});

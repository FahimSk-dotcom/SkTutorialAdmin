import test from "node:test";
import assert from "node:assert/strict";
import { getNextStudentId } from "../src/lib/student-id.ts";

test("starts student IDs at SK-1001", () => {
  assert.equal(getNextStudentId(), "SK-1001");
  assert.equal(getNextStudentId(null), "SK-1001");
  assert.equal(getNextStudentId("not-an-id"), "SK-1001");
});

test("increments the highest existing student ID", () => {
  assert.equal(getNextStudentId("SK-1001"), "SK-1002");
  assert.equal(getNextStudentId("SK-1042"), "SK-1043");
});

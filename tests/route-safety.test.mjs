import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const readSource = (relativePath) =>
  readFileSync(new URL(relativePath, import.meta.url), "utf8");

test("individual student deletion archives instead of deleting records", () => {
  const source = readSource("../src/app/api/students/[id]/route.ts");

  assert.match(source, /buildStudentArchiveUpdate/);
  assert.doesNotMatch(source, /collection\("students"\)\.deleteOne/);
  assert.doesNotMatch(source, /collection\("payments"\)\.deleteMany/);
});

test("bulk student deletion archives instead of deleting records", () => {
  const source = readSource("../src/app/api/students/bulk/route.ts");

  assert.match(source, /buildStudentArchiveUpdate/);
  assert.match(source, /buildStudentReactivationUpdate/);
  assert.doesNotMatch(source, /collection\("students"\)\.deleteMany/);
  assert.doesNotMatch(source, /collection\("payments"\)\.deleteMany/);
});

test("payment creation enforces new payment rules", () => {
  const source = readSource("../src/app/api/payments/route.ts");

  assert.match(source, /validateNewPayment/);
});

test("payment creation uses the atomic receipt counter", () => {
  const source = readSource("../src/app/api/payments/route.ts");

  assert.match(source, /nextReceiptNo/);
  assert.match(source, /insertOne/);
  assert.doesNotMatch(source, /countDocuments/);
});

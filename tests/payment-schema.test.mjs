import test from "node:test";
import assert from "node:assert/strict";
import { paymentSchema } from "../src/schemas/index.ts";

const validPayment = {
  studentId: "SK-1001",
  paymentDate: "2026-06-15",
  month: 6,
  year: 2026,
  amount: 1500,
  mode: "Cash",
};

test("accepts a valid Cash or UPI payment", () => {
  assert.equal(paymentSchema.safeParse(validPayment).success, true);
  assert.equal(
    paymentSchema.safeParse({ ...validPayment, mode: "UPI" }).success,
    true
  );
});

test("rejects unsupported payment modes and invalid amounts", () => {
  assert.equal(
    paymentSchema.safeParse({ ...validPayment, mode: "Cheque" }).success,
    false
  );
  assert.equal(
    paymentSchema.safeParse({ ...validPayment, amount: 0 }).success,
    false
  );
  assert.equal(
    paymentSchema.safeParse({ ...validPayment, amount: -100 }).success,
    false
  );
});


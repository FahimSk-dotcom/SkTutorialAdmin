import test from "node:test";
import assert from "node:assert/strict";
import {
  RECEIPT_COUNTER_ID,
  RECEIPT_SEQ_START,
  buildReceiptCounterUpdate,
  formatReceiptNo,
  nextReceiptNo,
} from "../src/lib/counters.ts";

test("formats receipt numbers without changing the existing format", () => {
  assert.equal(formatReceiptNo(2026, 11, 1001), "REC-202611-1001");
  assert.equal(formatReceiptNo(2026, 1, 42), "REC-202601-42");
});

test("counter update starts at 1000 and increments atomically", () => {
  assert.equal(RECEIPT_SEQ_START, 1000);
  assert.deepEqual(buildReceiptCounterUpdate(), [
    {
      $set: {
        seq: {
          $add: [{ $ifNull: ["$seq", 1000] }, 1],
        },
      },
    },
  ]);
});

test("nextReceiptNo uses the counters collection atomically", async () => {
  const calls = [];
  const fakeDb = {
    collection(name) {
      assert.equal(name, "counters");
      return {
        async findOneAndUpdate(filter, update, options) {
          calls.push({ filter, update, options });
          return { _id: RECEIPT_COUNTER_ID, seq: 1001 };
        },
      };
    },
  };

  const receiptNo = await nextReceiptNo(fakeDb, 2026, 11);

  assert.equal(receiptNo, "REC-202611-1001");
  assert.deepEqual(calls[0].filter, { _id: RECEIPT_COUNTER_ID });
  assert.deepEqual(calls[0].update, buildReceiptCounterUpdate());
  assert.deepEqual(calls[0].options, { upsert: true, returnDocument: "after" });
});

test("nextReceiptNo rejects an invalid counter result", async () => {
  const fakeDb = {
    collection() {
      return {
        async findOneAndUpdate() {
          return { _id: RECEIPT_COUNTER_ID, seq: "not-a-number" };
        },
      };
    },
  };

  await assert.rejects(() => nextReceiptNo(fakeDb, 2026, 11), /invalid sequence/);
});

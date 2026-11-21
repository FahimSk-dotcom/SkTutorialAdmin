import type { Db } from "mongodb";

export const RECEIPT_COUNTER_ID = "receiptNo";
export const RECEIPT_SEQ_START = 1000;

export function formatReceiptNo(year: number, month: number, seq: number): string {
  return `REC-${year}${String(month).padStart(2, "0")}-${seq}`;
}

export function buildReceiptCounterUpdate() {
  return [
    {
      $set: {
        seq: {
          $add: [{ $ifNull: ["$seq", RECEIPT_SEQ_START] }, 1],
        },
      },
    },
  ];
}

export async function nextReceiptNo(
  db: Db,
  year: number,
  month: number
): Promise<string> {
  const result = await db
    .collection<{ _id: string; seq: number }>("counters")
    .findOneAndUpdate(
      { _id: RECEIPT_COUNTER_ID },
      buildReceiptCounterUpdate(),
      { upsert: true, returnDocument: "after" }
    );

  if (!result || typeof result.seq !== "number" || !Number.isSafeInteger(result.seq)) {
    throw new Error("Receipt counter returned an invalid sequence");
  }

  return formatReceiptNo(year, month, result.seq);
}

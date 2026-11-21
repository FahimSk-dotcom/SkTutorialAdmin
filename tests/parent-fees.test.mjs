import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildMonthlyFeeOverview,
  buildPaymentHistory,
  buildReceiptContentDisposition,
  formatFeeMonth,
  isValidFeeYear,
  isValidReceiptNo,
  kolkataDateToCalendarDate,
  PARENT_RECEIPT_CONTENT_TYPE,
} from "../src/lib/parent-fees.ts";
import {
  DEFAULT_QR_URL,
  pickFeeSettings,
} from "../src/lib/app-settings.ts";
import { buildReceiptPdf } from "../src/lib/receipt-pdf.ts";

const readSource = (relativePath) =>
  readFileSync(new URL(relativePath, import.meta.url), "utf8");

const feesRouteSource = () =>
  readSource("../src/app/api/parent/fees/route.ts");
const historyRouteSource = () =>
  readSource("../src/app/api/parent/fees/payments/route.ts");
const receiptRouteSource = () =>
  readSource("../src/app/api/parent/receipt/[receiptNo]/route.ts");

const TODAY = kolkataDateToCalendarDate("2026-11-14");

const student = {
  studentId: "SK-1001",
  name: "Student Name",
  class: "Class 9",
  monthlyFee: 750,
  admissionDate: "2026-07-01",
  status: "Active",
};

const payment = (month, overrides = {}) => ({
  studentId: "SK-1001",
  receiptNo: `REC-2026${String(month).padStart(2, "0")}-${1000 + month}`,
  paymentDate: `2026-${String(month).padStart(2, "0")}-14`,
  month,
  year: 2026,
  amount: 750,
  mode: "Cash",
  createdAt: `2026-${String(month).padStart(2, "0")}-14T10:00:00.000Z`,
  ...overrides,
});

test("fee year and receipt number validation reject unsafe values", () => {
  assert.equal(isValidFeeYear("2026"), true);
  assert.equal(isValidFeeYear("2000"), true);
  assert.equal(isValidFeeYear("2100"), true);
  for (const value of [undefined, "", "1999", "2101", "26", "2026-01", 2026]) {
    assert.equal(isValidFeeYear(value), false, `${value} should be invalid`);
  }

  assert.equal(isValidReceiptNo("REC-202607-1001"), true);
  assert.equal(isValidReceiptNo("REC-202607-1"), true);
  assert.equal(isValidReceiptNo("REC-202607-1001.pdf"), false);
  assert.equal(isValidReceiptNo("rec-202607-1001"), false);
  assert.equal(isValidReceiptNo("REC-202607-../../etc/passwd"), false);
  assert.equal(isValidReceiptNo("REC-202607-1001\r\nX-Test: 1"), false);
  assert.equal(isValidReceiptNo(null), false);
});

test("receipt headers are safe and deterministic", () => {
  assert.equal(PARENT_RECEIPT_CONTENT_TYPE, "application/pdf");
  assert.equal(
    buildReceiptContentDisposition("REC-202607-1001"),
    'inline; filename="Receipt_REC-202607-1001.pdf"'
  );
  assert.equal(
    buildReceiptContentDisposition('bad"name\r\n'),
    'inline; filename="Receipt_receipt.pdf"'
  );
});

test("fee months are zero padded and invalid values are rejected", () => {
  assert.equal(formatFeeMonth(2026, 7), "2026-07");
  assert.equal(formatFeeMonth(2026, 12), "2026-12");
  assert.equal(formatFeeMonth("2026", "3"), "2026-03");
  assert.equal(formatFeeMonth(2026, 13), "");
  assert.equal(formatFeeMonth(2026, 0), "");
  assert.equal(formatFeeMonth("abcd", 7), "");
});

test("monthly overview matches the Android contract with paid history", () => {
  const result = buildMonthlyFeeOverview({
    student,
    payments: [payment(7), payment(8), payment(9), payment(10)],
    year: 2026,
    today: TODAY,
  });

  assert.deepEqual(result, {
    student: {
      studentId: "SK-1001",
      name: "Student Name",
      class: "Class 9",
      admissionDate: "2026-07-01",
    },
    year: 2026,
    summary: {
      monthlyFee: 750,
      totalPaid: 3000,
      totalPending: 0,
      paidMonths: 4,
      pendingMonths: 0,
    },
    months: [
      {
        month: "2026-07",
        amount: 750,
        status: "Paid",
        dueDate: "2026-08-01",
        paidDate: "2026-07-14",
        receiptNo: "REC-202607-1007",
        isPaymentEligible: false,
      },
      {
        month: "2026-08",
        amount: 750,
        status: "Paid",
        dueDate: "2026-09-01",
        paidDate: "2026-08-14",
        receiptNo: "REC-202608-1008",
        isPaymentEligible: false,
      },
      {
        month: "2026-09",
        amount: 750,
        status: "Paid",
        dueDate: "2026-10-01",
        paidDate: "2026-09-14",
        receiptNo: "REC-202609-1009",
        isPaymentEligible: false,
      },
      {
        month: "2026-10",
        amount: 750,
        status: "Paid",
        dueDate: "2026-11-01",
        paidDate: "2026-10-14",
        receiptNo: "REC-202610-1010",
        isPaymentEligible: false,
      },
      {
        month: "2026-11",
        amount: 750,
        status: "Pending",
        dueDate: "2026-12-01",
        paidDate: null,
        receiptNo: null,
        isPaymentEligible: true,
      },
    ],
  });

  assert.deepEqual(Object.keys(result).sort(), [
    "months",
    "student",
    "summary",
    "year",
  ]);
  assert.deepEqual(Object.keys(result.months[0]).sort(), [
    "amount",
    "dueDate",
    "isPaymentEligible",
    "month",
    "paidDate",
    "receiptNo",
    "status",
  ]);
});

test("partially paid year uses existing due logic for pending months", () => {
  const result = buildMonthlyFeeOverview({
    student,
    payments: [payment(7), payment(9)],
    year: 2026,
    today: TODAY,
  });

  assert.deepEqual(result.summary, {
    monthlyFee: 750,
    totalPaid: 1500,
    totalPending: 1500,
    paidMonths: 2,
    pendingMonths: 2,
  });
  assert.deepEqual(
    result.months.map((month) => [month.month, month.status]),
    [
      ["2026-07", "Paid"],
      ["2026-08", "Pending"],
      ["2026-09", "Paid"],
      ["2026-10", "Pending"],
      ["2026-11", "Pending"],
    ]
  );
  assert.deepEqual(result.months[1], {
    month: "2026-08",
    amount: 750,
    status: "Pending",
    dueDate: "2026-09-01",
    paidDate: null,
    receiptNo: null,
    isPaymentEligible: true,
  });
  assert.deepEqual(result.months[4], {
    month: "2026-11",
    amount: 750,
    status: "Pending",
    dueDate: "2026-12-01",
    paidDate: null,
    receiptNo: null,
    isPaymentEligible: true,
  });
});

test("upcoming current fee is exposed but future months are not", () => {
  const result = buildMonthlyFeeOverview({
    student,
    payments: [payment(7), payment(8), payment(9), payment(10)],
    year: 2026,
    today: TODAY,
  });

  assert.deepEqual(
    result.months.map((month) => month.month),
    ["2026-07", "2026-08", "2026-09", "2026-10", "2026-11"]
  );
  assert.deepEqual(result.months[4], {
    month: "2026-11",
    amount: 750,
    status: "Pending",
    dueDate: "2026-12-01",
    paidDate: null,
    receiptNo: null,
    isPaymentEligible: true,
  });
  assert.equal(
    result.months.some((month) => month.month === "2026-12"),
    false
  );
});

test("a year before admission has no invented fee months", () => {
  const result = buildMonthlyFeeOverview({
    student,
    payments: [],
    year: 2025,
    today: TODAY,
  });

  assert.deepEqual(result.months, []);
  assert.deepEqual(result.summary, {
    monthlyFee: 750,
    totalPaid: 0,
    totalPending: 0,
    paidMonths: 0,
    pendingMonths: 0,
  });
});

test("a year after the last due month is not treated as pending", () => {
  const result = buildMonthlyFeeOverview({
    student,
    payments: [],
    year: 2027,
    today: TODAY,
  });

  assert.deepEqual(result.months, []);
  assert.equal(result.summary.pendingMonths, 0);
  assert.equal(result.summary.totalPending, 0);
});

test("invalid or missing admission dates do not crash fee calculation", () => {
  for (const admissionDate of ["", "not-a-date", "2026-02-30", null]) {
    const result = buildMonthlyFeeOverview({
      student: { ...student, admissionDate },
      payments: [payment(7)],
      year: 2026,
      today: TODAY,
    });

    assert.equal(result.summary.paidMonths, 1);
    assert.equal(result.summary.pendingMonths, 0);
    assert.deepEqual(
      result.months.map((month) => month.month),
      ["2026-07"]
    );
  }
});

test("duplicate month records keep the latest record and do not double count", () => {
  const result = buildMonthlyFeeOverview({
    student,
    payments: [
      payment(7, {
        amount: 750,
        mode: "Cash",
        receiptNo: "REC-202607-1001",
        createdAt: "2026-07-14T10:00:00.000Z",
      }),
      payment(7, {
        amount: 800,
        mode: "UPI",
        receiptNo: "REC-202607-1002",
        createdAt: "2026-07-15T10:00:00.000Z",
      }),
    ],
    year: 2026,
    today: TODAY,
  });

  assert.equal(result.summary.totalPaid, 800);
  assert.equal(result.summary.paidMonths, 1);
  assert.deepEqual(result.months[0], {
    month: "2026-07",
    amount: 800,
    status: "Paid",
    dueDate: "2026-08-01",
    paidDate: "2026-07-14",
    receiptNo: "REC-202607-1002",
    isPaymentEligible: false,
  });
  assert.equal(result.months.length, 5);
});

test("paid amounts come from stored payments while pending uses monthly fee", () => {
  const result = buildMonthlyFeeOverview({
    student,
    payments: [payment(7, { amount: 800 })],
    year: 2026,
    today: TODAY,
  });

  assert.equal(result.summary.monthlyFee, 750);
  assert.equal(result.summary.totalPaid, 800);
  assert.equal(result.summary.totalPending, 2250);
  assert.equal(
    result.months.find((month) => month.month === "2026-08").amount,
    750
  );
});

test("missing or malformed fee fields degrade safely", () => {
  const result = buildMonthlyFeeOverview({
    student: {
      studentId: undefined,
      name: "",
      class: undefined,
      monthlyFee: "not-a-number",
      admissionDate: "2026-07-01",
    },
    payments: [
      { year: 2026, month: 7, amount: "bad", receiptNo: 42 },
      { year: "bad", month: 8, amount: 750, receiptNo: "REC-202608-1001" },
    ],
    year: 2026,
    today: TODAY,
  });

  assert.equal(result.student.name, "Student");
  assert.equal(result.student.studentId, "");
  assert.equal(result.student.class, "");
  assert.equal(result.summary.monthlyFee, 0);
  assert.equal(result.summary.totalPaid, 0);
  assert.equal(result.summary.paidMonths, 1);
});

test("payment history matches contract and is newest first", () => {
  const result = buildPaymentHistory([
    payment(7, { mode: "Cash" }),
    payment(9, { mode: "UPI", paymentDate: "2026-09-20" }),
    payment(8, { mode: "Cash", paymentDate: "2026-08-05" }),
  ]);

  assert.deepEqual(
    result.map((item) => [item.month, item.paymentMethod, item.paymentDate]),
    [
      ["2026-09", "UPI", "2026-09-20"],
      ["2026-08", "Cash", "2026-08-05"],
      ["2026-07", "Cash", "2026-07-14"],
    ]
  );
  assert.deepEqual(Object.keys(result[0]).sort(), [
    "amount",
    "month",
    "paymentDate",
    "paymentMethod",
    "receiptNo",
    "studentId",
  ]);
  assert.equal(result[0].month, "2026-09");
});

test("payment history skips records without a usable year, month, or receipt", () => {
  const result = buildPaymentHistory([
    payment(7),
    { ...payment(8), receiptNo: "" },
    { ...payment(9), year: "x" },
    { ...payment(10), month: 13 },
  ]);

  assert.deepEqual(
    result.map((item) => item.month),
    ["2026-07"]
  );
});

test("fee settings fall back for empty or missing values", () => {
  assert.equal(pickFeeSettings({ upiQrUrl: "" }).upiQrUrl, DEFAULT_QR_URL);
  assert.equal(pickFeeSettings(null).upiQrUrl, DEFAULT_QR_URL);
  assert.equal(pickFeeSettings({}).instituteName, "SK Tutorials");
  assert.equal(
    pickFeeSettings({ instituteName: "Custom" }).instituteName,
    "Custom"
  );
});

test("shared receipt builder produces real PDF bytes", async () => {
  const pdf = await buildReceiptPdf({
    payment: {
      receiptNo: "REC-202607-1001",
      studentId: "SK-1001",
      paymentDate: "2026-07-14",
      month: 7,
      year: 2026,
      amount: 750,
      mode: "Cash",
    },
    studentName: "Student Name",
    studentClass: "Class 9",
    instituteName: "SK Tutorials",
  });

  const bytes = new Uint8Array(pdf.output("arraybuffer"));
  assert.ok(bytes.byteLength > 1000);
  assert.equal(Buffer.from(bytes.slice(0, 4)).toString("ascii"), "%PDF");
});

test("receipt builder embeds both PNG and JPEG data URLs", async () => {
  const pngDataUrl =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
  const jpegDataUrl = `data:image/jpeg;base64,${readFileSync(
    new URL("../public/upi-qr.jpg", import.meta.url)
  ).toString("base64")}`;

  const pdf = await buildReceiptPdf({
    payment: {
      receiptNo: "REC-202607-1001",
      studentId: "SK-1001",
      paymentDate: "2026-07-14",
      month: 7,
      year: 2026,
      amount: 750,
      mode: "UPI",
    },
    studentName: "Student Name",
    studentClass: "Class 9",
    instituteName: "SK Tutorials",
    logoDataUrl: pngDataUrl,
    qrDataUrl: jpegDataUrl,
  });

  const bytes = new Uint8Array(pdf.output("arraybuffer"));
  assert.equal(Buffer.from(bytes.slice(0, 4)).toString("ascii"), "%PDF");
});

test("admin receipt modal uses the same shared PDF builder", () => {
  const source = readSource("../src/components/payments/ReceiptModal.tsx");
  assert.match(source, /buildReceiptPdf/);
  assert.doesNotMatch(source, /new jsPDF/);
});

test("fees route requires bearer auth and enforces parent/student access restrictions", () => {
  const source = feesRouteSource();
  assert.match(source, /getAuthenticatedParent/);
  assert.match(source, /requireActiveStudents/);
  assert.match(source, /verifyParentStudentAccess/);
  assert.match(source, /PARENT_ACCESS_RESTRICTED|parentAccessRestrictedBody/);
  assert.match(source, /verifyParentStudentAccess/);
  assert.match(source, /failure\.body/);
  assert.match(source, /access\.failure\.status|auth\.status/);
  assert.doesNotMatch(source, /searchParams\.get\("parentId"\)/);
  assert.doesNotMatch(source, /request\.json/);
});

test("fees route validates studentId and year before querying", () => {
  const source = feesRouteSource();
  assert.match(source, /studentId is required/);
  assert.match(source, /Invalid studentId/);
  assert.match(source, /isValidFeeYear/);
  assert.match(source, /STUDENT_ID_PATTERN/);
  assert.match(source, /project\(/);
});

test("fees route is read-only and uses the parent CORS response helpers", () => {
  const source = feesRouteSource();
  assert.doesNotMatch(
    source,
    /insertOne|insertMany|updateOne|updateMany|deleteOne|deleteMany|bulkWrite/
  );
  assert.doesNotMatch(source, /passwordHash|parentMobile/);
  assert.doesNotMatch(source, /linkedStudentIds:\s*1/);
  assert.match(source, /parentJson/);
  assert.match(source, /export function OPTIONS/);
  assert.match(source, /buildMonthlyFeeOverview/);
});

test("payment history route is scoped, sorted, read-only, and authenticated", () => {
  const source = historyRouteSource();
  assert.match(source, /getAuthenticatedParent/);
  assert.match(source, /requireActiveStudents/);
  assert.match(source, /verifyParentStudentAccess/);
  assert.match(source, /studentId is required/);
  assert.match(source, /Invalid studentId/);
  assert.match(source, /find\(\s*\{\s*studentId\s*\}/);
  assert.match(source, /sort\(\{\s*paymentDate:\s*-1,\s*createdAt:\s*-1\s*\}\)/);
  assert.match(source, /buildPaymentHistory/);
  assert.match(source, /parentJson/);
  assert.match(source, /export function OPTIONS/);
  assert.doesNotMatch(
    source,
    /insertOne|insertMany|updateOne|updateMany|deleteOne|deleteMany|bulkWrite/
  );
  assert.doesNotMatch(source, /passwordHash|parentMobile/);
  assert.doesNotMatch(source, /request\.json/);
});

test("receipt route authenticates and authorizes before generating a PDF", () => {
  const source = receiptRouteSource();
  const authCheck = source.indexOf("getAuthenticatedParent");
  const accessCheck = source.indexOf("verifyParentStudentAccess");
  const pdfBuild = source.indexOf("buildReceiptPdf");

  assert.match(source, /getAuthenticatedParent/);
  assert.match(source, /requireActiveStudents/);
  assert.match(source, /verifyParentStudentAccess/);
  assert.match(source, /isValidReceiptNo/);
  assert.match(source, /findOne\(\s*\{\s*receiptNo/);
  assert.ok(authCheck >= 0);
  assert.ok(accessCheck > authCheck);
  assert.ok(pdfBuild > accessCheck);
  assert.match(source, /Receipt not found/);
  assert.match(source, /STUDENT_INACTIVE|studentInactiveBody/);
  assert.doesNotMatch(source, /request\.json/);
  assert.doesNotMatch(source, /searchParams/);
});

test("receipt route returns PDF bytes with private no-store headers", () => {
  const source = receiptRouteSource();
  assert.match(source, /PARENT_RECEIPT_CONTENT_TYPE/);
  assert.match(source, /Content-Disposition/);
  assert.match(source, /buildReceiptContentDisposition/);
  assert.match(source, /Cache-Control/);
  assert.match(source, /private, no-store/);
  assert.match(source, /X-Content-Type-Options/);
  assert.match(source, /nosniff/);
  assert.match(source, /parentBinary/);
  assert.match(source, /runtime = "nodejs"/);
  assert.doesNotMatch(source, /NextResponse\.redirect|redirect\(/);
  assert.doesNotMatch(source, /publicToken|signedUrl/);
});

test("receipt route cannot modify payment or student records", () => {
  const source = receiptRouteSource();
  assert.doesNotMatch(
    source,
    /insertOne|insertMany|updateOne|updateMany|deleteOne|deleteMany|bulkWrite/
  );
  assert.doesNotMatch(source, /passwordHash|parentMobile/);
  assert.doesNotMatch(source, /linkedStudentIds:\s*1/);
});

test("Next.js proxy allows all new parent fee and receipt routes", () => {
  const source = readSource("../src/proxy.ts");
  assert.ok(source.includes('pathname === "/api/parent/fees"'));
  assert.ok(source.includes('pathname === "/api/parent/fees/payments"'));
  assert.ok(source.includes('pathname.startsWith("/api/parent/receipt/")'));
  assert.match(source, /!isParentApiRoute/);
});

test("existing admin payment creation flow is untouched", () => {
  const source = readSource("../src/app/api/payments/route.ts");
  assert.match(source, /validateNewPayment/);
  assert.match(source, /nextReceiptNo/);
  assert.match(source, /insertOne/);
  assert.match(source, /payments/);
});

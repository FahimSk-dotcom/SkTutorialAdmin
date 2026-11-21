import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  DEFAULT_REMINDER_SETTINGS,
  feeReminderSettingsSchema,
  isReminderDay,
  renderFeeReminder,
} from "../src/lib/fee-reminder-config.ts";
import {
  calculateOutstandingFees,
  kolkataDateToCalendarDate,
} from "../src/lib/parent-fees.ts";

test("frequency is anchored to Kolkata calendar days across a year boundary", () => {
  assert.equal(DEFAULT_REMINDER_SETTINGS.enabled, false);
  const expected = { daily: 1, every2Days: 2, every3Days: 3, weekly: 7 };
  for (const [frequency, interval] of Object.entries(expected)) {
    const settings = { ...DEFAULT_REMINDER_SETTINGS, frequency, scheduleAnchorDate: "2026-12-31" };
    assert.equal(isReminderDay(settings, "2026-12-30"), false);
    assert.equal(isReminderDay(settings, "2026-12-31"), true);
    for (let day = 1; day <= 14; day++) {
      assert.equal(isReminderDay(settings, `2027-01-${String(day).padStart(2, "0")}`), day % interval === 0);
    }
  }
});

test("reminders consider unpaid due months across years and exclude the next fee until due", () => {
  const student = { admissionDate: "2026-11-30", monthlyFee: 500 };
  const paid = [{ month: 11, year: 2026 }];
  const getOutstanding = (date) => calculateOutstandingFees(student, paid, kolkataDateToCalendarDate(date));
  assert.deepEqual(getOutstanding("2027-01-29"), []);
  assert.deepEqual(getOutstanding("2027-01-30").map((month) => month.monthName), ["December 2026"]);
  assert.deepEqual(getOutstanding("2027-02-28").map((month) => month.monthName), ["December 2026", "January 2027"]);
  assert.deepEqual(calculateOutstandingFees(student, [
    ...paid, { month: 12, year: 2026 }, { month: 1, year: 2027 },
  ], kolkataDateToCalendarDate("2027-02-28")), []);
});

test("single-period templates render safely and multiple periods are consolidated", () => {
  const template = "{studentName}: {feeMonth}, {amount}";
  const { enabled, frequency, title } = DEFAULT_REMINDER_SETTINGS;
  const validate = (messageTemplate) =>
    feeReminderSettingsSchema.safeParse({ enabled, frequency, title, messageTemplate }).success;
  assert.equal(validate(template), true);
  for (const invalid of ["{password}", "{{studentName}}", "{feeMonth", "amount}"]) {
    assert.equal(validate(invalid), false);
  }

  const ayaan = { name: "Ayaan", months: [{ monthName: "October 2026", amount: 500 }] };
  const sara = { name: "Sara", months: [
    { monthName: "September 2026", amount: 600 }, { monthName: "October 2026", amount: 600 },
  ] };
  assert.equal(renderFeeReminder(template, [ayaan]), "Ayaan: October 2026, ₹500.00");
  assert.match(renderFeeReminder(template, [sara]), /Sara \(September 2026, October 2026\)/);
  assert.match(renderFeeReminder(template, [ayaan, sara]), /Ayaan \(October 2026\); Sara \(September 2026, October 2026\).*₹1,700\.00/);
});

test("deployment config uses one daily cron at 12:30 UTC", () => {
  const vercel = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
  assert.deepEqual(vercel.crons, [{ path: "/api/cron/fee-reminders", schedule: "30 12 * * *" }]);
});

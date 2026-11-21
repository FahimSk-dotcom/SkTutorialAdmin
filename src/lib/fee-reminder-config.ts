import { z } from "zod";

export const FEE_REMINDER_SETTINGS_ID = "feeReminderSettings";
export const FEE_REMINDER_CRON_TARGET = "6:00 PM IST";
export const REMINDER_FREQUENCIES = {
  daily: { label: "Daily", days: 1 },
  every2Days: { label: "Every 2 Days", days: 2 },
  every3Days: { label: "Every 3 Days", days: 3 },
  weekly: { label: "Weekly", days: 7 },
} as const;

const placeholder = /\{(studentName|feeMonth|amount)\}/g;
export const feeReminderSettingsSchema = z.object({
  enabled: z.boolean(),
  frequency: z.enum(["daily", "every2Days", "every3Days", "weekly"]),
  title: z.string().trim().min(1).max(100),
  messageTemplate: z.string().trim().min(1).max(400).refine(
    (message) => !/[{}]/.test(message.replace(placeholder, "")),
    "Use only {studentName}, {feeMonth}, and {amount} as placeholders."
  ),
}).strict();

export type ReminderSettingsInput = z.infer<typeof feeReminderSettingsSchema>;
export type ReminderSettings = ReminderSettingsInput & {
  scheduleAnchorDate: string | null;
  timezone: "Asia/Kolkata";
};

export const DEFAULT_REMINDER_SETTINGS: ReminderSettings = {
  enabled: false,
  frequency: "daily",
  title: "SK TUTORIALS – Fee Reminder",
  messageTemplate: "Assalamualaikum, Dear Parent, your child {studentName}'s fee for {feeMonth} is pending. Kindly pay the outstanding fee at the earliest. If already paid, please ignore this reminder. – SK TUTORIALS",
  scheduleAnchorDate: null,
  timezone: "Asia/Kolkata",
};

export function isReminderDay(settings: ReminderSettings, date: string) {
  if (!settings.scheduleAnchorDate) return false;
  const elapsedDays = (Date.parse(date) - Date.parse(settings.scheduleAnchorDate)) / 86_400_000;
  return elapsedDays >= 0 && elapsedDays % REMINDER_FREQUENCIES[settings.frequency].days === 0;
}

export const formatReminderAmount = (amount: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(amount);

export function renderFeeReminder(
  template: string,
  students: { name: string; months: { monthName: string; amount: number }[] }[]
) {
  if (students.length === 1 && students[0].months.length === 1) {
    const [student] = students;
    const [month] = student.months;
    const values = {
      studentName: student.name.slice(0, 100),
      feeMonth: month.monthName,
      amount: formatReminderAmount(month.amount),
    };
    // Bound the FCM payload even if a placeholder appears many times.
    const body = template.replace(placeholder, (_, key: keyof typeof values) => values[key]);
    return body.length <= 600 ? body : `${Array.from(body).slice(0, 580).join("")}… Open Fees for details.`;
  }

  const detail = students.map(({ name, months }) =>
    `${name} (${months.map((month) => month.monthName).join(", ")})`
  ).join("; ");
  const amount = students.reduce((sum, student) =>
    sum + student.months.reduce((total, month) => total + month.amount, 0), 0);
  const summary = detail.length <= 210
    ? `fees are pending for ${detail}.`
    : `${students.reduce((sum, student) => sum + student.months.length, 0)} monthly fees are pending. Open Fees for the full breakdown.`;
  return `Assalamualaikum, Dear Parent, ${summary} Total due ${formatReminderAmount(amount)}. Kindly clear the outstanding fees. – SK TUTORIALS`;
}

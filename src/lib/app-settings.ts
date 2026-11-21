import type { Db, ObjectId } from "mongodb";
import type { AttendanceSettingsConfig } from "@/types";
import { FEE_REMINDER_SETTINGS_ID } from "./fee-reminder-config.ts";

export const GENERAL_SETTINGS_FILTER = { _id: { $ne: FEE_REMINDER_SETTINGS_ID } };
export const generalSettings = (db: Db) =>
  db.collection<{ _id: ObjectId | string } & Record<string, unknown>>("settings");

export const DEFAULT_LOGO_URL =
  "https://res.cloudinary.com/dfmcngduw/image/upload/v1784896530/86a65215-ce9c-427d-9cc5-f67d0a08040c_gyndgk.png";
export const DEFAULT_QR_URL = "/upi-qr.jpg";

export interface FeeSettings {
  instituteName: string;
  logoUrl: string;
  upiId: string;
  upiQrUrl: string;
  receiptFooter: string;
}

export const DEFAULT_FEE_SETTINGS: FeeSettings = {
  instituteName: "SK Tutorials",
  logoUrl: DEFAULT_LOGO_URL,
  upiId: "sktutorials@upi",
  upiQrUrl: DEFAULT_QR_URL,
  receiptFooter: "Thank you for choosing SK Tutorials. Fee once paid is non-refundable.",
};

export const DEFAULT_ATTENDANCE_SETTINGS: AttendanceSettingsConfig = {
  teacherName: "Prof. Fahim Sir",
  batch1Name: "5–7",
  batch1Timing: "5:00 PM – 7:00 PM",
  batch1Classes: [
    "Jr.Kg",
    "Sr.Kg",
    "Class 1",
    "Class 2",
    "Class 3",
    "Class 4",
    "Class 5",
    "Class 6",
    "Class 7",
    "Class 8",
  ],
  batch2Name: "7–9",
  batch2Timing: "7:00 PM – 9:00 PM",
  batch2Classes: ["Class 9", "Class 10"],
  attendanceThreshold: 75,
  consecutiveAbsenceThreshold: 3,
};

const ATTENDANCE_KEYS: (keyof AttendanceSettingsConfig)[] = [
  "teacherName",
  "batch1Name",
  "batch1Timing",
  "batch1Classes",
  "batch2Name",
  "batch2Timing",
  "batch2Classes",
  "attendanceThreshold",
  "consecutiveAbsenceThreshold",
];

export function hasAttendanceSettings(
  doc: Record<string, any> | null | undefined
): boolean {
  if (!doc) return false;
  return ATTENDANCE_KEYS.some((key) => doc[key] !== undefined);
}

export function pickAttendanceSettings(
  doc: Record<string, any> | null | undefined
): AttendanceSettingsConfig {
  const source = doc || {};
  return {
    teacherName: source.teacherName || DEFAULT_ATTENDANCE_SETTINGS.teacherName,
    batch1Name: source.batch1Name || DEFAULT_ATTENDANCE_SETTINGS.batch1Name,
    batch1Timing: source.batch1Timing || DEFAULT_ATTENDANCE_SETTINGS.batch1Timing,
    batch1Classes: Array.isArray(source.batch1Classes)
      ? source.batch1Classes
      : DEFAULT_ATTENDANCE_SETTINGS.batch1Classes,
    batch2Name: source.batch2Name || DEFAULT_ATTENDANCE_SETTINGS.batch2Name,
    batch2Timing: source.batch2Timing || DEFAULT_ATTENDANCE_SETTINGS.batch2Timing,
    batch2Classes: Array.isArray(source.batch2Classes)
      ? source.batch2Classes
      : DEFAULT_ATTENDANCE_SETTINGS.batch2Classes,
    attendanceThreshold:
      typeof source.attendanceThreshold === "number"
        ? source.attendanceThreshold
        : DEFAULT_ATTENDANCE_SETTINGS.attendanceThreshold,
    consecutiveAbsenceThreshold:
      typeof source.consecutiveAbsenceThreshold === "number"
        ? source.consecutiveAbsenceThreshold
        : DEFAULT_ATTENDANCE_SETTINGS.consecutiveAbsenceThreshold,
  };
}

export function pickFeeSettings(
  doc: Record<string, any> | null | undefined
): FeeSettings {
  const source = doc || {};
  return {
    instituteName: source.instituteName || DEFAULT_FEE_SETTINGS.instituteName,
    logoUrl: source.logoUrl || DEFAULT_FEE_SETTINGS.logoUrl,
    upiId: source.upiId || DEFAULT_FEE_SETTINGS.upiId,
    upiQrUrl: source.upiQrUrl || DEFAULT_FEE_SETTINGS.upiQrUrl,
    receiptFooter: source.receiptFooter || DEFAULT_FEE_SETTINGS.receiptFooter,
  };
}

export async function loadFeeSettings(db: Db): Promise<FeeSettings> {
  const doc = await generalSettings(db).findOne(GENERAL_SETTINGS_FILTER);
  return pickFeeSettings(doc);
}

export async function loadAttendanceSettings(db: Db): Promise<AttendanceSettingsConfig> {
  const unified = await generalSettings(db).findOne(GENERAL_SETTINGS_FILTER);
  if (hasAttendanceSettings(unified)) {
    return pickAttendanceSettings(unified);
  }

  const legacy = await db
    .collection("attendance")
    .findOne({ docType: "settings", key: "app_settings" });
  if (legacy) {
    return pickAttendanceSettings(legacy);
  }

  return { ...DEFAULT_ATTENDANCE_SETTINGS };
}

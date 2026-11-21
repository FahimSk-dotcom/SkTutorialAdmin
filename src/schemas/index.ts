import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
  password: z.string().min(6, "Password must be at least 6 characters"),
  rememberMe: z.boolean().optional(),
});

const normalizedParentMobile = z.preprocess(
  (value) =>
    value === null || value === undefined
      ? value
      : String(value).replace(/[\s-]/g, "").trim(),
  z
    .string()
    .regex(/^[0-9]{10}$/, "Parent mobile number must be exactly 10 digits")
);

export const parentLoginSchema = z.object({
  parentMobile: normalizedParentMobile,
  password: z
    .string()
    .min(1, "Password is required")
    .max(200, "Password is too long"),
  deviceId: z
    .string()
    .trim()
    .min(1, "Device ID is invalid")
    .max(256, "Device ID is too long")
    .optional(),
});

export const parentPasswordResetSchema = z.object({
  studentId: z.string().trim().min(1, "Student reference is required").max(100),
  newPassword: z.string().min(8, "Password must be at least 8 characters").max(200, "Password is too long"),
  confirmPassword: z.string().min(8, "Password confirmation is required").max(200, "Password is too long"),
}).strict();

export const studentSchema = z.object({
  name: z.string().min(2, "Student name is required"),
  class: z.string().min(1, "Class is required"),
  batch: z.string().optional(),
  monthlyFee: z.number().positive("Monthly fee must be positive"),
  parentName: z.string().min(2, "Parent name is required"),
  parentMobile: z
    .string()
    .regex(/^[0-9]{10}$/, "Parent mobile number must be exactly 10 digits"),
  alternateMobile: z
    .string()
    .regex(/^[0-9]{10}$/, "Alternate mobile must be 10 digits")
    .optional()
    .or(z.literal("")),
  admissionDate: z.string().min(1, "Admission date is required"),
  status: z.enum(["Active", "Inactive"]),
  address: z.string().optional(),
  remarks: z.string().optional(),
});

export const paymentSchema = z.object({
  studentId: z.string().min(1, "Student is required"),
  paymentDate: z.string().min(1, "Payment date is required"),
  month: z.number().min(1).max(12),
  year: z.number().min(2020).max(2100),
  amount: z.number().positive("Amount must be positive"),
  mode: z.enum(["Cash", "UPI"]),
  remarks: z.string().optional(),
});

export const expenseSchema = z.object({
  name: z.string().min(2, "Expense name is required"),
  category: z.string().min(1, "Category is required"),
  amount: z.number().positive("Amount must be positive"),
  date: z.string().min(1, "Date is required"),
  notes: z.string().optional(),
});

export const settingsSchema = z.object({
  instituteName: z.string().min(2, "Institute name is required"),
  logoUrl: z.string().optional(),
  upiId: z.string().optional(),
  upiQrUrl: z.string().optional(),
  receiptFooter: z.string().optional(),
});

export const attendanceItemSchema = z.object({
  studentId: z.string().min(1, "Student ID is required"),
  status: z.enum(["present", "absent"]),
});

export const attendanceSubmitSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD"),
  batch: z.enum(["5-7", "7-9"]),
  records: z.array(attendanceItemSchema).min(1, "At least one student record is required"),
});

export const singleAttendanceUpdateSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD"),
  batch: z.enum(["5-7", "7-9"]),
  studentId: z.string().min(1, "Student ID is required"),
  status: z.enum(["present", "absent"]),
});

export const holidaySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD"),
  batch: z.enum(["ALL", "5-7", "7-9"]).default("ALL"),
  reason: z.enum(["Holiday", "Vacation", "Personal", "Other"]),
  description: z.string().optional(),
});

export const attendanceSettingsSchema = z.object({
  teacherName: z.string().min(2, "Teacher name is required"),
  batch1Name: z.string().min(1, "Batch 1 name is required"),
  batch1Timing: z.string().min(1, "Batch 1 timing is required"),
  batch1Classes: z.array(z.string()).default([]),
  batch2Name: z.string().min(1, "Batch 2 name is required"),
  batch2Timing: z.string().min(1, "Batch 2 timing is required"),
  batch2Classes: z.array(z.string()).default([]),
  attendanceThreshold: z.number().min(0).max(100),
  consecutiveAbsenceThreshold: z.number().min(1).max(30),
});

export const unifiedSettingsUpdateSchema = settingsSchema.partial().extend({
  teacherName: z.string().min(2, "Teacher name is required").optional(),
  batch1Name: z.string().min(1, "Batch 1 name is required").optional(),
  batch1Timing: z.string().min(1, "Batch 1 timing is required").optional(),
  batch1Classes: z.array(z.string()).optional(),
  batch2Name: z.string().min(1, "Batch 2 name is required").optional(),
  batch2Timing: z.string().min(1, "Batch 2 timing is required").optional(),
  batch2Classes: z.array(z.string()).optional(),
  attendanceThreshold: z.number().min(0).max(100).optional(),
  consecutiveAbsenceThreshold: z.number().min(1).max(30).optional(),
});

const trimmedNonEmpty = (label: string, max: number) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required`)
    .max(max, `${label} must be at most ${max} characters`);

export const announcementCreateSchema = z
  .object({
    title: trimmedNonEmpty("Title", 100),
    message: z
      .string()
      .trim()
      .min(1, "Message is required")
      .max(2000, "Message must be at most 2000 characters"),
    type: z.enum(["GENERAL", "CLASS_WISE"]),
    targetClasses: z.array(z.string().trim().min(1)).default([]),
    clientPublishId: z.string().trim().min(8).max(128).optional(),
    isImportant: z.boolean().default(false),
  })
  .superRefine((value, ctx) => {
    const unique = Array.from(new Set(value.targetClasses.map((c) => c.trim()).filter(Boolean)));
    if (value.type === "CLASS_WISE" && unique.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["targetClasses"],
        message: "Select at least one class for a class-wise announcement",
      });
    }
    if (value.type === "GENERAL" && unique.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["targetClasses"],
        message: "General announcements cannot target specific classes",
      });
    }
  });

export const parentDeviceRegisterSchema = z.object({
  fcmToken: z.string().trim().min(20, "A valid FCM token is required").max(4096),
  platform: z.enum(["android", "ios", "web"]).default("android"),
  deviceId: z.string().trim().min(1).max(256).optional(),
});

export const parentDeviceUnregisterSchema = z.object({
  fcmToken: z.string().trim().min(20).max(4096).optional(),
  deviceId: z.string().trim().min(1).max(256).optional(),
}).refine((v) => Boolean(v.fcmToken || v.deviceId), {
  message: "fcmToken or deviceId is required",
});

export type LoginInput = z.infer<typeof loginSchema>;
export type ParentLoginInput = z.infer<typeof parentLoginSchema>;
export type StudentInput = z.infer<typeof studentSchema>;
export type PaymentInput = z.infer<typeof paymentSchema>;
export type ExpenseInput = z.infer<typeof expenseSchema>;
export type SettingsInput = z.infer<typeof settingsSchema>;
export type AttendanceSubmitInput = z.infer<typeof attendanceSubmitSchema>;
export type SingleAttendanceUpdateInput = z.infer<typeof singleAttendanceUpdateSchema>;
export type HolidayInput = z.infer<typeof holidaySchema>;
export type AttendanceSettingsInput = z.infer<typeof attendanceSettingsSchema>;
export type UnifiedSettingsUpdateInput = z.infer<typeof unifiedSettingsUpdateSchema>;
export type AnnouncementCreateInput = z.infer<typeof announcementCreateSchema>;
export type ParentDeviceRegisterInput = z.infer<typeof parentDeviceRegisterSchema>;
export type ParentDeviceUnregisterInput = z.infer<typeof parentDeviceUnregisterSchema>;

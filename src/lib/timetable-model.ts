import { z } from "zod";

export const SCHOOL_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
const day = z.enum(SCHOOL_DAYS);
const subject = z.string().trim().min(1).max(100);
const common = { isPublished: z.boolean() };

export const timetableInput = z.discriminatedUnion("layout", [
  z.object({
    ...common, layout: z.literal("single_subject"),
    days: z.array(z.object({ day, subject }).strict()).length(SCHOOL_DAYS.length),
  }).strict(),
  z.object({
    ...common, layout: z.literal("classwork_homework"),
    days: z.array(z.object({ day, classwork: subject, homework: subject }).strict()).length(SCHOOL_DAYS.length),
  }).strict(),
]).refine((value) => value.days.every((row, index) => row.day === SCHOOL_DAYS[index]), {
  path: ["days"], message: "Provide each weekday once, in Monday–Saturday order.",
});

export const timetableUpdate = z.object({
  timetable: timetableInput,
  revision: z.number().int().nonnegative().nullable(),
}).strict();

export type TimetableData = z.infer<typeof timetableInput>;
export type TimetableLayout = TimetableData["layout"];
export type TimetableView = TimetableData & { class: string; revision: number; updatedAt: string | null };

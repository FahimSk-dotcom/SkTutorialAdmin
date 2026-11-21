import { SCHOOL_DAYS, type TimetableData } from "./timetable-model.ts";

function single(subjects: readonly string[]): TimetableData {
  return {
    layout: "single_subject", isPublished: true,
    days: SCHOOL_DAYS.map((day, index) => ({ day, subject: subjects[index] })),
  };
}

function split(subjects: readonly (readonly [string, string])[]): TimetableData {
  return {
    layout: "classwork_homework", isPublished: true,
    days: SCHOOL_DAYS.map((day, index) => ({ day, classwork: subjects[index][0], homework: subjects[index][1] })),
  };
}

const senior = [
  ["English", "English"], ["Science", "Science"], ["Marathi", "Marathi"],
  ["History/Geography", "S.S"], ["Maths", "Computer / Hindi"], ["Grammar", "Revision"],
] as const;

export const TIMETABLE_SEEDS: Record<string, TimetableData> = {
  "1": single(["EVS/Computer", "Maths/G.K", "English", "Grammar/Composition", "Marathi/Hindi", "Weekly Revision"]),
  "2": single(["EVS/Computer", "Marathi/Hindi", "Maths/G.K", "English", "Grammar/Composition", "Weekly Revision"]),
  "3": split([["EVS", "EVS"], ["Hindi", "Hindi / Computer"], ["EVS", "EVS"], ["Maths", "Maths"], ["Marathi", "Marathi"], ["English", "Revision"]]),
  "4": split([["EVS 1", "EVS 1"], ["Hindi", "Hindi / Computer"], ["EVS 2", "EVS 2"], ["Maths", "Maths"], ["Marathi", "Marathi"], ["English", "Revision"]]),
  "5": split([["Marathi", "Marathi"], ["EVS 2", "EVS 2"], ["Maths", "Maths"], ["Hindi", "Hindi / Computer"], ["English", "English"], ["EVS 1", "EVS 1"]]),
  "6": split([["Marathi", "Marathi"], ["History/Civics", "Geography"], ["Maths", "Maths"], ["Hindi", "Hindi / Computer"], ["English", "English"], ["Science", "Science"]]),
  "7": split(senior),
  "8": split(senior),
};

import { MongoServerError, type Db } from "mongodb";
import { getClassSortRank, normalizeClass } from "./class-utils";
import { ALL_CLASSES } from "@/types";
import { STUDENTS_COLLECTION } from "./parent-auth";
import type { TimetableData, TimetableView } from "./timetable-model";
import { TIMETABLE_SEEDS } from "./timetable-seeds";

type TimetableDocument = TimetableData & {
  class: string;
  revision?: number;
  updatedAt?: Date;
  updatedBy?: string | null;
};

const collection = (db: Db) => db.collection<TimetableDocument>("class_timetables", {
  readPreference: "primary", writeConcern: { w: "majority" },
});

const initialized = new WeakMap<Db, Promise<void>>();

export function initializeTimetables(db: Db) {
  let task = initialized.get(db);
  if (!task) {
    task = (async () => {
      const timetables = collection(db);
      await timetables.createIndex({ class: 1 }, { unique: true });
      const existingClasses = new Set((await timetables.distinct("class")).map(normalizeClass));
      const now = new Date();
      const missing = Object.entries(TIMETABLE_SEEDS).filter(([classId]) => !existingClasses.has(classId));
      if (!missing.length) return;
      await timetables.bulkWrite(missing.map(([classId, timetable]) => ({
        updateOne: {
          filter: { class: classId },
          update: { $setOnInsert: { ...timetable, class: classId, revision: 1, updatedAt: now, updatedBy: null } },
          upsert: true,
        },
      })));
    })().catch((error) => {
      initialized.delete(db);
      throw error;
    });
    initialized.set(db, task);
  }
  return task;
}

export async function listTimetableClasses(db: Db) {
  await initializeTimetables(db);
  const [studentClasses, savedClasses] = await Promise.all([
    db.collection(STUDENTS_COLLECTION).distinct("class"),
    collection(db).distinct("class"),
  ]);
  const classes = new Map<string, string>();
  for (const label of [...ALL_CLASSES, ...studentClasses, ...savedClasses]) {
    if (typeof label !== "string" || !label.trim()) continue;
    const id = normalizeClass(label);
    if (id && !classes.has(id)) classes.set(id, /^\d+$/.test(label) ? `Class ${label}` : label.trim());
  }
  return [...classes].map(([id, label]) => ({ id, label }))
    .sort((a, b) => getClassSortRank(a.id) - getClassSortRank(b.id) || a.label.localeCompare(b.label));
}

function toView(doc: TimetableDocument): TimetableView {
  const { class: classId, layout, isPublished, revision, updatedAt } = doc;
  const metadata = { class: classId, isPublished, revision: revision ?? 0, updatedAt: updatedAt?.toISOString() ?? null };
  return layout === "single_subject" ? { ...metadata, layout, days: doc.days } : { ...metadata, layout, days: doc.days };
}

async function findClassTimetable(db: Db, classId: string) {
  const timetables = collection(db);
  const canonical = await timetables.findOne({ class: classId });
  if (canonical) return canonical;
  const existing = (await timetables.distinct("class")).find((label) => normalizeClass(label) === classId);
  return existing ? timetables.findOne({ class: existing }) : null;
}

export async function getTimetable(db: Db, classId: string, publishedOnly = false) {
  await initializeTimetables(db);
  const doc = await findClassTimetable(db, classId);
  return doc && (!publishedOnly || doc.isPublished === true) ? toView(doc) : null;
}

export async function saveTimetable(db: Db, classId: string, timetable: TimetableData, revision: number | null, adminId: string) {
  await initializeTimetables(db);
  const timetables = collection(db);
  const fields = { ...timetable, updatedAt: new Date(), updatedBy: adminId };
  const current = await findClassTimetable(db, classId);
  if (revision === null) {
    if (current) return null;
    const doc = { class: classId, ...fields, revision: 1 };
    try {
      await timetables.insertOne(doc);
      return toView(doc);
    } catch (error) {
      if (error instanceof MongoServerError && error.code === 11000) return null;
      throw error;
    }
  }
  if (!current) return null;
  const doc = await timetables.findOneAndUpdate(
    { class: current.class, ...(revision === 0 ? { $or: [{ revision: 0 }, { revision: { $exists: false } }] } : { revision }) },
    { $set: fields, $inc: { revision: 1 } }, { returnDocument: "after" }
  );
  return doc ? toView(doc) : null;
}

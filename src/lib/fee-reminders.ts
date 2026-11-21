import { createHash } from "node:crypto";
import { MongoServerError, type Db } from "mongodb";
import { invalidateParentPushToken } from "@/lib/announcements";
import { getKolkataToday } from "@/lib/date";
import {
  DEFAULT_REMINDER_SETTINGS, FEE_REMINDER_SETTINGS_ID, feeReminderSettingsSchema, isReminderDay,
  type ReminderSettings, type ReminderSettingsInput,
} from "@/lib/fee-reminder-config";
import { getEligibleReminderParents, getReminderTokens } from "@/lib/fee-reminder-recipients";
import { chunkArray, getFcmStatus, sendFcmToTokens } from "@/lib/fcm";

type ExecutionInput =
  | { type: "scheduled" }
  | { type: "manual"; requestId: string; adminId: string }
  | { type: "test"; requestId: string; adminId: string; parentId: string };

interface Execution {
  _id: string;
  type: ExecutionInput["type"];
  requestedBy?: string;
  targetParent?: string;
  eligibleParentIds?: string[];
  scheduledAt: Date | null;
  startedAt: Date;
  calendarDate: string;
  leaseUntil: Date;
  status: "running" | "completed" | "partial" | "skipped" | "failed" | "interrupted";
  eligible: number;
  resumable?: boolean;
  error?: string;
}

interface ParentAttempt {
  _id: string;
  executionId: string;
  parentId: string;
  manualOccurrence?: string;
  status: "sending" | "checked" | "skipped";
  attempted: number;
  accepted: number;
  failed: number;
  uncertain: number;
  errors?: string[];
}

const durableWrites = { writeConcern: { w: "majority" as const }, readPreference: "primary" as const };
const settingsCollection = (db: Db) =>
  db.collection<ReminderSettings & { _id: string }>("settings", durableWrites);
const executions = (db: Db) => db.collection<Execution>("fee_reminder_executions", durableWrites);
const attempts = (db: Db) => db.collection<ParentAttempt>("fee_reminder_attempts", durableWrites);

export async function loadReminderSettings(db: Db): Promise<ReminderSettings> {
  const doc = await settingsCollection(db).findOne({ _id: FEE_REMINDER_SETTINGS_ID });
  if (!doc) return DEFAULT_REMINDER_SETTINGS;
  const { enabled, frequency, title, messageTemplate, scheduleAnchorDate } = doc;
  const settings = feeReminderSettingsSchema.parse({ enabled, frequency, title, messageTemplate });
  return { ...settings, scheduleAnchorDate, timezone: "Asia/Kolkata" };
}

export async function saveReminderSettings(db: Db, settings: ReminderSettingsInput, adminId: string) {
  const anchor = settings.enabled ? getKolkataToday() : null;
  await settingsCollection(db).updateOne({ _id: FEE_REMINDER_SETTINGS_ID }, [{
    $set: {
      key: FEE_REMINDER_SETTINGS_ID,
      timezone: "Asia/Kolkata",
      ...Object.fromEntries(Object.entries(settings).map(([key, value]) => [key, { $literal: value }])),
      scheduleAnchorDate: {
        $cond: [
          { $eq: ["$frequency", settings.frequency] },
          { $ifNull: ["$scheduleAnchorDate", anchor] },
          anchor,
        ],
      },
      updatedAt: "$$NOW",
      updatedBy: { $literal: adminId },
    },
  }], { upsert: true });
  return loadReminderSettings(db);
}

export async function previewReminders(db: Db) {
  const settings = await loadReminderSettings(db);
  const parents = await getEligibleReminderParents(db, settings);
  const tokens = await getReminderTokens(db, parents.map((parent) => parent.parentId));
  const fees = new Map(parents.flatMap((parent) => parent.students.flatMap((student) =>
    student.months.map((month) => [`${student.studentId}:${month.year}:${month.month}`, month.amount] as const)
  )));
  return {
    title: settings.title,
    totalEligible: parents.length,
    totalOutstanding: [...fees.values()].reduce((sum, amount) => sum + amount, 0),
    parents: parents.map((parent) => ({ ...parent, deviceCount: tokens.get(parent.parentId)?.length ?? 0 })),
  };
}

function duplicateKey(error: unknown) {
  return error instanceof MongoServerError && error.code === 11000;
}

async function summarize(db: Db, run: Execution) {
  // Attempt IDs start with the execution ID. Use the built-in _id index for the range.
  const rows = await attempts(db).find({
    _id: { $gte: `${run._id}/`, $lt: `${run._id}0` },
  }).toArray();
  const totals = rows.reduce((counts, row) => ({
    attempted: counts.attempted + row.attempted,
    accepted: counts.accepted + row.accepted,
    failed: counts.failed + row.failed,
    uncertain: counts.uncertain + (row.status === "sending" ? row.attempted - row.accepted - row.failed : row.uncertain),
    skipped: counts.skipped + Number(row.status === "skipped"),
  }), { attempted: 0, accepted: 0, failed: 0, uncertain: 0, skipped: 0 });
  const expired = run.status === "running" && run.leaseUntil.getTime() <= Date.now();
  return {
    id: run._id,
    type: run.type,
    scheduledAt: run.scheduledAt,
    startedAt: run.startedAt,
    status: expired ? "interrupted" as const : run.status,
    resumable: expired || Boolean(run.resumable),
    eligible: run.eligible,
    unprocessed: Math.max(0, run.eligible - rows.length),
    ...totals,
    error: expired ? "Execution stopped before recording a final result. Uncertain sends are protected from replay." : run.error,
    errorCodes: [...new Set(rows.flatMap((row) => row.errors ?? []))],
  };
}

export async function getReminderHistory(db: Db) {
  const rows = await executions(db).find().sort({ startedAt: -1 }).limit(30).toArray();
  return Promise.all(rows.map((row) => summarize(db, row)));
}

async function sendParentReminder(db: Db, run: Execution, settings: ReminderSettings, parentId: string) {
  const id = `${run._id}/${parentId}`;
  if (await attempts(db).findOne({ _id: id }, { projection: { _id: 1 } })) return;
  const tokens = (await getReminderTokens(db, [parentId])).get(parentId) ?? [];
  // This reads current parent/student state and payments immediately before claiming the send.
  const [parent] = await getEligibleReminderParents(db, settings, parentId);
  const attempt: ParentAttempt = {
    _id: id, executionId: run._id, parentId,
    status: parent && tokens.length ? "sending" : "skipped",
    ...(run.type === "manual" && parent && tokens.length
      ? { manualOccurrence: `${run.calendarDate}/${parentId}` } : {}),
    attempted: 0,
    accepted: 0, failed: 0, uncertain: 0,
    errors: !parent ? ["NO_OUTSTANDING_FEES"] : !tokens.length ? ["NO_ACTIVE_DEVICES"] : [],
  };
  try {
    await attempts(db).insertOne(attempt);
  } catch (error) {
    if (!duplicateKey(error)) throw error;
    if (attempt.manualOccurrence) {
      const { manualOccurrence: _manualOccurrence, ...skipped } = attempt;
      await attempts(db).updateOne({ _id: id }, {
        $setOnInsert: { ...skipped, status: "skipped", errors: ["MANUAL_REMINDER_ALREADY_CLAIMED_TODAY"] },
      }, { upsert: true });
    }
    return;
  }
  if (!parent || !tokens.length) return;

  for (const batch of chunkArray(tokens, 500)) {
    attempt.attempted += batch.length;
    await attempts(db).updateOne({ _id: id }, { $set: { attempted: attempt.attempted } });
    const result = await sendFcmToTokens({
      tokens: batch, title: settings.title, body: parent.body,
      data: { type: "FEE_REMINDER", screen: "fees", reminderId: run._id },
      retryOnMulticastError: false,
    });
    const accepted = result.results.filter((item) => item.ok).length;
    attempt.accepted += accepted;
    attempt.failed += result.results.length - accepted;
    attempt.uncertain += batch.length - result.results.length;
    for (const item of result.results) {
      if (item.errorCode) attempt.errors?.push(item.errorCode);
    }
    await attempts(db).updateOne({ _id: id }, { $set: {
      accepted: attempt.accepted, failed: attempt.failed,
      uncertain: attempt.uncertain, errors: [...new Set(attempt.errors)],
    } });
    await Promise.all(result.results.filter((item) => item.invalidToken).map((item) =>
      invalidateParentPushToken(db, item.token, item.errorCode ?? "invalid_token", parentId)
        .catch(() => { attempt.errors?.push("TOKEN_CLEANUP_FAILED"); })
    ));
  }
  await attempts(db).updateOne({ _id: id }, { $set: {
    status: "checked", accepted: attempt.accepted, failed: attempt.failed,
    uncertain: attempt.uncertain, errors: [...new Set(attempt.errors)],
  } });
}

export async function executeFeeReminders(db: Db, input: ExecutionInput) {
  const startedAt = new Date();
  const date = getKolkataToday();
  const settings = await loadReminderSettings(db);
  const scheduled = input.type === "scheduled";
  const reason = scheduled && (!settings.enabled || !isReminderDay(settings, date))
    ? settings.enabled ? "Frequency does not include this Kolkata date." : "Automatic reminders are disabled."
    : undefined;
  const executionId = scheduled
    ? `scheduled-${date}${reason ? "-skipped" : ""}`
    : `${input.type}-${createHash("sha256").update(JSON.stringify([input.adminId, input.requestId])).digest("hex")}`;
  const run: Execution = {
    _id: executionId,
    type: input.type,
    ...(!scheduled ? { requestedBy: input.adminId } : {}),
    ...(input.type === "test" ? { targetParent: input.parentId } : {}),
    scheduledAt: scheduled ? new Date(`${date}T18:00:00+05:30`) : null,
    startedAt,
    calendarDate: date,
    // Greater than the 300-second function limit. A timed-out worker cannot still send after takeover.
    leaseUntil: new Date(startedAt.getTime() + 330_000),
    status: reason ? "skipped" : "running",
    eligible: 0,
    ...(reason ? { error: reason } : {}),
  };

  try {
    await executions(db).insertOne(run);
  } catch (error) {
    if (!duplicateKey(error)) throw error;
    const existing = await executions(db).findOne({ _id: run._id });
    if (!existing) throw error;
    if (existing.targetParent !== run.targetParent) return null;
    const claimed = (existing.status === "running" || existing.resumable) && existing.leaseUntil <= startedAt
      ? await executions(db).updateOne(
        { _id: run._id, status: existing.status, leaseUntil: existing.leaseUntil },
        { $set: { status: "running", leaseUntil: run.leaseUntil, resumable: false } }
      )
      : null;
    if (!claimed?.modifiedCount) return summarize(db, existing);
    run.startedAt = existing.startedAt;
    run.calendarDate = existing.calendarDate;
    run.eligible = existing.eligible;
    run.eligibleParentIds = existing.eligibleParentIds;
  }
  if (reason) return summarize(db, run);

  let status: Execution["status"] = "completed";
  let detail: string | undefined;
  let resumable = false;
  try {
    if (input.type === "manual") {
      await attempts(db).createIndex({ manualOccurrence: 1 }, { unique: true, sparse: true });
    }
    if (!run.eligibleParentIds) {
      const parents = await getEligibleReminderParents(db, settings, run.targetParent);
      run.eligibleParentIds = parents.map((parent) => parent.parentId);
      run.eligible = parents.length;
      await executions(db).updateOne({ _id: run._id, leaseUntil: run.leaseUntil }, {
        $set: { eligible: run.eligible, eligibleParentIds: run.eligibleParentIds },
      });
    }

    if (input.type === "test" && !run.eligible) {
      status = "skipped";
      detail = "This parent no longer has eligible outstanding fees.";
    } else if (run.eligible && !getFcmStatus().ready) {
      status = "failed";
      detail = "Firebase Cloud Messaging is unavailable. Check the server configuration.";
    } else {
      for (const batch of chunkArray(run.eligibleParentIds, 8)) {
        if (Date.now() - startedAt.getTime() > 245_000) {
          status = "partial";
          detail = "The function reached its processing budget. Remaining parents were not processed.";
          resumable = true;
          break;
        }
        if (scheduled && !(await loadReminderSettings(db)).enabled) {
          status = "partial";
          detail = "Automatic reminders were disabled during execution.";
          break;
        }
        const results = await Promise.allSettled(batch.map((parentId) =>
          sendParentReminder(db, run, settings, parentId)
        ));
        if (results.some((result) => result.status === "rejected")) {
          status = "partial";
          detail = "Some parent sends could not be processed or recorded. Uncertain sends will not be repeated.";
        }
      }
    }
  } catch (error) {
    console.error("Fee reminder execution failed", run._id, error);
    status = "failed";
    detail = "The execution failed. Review server logs using the execution ID.";
  }

  const summary = await summarize(db, run);
  if (status === "completed" && (summary.failed || summary.uncertain || summary.unprocessed)) status = "partial";
  if (status === "completed" && input.type === "test" && summary.skipped) status = "skipped";
  const recorded = await executions(db).updateOne({ _id: run._id, leaseUntil: run.leaseUntil }, { $set: {
    status, error: detail ?? "", resumable, ...(resumable ? { leaseUntil: new Date() } : {}),
  } });
  if (!recorded.matchedCount) {
    const current = await executions(db).findOne({ _id: run._id });
    if (current) return summarize(db, current);
  }
  return { ...summary, status, resumable, error: detail };
}

export type ReminderPreview = Awaited<ReturnType<typeof previewReminders>>;
export type ReminderExecutionSummary = Awaited<ReturnType<typeof summarize>>;

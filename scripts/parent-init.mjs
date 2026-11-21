#!/usr/bin/env node
/**
 * One-time parent account initialization for SK Tutorials.
 *
 * Default mode is a read-only dry run. No database writes happen unless
 * `--apply` is passed explicitly.
 *
 *   node scripts/parent-init.mjs
 *   node scripts/parent-init.mjs --apply
 *   node scripts/parent-init.mjs --apply --canonical-parent=9999999999=Parent Name
 *
 * Existing parent accounts are never deleted and their passwordHash is
 * never overwritten. Plain-text passwords are only written to the private
 * credentials register, never to stdout or the database.
 */

import { randomInt } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import bcrypt from "bcryptjs";
import { MongoClient } from "mongodb";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(SCRIPT_DIR, "..");
const PRIVATE_DIR = resolve(ROOT, "private");
const REGISTER_PATH = resolve(PRIVATE_DIR, "parent-credentials.local.json");
const DRY_RUN_REPORT_PATH = resolve(PRIVATE_DIR, "parent-init-dry-run.json");
const APPLY_REPORT_PATH = resolve(PRIVATE_DIR, "parent-init-apply-report.json");

const PARENTS_COLLECTION = "parents";
const STUDENTS_COLLECTION = "students";
const BCRYPT_ROUNDS = 10;
const PASSWORD_LENGTH = 10;
// Deliberately excludes O, 0, I and l to avoid ambiguous characters.
const PASSWORD_CHARSET =
  "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

export function loadEnvFile(filePath = resolve(ROOT, ".env.local")) {
  if (!existsSync(filePath)) return;

  const content = readFileSync(filePath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const separator = line.indexOf("=");
    if (separator === -1) continue;

    const key = line.slice(0, separator).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;

    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

export function assertSafeDatabase(env = process.env) {
  const errors = [];
  const appEnv = String(env.APP_ENV ?? "").trim();
  const mongodbUri = String(env.MONGODB_URI ?? "").trim();
  const mongodbDb = String(env.MONGODB_DB ?? "").trim();
  const productionDbName = String(env.PRODUCTION_DB_NAME ?? "").trim();
  const allowProductionDb =
    String(env.ALLOW_PRODUCTION_DB ?? "").trim().toLowerCase() === "true";
  const validAppEnvs = ["development", "test", "staging", "production"];

  if (!validAppEnvs.includes(appEnv)) {
    errors.push("APP_ENV must be one of: development, test, staging, production.");
  }
  if (!mongodbUri) {
    errors.push("MONGODB_URI is required.");
  } else if (
    !mongodbUri.startsWith("mongodb://") &&
    !mongodbUri.startsWith("mongodb+srv://")
  ) {
    errors.push("MONGODB_URI must start with mongodb:// or mongodb+srv://.");
  }
  if (!mongodbDb) {
    errors.push("MONGODB_DB is required.");
  }
  if (!productionDbName) {
    errors.push("PRODUCTION_DB_NAME is required.");
  }

  if (appEnv === "production") {
    if (!allowProductionDb) {
      errors.push("ALLOW_PRODUCTION_DB must be exactly true when APP_ENV=production.");
    }
    if (productionDbName && mongodbDb && mongodbDb !== productionDbName) {
      errors.push("MONGODB_DB must match PRODUCTION_DB_NAME when APP_ENV=production.");
    }
  } else {
    if (allowProductionDb) {
      errors.push("ALLOW_PRODUCTION_DB must not be true unless APP_ENV=production.");
    }
    if (productionDbName && mongodbDb && mongodbDb === productionDbName) {
      errors.push("Refusing to use the production database outside APP_ENV=production.");
    }
  }

  if (errors.length > 0) {
    throw new Error(`Database guard failed:\n- ${errors.join("\n- ")}`);
  }

  return mongodbDb;
}

export function normalizeMobile(value) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/\s+/g, "").trim();
}

export function isValidMobile(value) {
  return /^[0-9]{10}$/.test(normalizeMobile(value));
}

export function normalizeParentName(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

export function parentNameKey(value) {
  return normalizeParentName(value).toLowerCase();
}

export function generateInitialPassword(length = PASSWORD_LENGTH) {
  let password = "";
  for (let index = 0; index < length; index += 1) {
    password += PASSWORD_CHARSET[randomInt(PASSWORD_CHARSET.length)];
  }
  return password;
}

export function maskMobile(value) {
  const mobile = normalizeMobile(value);
  if (!mobile) return "(missing)";
  if (mobile.length <= 4) return "*".repeat(mobile.length);
  return `${mobile.slice(0, 3)}${"*".repeat(mobile.length - 5)}${mobile.slice(-2)}`;
}

export function parseCanonicalParentOverrides(args = process.argv.slice(2)) {
  const overrides = new Map();

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    let value = null;

    if (argument.startsWith("--canonical-parent=")) {
      value = argument.slice("--canonical-parent=".length);
    } else if (argument === "--canonical-parent") {
      value = args[index + 1];
      index += 1;
    }

    if (value === null) continue;
    if (!value) {
      throw new Error("--canonical-parent requires MOBILE=NAME.");
    }

    const separator = value.indexOf("=");
    if (separator === -1) {
      throw new Error("--canonical-parent must use MOBILE=NAME.");
    }

    const parentMobile = normalizeMobile(value.slice(0, separator));
    const parentName = normalizeParentName(value.slice(separator + 1));
    if (!isValidMobile(parentMobile)) {
      throw new Error(
        `--canonical-parent has an invalid mobile: ${maskMobile(parentMobile)}`
      );
    }
    if (!parentName) {
      throw new Error(
        `--canonical-parent has an empty name for ${maskMobile(parentMobile)}.`
      );
    }

    overrides.set(parentMobile, parentName);
  }

  return overrides;
}

export function applyCanonicalParentNameOverrides(
  groups,
  overrides = new Map()
) {
  if (overrides.size === 0) return;

  for (const group of groups) {
    const parentName = overrides.get(group.parentMobile);
    if (!parentName) continue;

    group.nameVariants = new Map([
      [
        parentName.toLowerCase(),
        { name: parentName, count: group.students.length },
      ],
    ]);
  }
}

/**
 * Groups active students by normalized parent mobile and records every
 * student that cannot be safely linked to a parent account.
 */
export function buildGroups(activeStudents) {
  const groups = new Map();
  const invalidMobileStudents = [];
  const missingStudentIdStudents = [];
  const missingParentNameStudents = [];

  for (const raw of activeStudents) {
    const studentId = String(raw.studentId ?? "").trim();
    const studentName = String(raw.name ?? "").trim();
    const className = String(raw.class ?? "").trim();
    const parentName = normalizeParentName(raw.parentName);
    const parentMobile = normalizeMobile(raw.parentMobile);

    if (!studentId) {
      missingStudentIdStudents.push({
        studentName,
        class: className,
        parentName,
        parentMobile,
        reason: "missing-student-id",
      });
      continue;
    }

    if (!isValidMobile(parentMobile)) {
      invalidMobileStudents.push({
        studentId,
        studentName,
        class: className,
        parentName,
        parentMobileRaw: raw.parentMobile ?? null,
        reason: parentMobile ? "invalid-mobile" : "missing-mobile",
      });
      continue;
    }

    if (!parentName) {
      missingParentNameStudents.push({
        studentId,
        studentName,
        class: className,
        parentMobile,
      });
    }

    let group = groups.get(parentMobile);
    if (!group) {
      group = { parentMobile, students: [], nameVariants: new Map() };
      groups.set(parentMobile, group);
    }

    group.students.push({
      studentId,
      studentName,
      class: className,
      parentName,
      parentMobile,
    });

    if (parentName) {
      const key = parentName.toLowerCase();
      const current = group.nameVariants.get(key);
      if (current) current.count += 1;
      else group.nameVariants.set(key, { name: parentName, count: 1 });
    }
  }

  return {
    groups: [...groups.values()],
    invalidMobileStudents,
    missingStudentIdStudents,
    missingParentNameStudents,
  };
}

/**
 * Builds the initialization plan without touching MongoDB.
 */
export function buildPlan(groups, existingParentDocs = []) {
  const existingByMobile = new Map();
  const duplicateExistingParents = [];
  const invalidExistingParents = [];

  for (const doc of existingParentDocs) {
    const mobile = normalizeMobile(doc.parentMobile);
    if (!isValidMobile(mobile)) {
      invalidExistingParents.push({
        parentMobileRaw: doc.parentMobile ?? null,
        parentName: normalizeParentName(doc.parentName),
        reason: "invalid-stored-parent-mobile",
      });
      continue;
    }

    if (existingByMobile.has(mobile)) {
      duplicateExistingParents.push(mobile);
    } else {
      existingByMobile.set(mobile, doc);
    }
  }

  const duplicateSet = new Set(duplicateExistingParents);
  const newAccounts = [];
  const existingUpdates = [];
  const conflicts = [];
  const skippedGroups = [];

  for (const group of groups) {
    const variants = [...group.nameVariants.values()].sort(
      (left, right) =>
        right.count - left.count || left.name.localeCompare(right.name)
    );
    const studentIds = group.students.map((student) => student.studentId);
    const base = {
      parentMobile: group.parentMobile,
      studentIds,
      students: group.students,
    };

    if (variants.length === 0) {
      skippedGroups.push({ ...base, reason: "missing-parent-name" });
      continue;
    }

    if (variants.length > 1) {
      conflicts.push({
        ...base,
        reason: "conflicting-parent-names",
        parentNames: variants.map((variant) => variant.name),
      });
      continue;
    }

    if (duplicateSet.has(group.parentMobile)) {
      conflicts.push({
        ...base,
        reason: "duplicate-existing-parent-records",
      });
      continue;
    }

    const parentName = variants[0].name;
    const existing = existingByMobile.get(group.parentMobile) || null;

    if (existing) {
      const existingName = normalizeParentName(existing.parentName);
      if (existingName && existingName.toLowerCase() !== parentName.toLowerCase()) {
        conflicts.push({
          ...base,
          reason: "existing-parent-name-mismatch",
          existingParentName: existingName,
        });
        continue;
      }
    }

    const currentLinkedStudentIds = Array.isArray(existing?.linkedStudentIds)
      ? [...new Set(existing.linkedStudentIds.map((id) => String(id)).filter(Boolean))]
      : [];
    const linkedStudentIds = [
      ...new Set([...currentLinkedStudentIds, ...studentIds]),
    ].sort();
    const addedStudentIds = studentIds.filter(
      (studentId) => !currentLinkedStudentIds.includes(studentId)
    );

    const planned = {
      parentMobile: group.parentMobile,
      parentName:
        (existing && normalizeParentName(existing.parentName)) || parentName,
      students: group.students,
      currentLinkedStudentIds,
      linkedStudentIds,
      addedStudentIds,
      existing: existing
        ? {
            isActive: existing.isActive,
            hasPasswordHash: Boolean(existing.hasPasswordHash),
            parentName: normalizeParentName(existing.parentName),
          }
        : null,
    };

    if (existing) existingUpdates.push(planned);
    else newAccounts.push(planned);
  }

  return {
    newAccounts,
    existingUpdates,
    conflicts,
    skippedGroups,
    duplicateExistingParents: [...new Set(duplicateExistingParents)],
    invalidExistingParents,
    existingByMobile,
  };
}

function studentForReport(student) {
  return {
    studentId: student.studentId,
    studentName: student.studentName,
    class: student.class,
  };
}

function buildReport({
  mode,
  appEnv,
  database,
  parentsCollectionExists,
  allStudents,
  activeStudents,
  existingParentDocs,
  groupsResult,
  plan,
  canonicalParentOverrides = new Map(),
}) {
  const { groups, invalidMobileStudents, missingStudentIdStudents, missingParentNameStudents } =
    groupsResult;
  const siblingGroups = groups.filter((group) => group.students.length > 1);
  const conflictStudentIds = plan.conflicts.flatMap(
    (conflict) => conflict.studentIds
  );
  const skippedGroupStudentIds = plan.skippedGroups.flatMap(
    (group) => group.studentIds
  );
  const invalidStudentIds = invalidMobileStudents.map(
    (student) => student.studentId
  );
  const missingIdStudentKeys = missingStudentIdStudents.map(
    (student) => `missing-id:${student.studentName}:${student.class}`
  );
  const manualReviewStudentKeys = new Set([
    ...conflictStudentIds,
    ...skippedGroupStudentIds,
    ...invalidStudentIds,
    ...missingIdStudentKeys,
  ]);
  const groupsByMobile = new Map(
    groups.map((group) => [group.parentMobile, group])
  );
  const unmatchedExistingParents = existingParentDocs.filter(
    (doc) => !groupsByMobile.has(normalizeMobile(doc.parentMobile))
  );

  return {
    generatedAt: new Date().toISOString(),
    mode,
    environment: { appEnv, database, parentsCollectionExists },
    totals: {
      totalStudentsInCollection: allStudents.length,
      totalActiveStudents: activeStudents.length,
      activeStudentsWithValidMobile: groups.reduce(
        (total, group) => total + group.students.length,
        0
      ),
      activeStudentsWithInvalidOrMissingMobile: invalidMobileStudents.length,
      activeStudentsMissingStudentId: missingStudentIdStudents.length,
      uniqueValidParentMobiles: groups.length,
      siblingGroups: siblingGroups.length,
      siblingStudents: siblingGroups.reduce(
        (total, group) => total + group.students.length,
        0
      ),
      expectedNewParentAccounts: plan.newAccounts.length,
      existingParentAccounts: existingParentDocs.length,
      existingParentsMatchedToActiveStudents: plan.existingUpdates.length,
      existingParentsNotMatched: unmatchedExistingParents.length,
      conflictGroups: plan.conflicts.length,
      groupsSkipped: plan.skippedGroups.length,
      recordsRequiringManualReview:
        plan.conflicts.length +
        plan.skippedGroups.length +
        plan.invalidExistingParents.length +
        invalidMobileStudents.length +
        missingStudentIdStudents.length,
      studentsRequiringManualReview: manualReviewStudentKeys.size,
      studentsSkipped:
        invalidStudentIds.length +
        skippedGroupStudentIds.length +
        conflictStudentIds.length,
      invalidExistingParents: plan.invalidExistingParents.length,
      duplicateExistingParentMobiles: plan.duplicateExistingParents.length,
    },
    newParentAccounts: plan.newAccounts.map((account) => ({
      parentMobile: account.parentMobile,
      parentName: account.parentName,
      linkedStudentIds: account.linkedStudentIds,
      students: account.students.map(studentForReport),
    })),
    existingParentUpdates: plan.existingUpdates.map((account) => ({
      parentMobile: account.parentMobile,
      parentName: account.parentName,
      existing: account.existing,
      existingLinkedStudentIds: account.currentLinkedStudentIds,
      linkedStudentIds: account.linkedStudentIds,
      addedStudentIds: account.addedStudentIds,
      students: account.students.map(studentForReport),
    })),
    siblingGroups: siblingGroups.map((group) => ({
      parentMobile: group.parentMobile,
      parentNames: [...group.nameVariants.values()].map((variant) => variant.name),
      students: group.students.map(studentForReport),
    })),
    invalidMobileStudents: invalidMobileStudents.map((student) => ({
      ...student,
      parentMobile: maskMobile(student.parentMobileRaw),
    })),
    missingStudentIdStudents,
    missingParentNameStudents,
    conflicts: plan.conflicts.map((conflict) => ({
      parentMobile: conflict.parentMobile,
      reason: conflict.reason,
      parentNames: conflict.parentNames ?? null,
      existingParentName: conflict.existingParentName ?? null,
      students: conflict.students.map(studentForReport),
    })),
    skippedGroups: plan.skippedGroups.map((group) => ({
      parentMobile: group.parentMobile,
      reason: group.reason,
      students: group.students.map(studentForReport),
    })),
    invalidExistingParents: plan.invalidExistingParents,
    duplicateExistingParentMobiles: plan.duplicateExistingParents,
    canonicalParentNameOverrides: [...canonicalParentOverrides.entries()].map(
      ([parentMobile, parentName]) => ({ parentMobile, parentName })
    ),
    notes: [
      "Dry-run report only. No database writes were performed.",
      "Full parent mobile numbers are stored in this private report file.",
      "Plain-text passwords are never written to this report.",
    ],
  };
}

function writeJson(filePath, value, mode = 0o600) {
  mkdirSync(dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { mode });
  renameSync(temporaryPath, filePath);
}

function loadRegister() {
  if (!existsSync(REGISTER_PATH)) return [];
  const content = readFileSync(REGISTER_PATH, "utf8").trim();
  if (!content) return [];

  const parsed = JSON.parse(content);
  if (!Array.isArray(parsed)) {
    throw new Error(
      "private/parent-credentials.local.json must contain a JSON array."
    );
  }
  return parsed;
}

function printDryRunSummary(report) {
  const totals = report.totals;
  console.log("SK Tutorials parent initialization — DRY RUN (no writes)");
  console.log(`Database: ${report.environment.database} (${report.environment.appEnv})`);
  console.log(`Parents collection exists: ${report.environment.parentsCollectionExists}`);
  console.log("");
  console.log(`Total students in collection:        ${totals.totalStudentsInCollection}`);
  console.log(`Active students:                     ${totals.totalActiveStudents}`);
  console.log(`Active students with valid mobile:   ${totals.activeStudentsWithValidMobile}`);
  console.log(`Unique valid parent mobile numbers:  ${totals.uniqueValidParentMobiles}`);
  console.log(`Sibling groups:                      ${totals.siblingGroups}`);
  console.log(`Expected new parent accounts:        ${totals.expectedNewParentAccounts}`);
  console.log(`Existing parent accounts:            ${totals.existingParentAccounts}`);
  console.log(`Existing parents to update:          ${totals.existingParentsMatchedToActiveStudents}`);
  console.log(`Invalid/missing mobile students:     ${totals.activeStudentsWithInvalidOrMissingMobile}`);
  console.log(`Conflict groups:                     ${totals.conflictGroups}`);
  console.log(`Groups skipped:                      ${totals.groupsSkipped}`);
  console.log(`Records requiring manual review:     ${totals.recordsRequiringManualReview}`);
  console.log("");
  console.log("New parent accounts:");
  for (const account of report.newParentAccounts) {
    const students = account.students
      .map((student) => `${student.studentId} (${student.studentName})`)
      .join(", ");
    console.log(
      `- ${account.parentName} | ${maskMobile(account.parentMobile)} | ${students}`
    );
  }
  if (report.newParentAccounts.length === 0) console.log("- none");

  console.log("");
  console.log("Sibling groups:");
  for (const group of report.siblingGroups) {
    const students = group.students
      .map((student) => `${student.studentId} (${student.studentName})`)
      .join(", ");
    console.log(`- ${maskMobile(group.parentMobile)} | ${students}`);
  }
  if (report.siblingGroups.length === 0) console.log("- none");

  if (report.invalidMobileStudents.length > 0) {
    console.log("");
    console.log("Invalid/missing mobile exceptions:");
    for (const student of report.invalidMobileStudents) {
      console.log(
        `- ${student.studentId} ${student.studentName} | ${student.parentName} | ${student.parentMobile} (${student.reason})`
      );
    }
  }

  if (report.conflicts.length > 0) {
    console.log("");
    console.log("Conflicts requiring manual review:");
    for (const conflict of report.conflicts) {
      console.log(
        `- ${maskMobile(conflict.parentMobile)} | ${conflict.reason} | ${conflict.students
          .map((student) => `${student.studentId} ${student.studentName}`)
          .join(", ")}`
      );
    }
  }

  console.log("");
  console.log(`Full dry-run report: ${DRY_RUN_REPORT_PATH}`);
}

function printApplySummary(summary) {
  console.log("SK Tutorials parent initialization — APPLY COMPLETE");
  console.log(`Database: ${summary.database} (${summary.appEnv})`);
  console.log("");
  console.log(`Active students scanned:             ${summary.totalActiveStudents}`);
  console.log(`Unique parent accounts identified:   ${summary.uniqueParentAccounts}`);
  console.log(`New parent accounts created:         ${summary.created}`);
  console.log(`Existing parent accounts preserved:  ${summary.preserved}`);
  console.log(`Existing parents updated:            ${summary.updated}`);
  console.log(`Sibling groups identified:           ${summary.siblingGroups}`);
  console.log(`Invalid/missing mobile students:     ${summary.invalidStudents}`);
  console.log(`Records requiring manual review:     ${summary.manualReview}`);
  console.log(`Skipped accounts/groups:             ${summary.skipped}`);
  console.log("");
  console.log(`Credentials register: ${REGISTER_PATH}`);
  console.log(`Apply report:         ${APPLY_REPORT_PATH}`);
}

async function applyPlan(db, report, plan, parentsCollectionExists) {
  if (plan.duplicateExistingParents.length > 0) {
    throw new Error(
      "Duplicate parentMobile values exist in the parents collection. Fix them before applying."
    );
  }
  if (plan.invalidExistingParents.length > 0) {
    throw new Error(
      "The parents collection contains documents without a valid 10-digit parentMobile. Fix them before applying."
    );
  }

  if (!parentsCollectionExists) {
    await db.createCollection(PARENTS_COLLECTION);
  }
  await db
    .collection(PARENTS_COLLECTION)
    .createIndex(
      { parentMobile: 1 },
      { unique: true, name: "uniq_parentMobile" }
    );

  const register = loadRegister();
  const registerByMobile = new Map(
    register.map((entry) => [normalizeMobile(entry.parentMobile), entry])
  );
  const now = new Date();
  let created = 0;
  let preserved = 0;
  let updated = 0;
  let skipped = 0;
  const errors = [];

  for (const account of plan.newAccounts) {
    try {
      const registerEntry = registerByMobile.get(account.parentMobile);
      const password =
        registerEntry && typeof registerEntry.password === "string" && registerEntry.password
          ? registerEntry.password
          : generateInitialPassword(PASSWORD_LENGTH);
      const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

      const result = await db.collection(PARENTS_COLLECTION).updateOne(
        { parentMobile: account.parentMobile },
        {
          $setOnInsert: {
            parentMobile: account.parentMobile,
            parentName: account.parentName,
            passwordHash,
            isActive: true,
            createdAt: now,
          },
          $addToSet: {
            linkedStudentIds: { $each: account.linkedStudentIds },
          },
          $set: { updatedAt: now },
        },
        { upsert: true }
      );

      if (result.upsertedId) {
        created += 1;
        const entry = registerEntry || {};
        const students = account.students.map(studentForReport);
        registerByMobile.set(account.parentMobile, {
          ...entry,
          parentName: account.parentName,
          parentMobile: account.parentMobile,
          password,
          students,
          accountStatus: "Active",
          whatsappSent: entry.whatsappSent === true,
          createdAt: entry.createdAt || now.toISOString(),
        });
      } else {
        preserved += 1;
      }
    } catch (error) {
      skipped += 1;
      errors.push({
        parentMobile: maskMobile(account.parentMobile),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  for (const account of plan.existingUpdates) {
    try {
      const result = await db.collection(PARENTS_COLLECTION).updateOne(
        { parentMobile: account.parentMobile },
        {
          $addToSet: {
            linkedStudentIds: { $each: account.linkedStudentIds },
          },
          $set: { updatedAt: now },
        }
      );
      if (result.matchedCount > 0) {
        preserved += 1;
        updated += 1;
      } else {
        skipped += 1;
        errors.push({
          parentMobile: maskMobile(account.parentMobile),
          error: "Existing parent disappeared before update.",
        });
      }
    } catch (error) {
      skipped += 1;
      errors.push({
        parentMobile: maskMobile(account.parentMobile),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const registerEntries = [...registerByMobile.values()].sort((left, right) =>
    normalizeMobile(left.parentMobile).localeCompare(
      normalizeMobile(right.parentMobile)
    )
  );
  writeJson(REGISTER_PATH, registerEntries, 0o600);

  const summary = {
    generatedAt: now.toISOString(),
    mode: "apply",
    appEnv: report.environment.appEnv,
    database: report.environment.database,
    totalActiveStudents: report.totals.totalActiveStudents,
    uniqueParentAccounts:
      report.totals.expectedNewParentAccounts +
      report.totals.existingParentsMatchedToActiveStudents,
    created,
    preserved,
    updated,
    siblingGroups: report.totals.siblingGroups,
    invalidStudents: report.totals.activeStudentsWithInvalidOrMissingMobile,
    manualReview: report.totals.recordsRequiringManualReview,
    skipped,
    errors,
    registerPath: "private/parent-credentials.local.json",
    reportPath: "private/parent-init-apply-report.json",
  };

  writeJson(APPLY_REPORT_PATH, summary, 0o600);
  return summary;
}

async function main() {
  loadEnvFile();
  const apply = process.argv.includes("--apply");
  const canonicalParentOverrides = parseCanonicalParentOverrides(
    process.argv.slice(2)
  );
  const database = assertSafeDatabase(process.env);
  const uri = String(process.env.MONGODB_URI ?? "").trim();
  const appEnv = String(process.env.APP_ENV ?? "").trim();

  const client = new MongoClient(uri, {
    maxPoolSize: 5,
    serverSelectionTimeoutMS: 10000,
  });

  try {
    await client.connect();
    const db = client.db(database);
    const collections = await db
      .listCollections({}, { nameOnly: true })
      .toArray();
    const parentsCollectionExists = collections.some(
      (collection) => collection.name === PARENTS_COLLECTION
    );

    const allStudents = await db
      .collection(STUDENTS_COLLECTION)
      .find({})
      .project({
        studentId: 1,
        name: 1,
        class: 1,
        parentName: 1,
        parentMobile: 1,
        status: 1,
      })
      .toArray();
    const activeStudents = allStudents.filter(
      (student) =>
        String(student.status ?? "").trim().toLowerCase() === "active"
    );

    const existingParentDocs = parentsCollectionExists
      ? (
          await db
            .collection(PARENTS_COLLECTION)
            .find({})
            .project({
              parentMobile: 1,
              parentName: 1,
              linkedStudentIds: 1,
              isActive: 1,
              passwordHash: 1,
              createdAt: 1,
            })
            .toArray()
        ).map((parent) => ({
          parentMobile: parent.parentMobile,
          parentName: parent.parentName,
          linkedStudentIds: parent.linkedStudentIds,
          isActive: parent.isActive,
          hasPasswordHash: Boolean(parent.passwordHash),
          createdAt: parent.createdAt,
        }))
      : [];

    const groupsResult = buildGroups(activeStudents);
    applyCanonicalParentNameOverrides(
      groupsResult.groups,
      canonicalParentOverrides
    );
    const plan = buildPlan(groupsResult.groups, existingParentDocs);
    const report = buildReport({
      mode: apply ? "apply" : "dry-run",
      appEnv,
      database,
      parentsCollectionExists,
      allStudents,
      activeStudents,
      existingParentDocs,
      groupsResult,
      plan,
      canonicalParentOverrides,
    });

    if (!apply) {
      writeJson(DRY_RUN_REPORT_PATH, report, 0o600);
      printDryRunSummary(report);
      return;
    }

    if (report.conflicts.length > 0 || report.skippedGroups.length > 0) {
      throw new Error(
        "Manual-review items exist. Re-run the dry-run, resolve conflicts, and apply only after the report is clean."
      );
    }

    const summary = await applyPlan(
      db,
      report,
      plan,
      parentsCollectionExists
    );
    printApplySummary(summary);
  } finally {
    await client.close();
  }
}

const isMain =
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
  main().catch((error) => {
    console.error(
      `Parent initialization failed: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    process.exitCode = 1;
  });
}

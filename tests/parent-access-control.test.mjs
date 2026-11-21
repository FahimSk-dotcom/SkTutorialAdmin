import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ObjectId } from "mongodb";
import {
  getActiveLinkedStudents,
  parentAccessRestrictedBody,
  revokeParentSessionsForAffectedStudentsIfNoActive,
  revokeParentSessionsIfNoActiveLinkedStudents,
  studentInactiveBody,
  verifyParentStudentAccess,
} from "../src/lib/parent-auth.ts";

const readSource = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

function makeDb({ students = [], parents = [], sessions = [] } = {}) {
  const state = {
    students: students.map((s) => ({ ...s })),
    parents: parents.map((p) => ({ ...p })),
    sessions: sessions.map((s) => ({ ...s })),
  };

  function makeCursor(rows) {
    return {
      project() { return this; },
      sort() { return this; },
      async toArray() { return rows.map((r) => ({ ...r })); },
    };
  }

  function collection(name) {
    if (name === "students") {
      return {
        find(query, opts = {}) {
          const filter = (doc) => {
            if (query.studentId && typeof query.studentId === "object" && query.studentId.$in) {
              if (!query.studentId.$in.includes(doc.studentId)) return false;
            } else if (query.studentId !== undefined && doc.studentId !== query.studentId) {
              return false;
            }
            if (query.status !== undefined && doc.status !== query.status) return false;
            return true;
          };
          const projection = opts.projection || null;
          let rows = state.students.filter(filter).map((doc) => ({ ...doc }));
          if (projection) {
            rows = rows.map((doc) => {
              const out = {};
              for (const [k, v] of Object.entries(projection)) {
                if (v === 1 && k in doc) out[k] = doc[k];
              }
              if (projection._id === 0) delete out._id;
              return out;
            });
          }
          return makeCursor(rows);
        },
        async findOne(query) {
          if (query.studentId !== undefined) {
            const found = state.students.find((s) => s.studentId === query.studentId);
            return found ? { ...found } : null;
          }
          return null;
        },
      };
    }
    if (name === "parents") {
      return {
        find(query, opts = {}) {
          let rows = [...state.parents];
          if (query.linkedStudentIds) {
            if (typeof query.linkedStudentIds === "string") {
              rows = rows.filter((p) => Array.isArray(p.linkedStudentIds) && p.linkedStudentIds.includes(query.linkedStudentIds));
            } else if (query.linkedStudentIds.$in) {
              rows = rows.filter((p) => Array.isArray(p.linkedStudentIds) && p.linkedStudentIds.some((id) => query.linkedStudentIds.$in.includes(id)));
            }
          }
          if (opts.projection) {
            rows = rows.map((p) => {
              const out = {};
              for (const [k, v] of Object.entries(opts.projection)) if (v === 1) out[k] = p[k];
              return out;
            });
          }
          return makeCursor(rows);
        },
      };
    }
    if (name === "parent_sessions") {
      return {
        async updateMany(query, update) {
          let count = 0;
          for (const s of state.sessions) {
            if (query.parentId && s.parentId !== query.parentId) continue;
            if (Object.prototype.hasOwnProperty.call(query, "revokedAt") && s.revokedAt !== query.revokedAt) continue;
            if (update.$set) Object.assign(s, update.$set);
            count++;
          }
          return { modifiedCount: count };
        },
        async createIndex() { return "ok"; },
      };
    }
    throw new Error(`unexpected collection ${name}`);
  }

  return { collection, state };
}

const parentDoc = (overrides = {}) => ({
  _id: new ObjectId("507f1f77bcf86cd799439011"),
  parentName: "Parent One",
  parentMobile: "9876543210",
  isActive: true,
  linkedStudentIds: [],
  ...overrides,
});

test("1. active parent with one active student: only active linked student returned", async () => {
  const db = makeDb({
    students: [{ studentId: "SK-1", name: "A", class: "1", status: "Active" }],
  });
  const list = await getActiveLinkedStudents(db, ["SK-1"]);
  assert.equal(list.length, 1);
  assert.deepEqual(list[0], { studentId: "SK-1", name: "A", class: "1", status: "Active" });
});

test("2. active parent with multiple active students: all active linked students returned in linked order", async () => {
  const db = makeDb({
    students: [
      { studentId: "SK-2", name: "B", class: "2", status: "Active" },
      { studentId: "SK-1", name: "A", class: "1", status: "Active" },
      { studentId: "SK-3", name: "C", class: "3", status: "Active" },
    ],
  });
  const list = await getActiveLinkedStudents(db, ["SK-1", "SK-2", "SK-3"]);
  assert.deepEqual(list.map((s) => s.studentId), ["SK-1", "SK-2", "SK-3"]);
});

test("3. parent with one archived and one active student: only active sibling returned", async () => {
  const db = makeDb({
    students: [
      { studentId: "SK-ARCH", name: "Archived", class: "1", status: "Inactive" },
      { studentId: "SK-ACT", name: "Active", class: "2", status: "Active" },
    ],
  });
  const list = await getActiveLinkedStudents(db, ["SK-ARCH", "SK-ACT"]);
  assert.deepEqual(list.map((s) => s.studentId), ["SK-ACT"]);
});

test("4. parent with all students archived: no active students (restriction condition)", async () => {
  const db = makeDb({
    students: [
      { studentId: "SK-1", name: "A", class: "1", status: "Inactive" },
      { studentId: "SK-2", name: "B", class: "2", status: "Inactive" },
    ],
  });
  const list = await getActiveLinkedStudents(db, ["SK-1", "SK-2"]);
  assert.equal(list.length, 0);
  assert.deepEqual(
    parentAccessRestrictedBody({
      code: "PARENT_ACCESS_RESTRICTED",
      reason: "NO_ACTIVE_STUDENTS",
      message: "Your linked student account is currently inactive.",
    }),
    {
      success: false,
      code: "PARENT_ACCESS_RESTRICTED",
      reason: "NO_ACTIVE_STUDENTS",
      message: "Your linked student account is currently inactive.",
    }
  );
});

test("5. parent with a permanently deleted student: deleted student excluded, active sibling remains", async () => {
  const db = makeDb({
    students: [{ studentId: "SK-ACT", name: "Active", class: "2", status: "Active" }],
  });
  const list = await getActiveLinkedStudents(db, ["SK-DELETED", "SK-ACT"]);
  assert.deepEqual(list.map((s) => s.studentId), ["SK-ACT"]);
});

test("6. parent account disabled: exact restriction response body", () => {
  assert.deepEqual(
    parentAccessRestrictedBody({
      code: "PARENT_ACCESS_RESTRICTED",
      reason: "PARENT_ACCOUNT_INACTIVE",
      message: "Your parent account is currently inactive.",
    }),
    {
      success: false,
      code: "PARENT_ACCESS_RESTRICTED",
      reason: "PARENT_ACCOUNT_INACTIVE",
      message: "Your parent account is currently inactive.",
    }
  );
  const authSrc = readSource("../src/lib/parent-auth.ts");
  assert.match(authSrc, /isParentActive[\s\S]*PARENT_ACCOUNT_INACTIVE/);
  assert.match(authSrc, /revokeAllParentSessions/);
});

test("7. old session after account deactivation: auth layer revokes sessions and blocks inactive parent", () => {
  const authSrc = readSource("../src/lib/parent-auth.ts");
  assert.match(authSrc, /if \(!isParentActive\(parent\)\)[\s\S]*revokeAllParentSessions/);
  assert.match(authSrc, /reason: "PARENT_ACCOUNT_INACTIVE"/);
});

test("8. old session after student archival: student-specific access blocked and sessions revoked when no active siblings remain", async () => {
  const pid = new ObjectId().toString();
  const db = makeDb({
    students: [{ studentId: "SK-1", name: "A", class: "1", parentMobile: "9876543210", status: "Inactive" }],
    parents: [{ _id: new ObjectId(pid), linkedStudentIds: ["SK-1"] }],
    sessions: [{ parentId: pid, revokedAt: null, jti: "j1" }],
  });
  await revokeParentSessionsIfNoActiveLinkedStudents(db, "SK-1");
  assert.ok(db.state.sessions[0].revokedAt instanceof Date);
});

test("9. direct attendance API request for archived student: returns STUDENT_ACCESS_RESTRICTED/STUDENT_INACTIVE", async () => {
  const db = makeDb({
    students: [{ studentId: "SK-1", name: "A", class: "1", parentMobile: "9876543210", status: "Inactive" }],
  });
  const res = await verifyParentStudentAccess(db, parentDoc({ linkedStudentIds: ["SK-1"] }), "SK-1");
  assert.equal(res.ok, false);
  assert.deepEqual(res.failure, { status: 403, body: studentInactiveBody() });
  const src = readSource("../src/app/api/parent/attendance/route.ts");
  assert.match(src, /verifyParentStudentAccess/);
  assert.match(src, /requireActiveStudents/);
});

test("10. direct fees API request for archived student: blocked with student inactive contract", async () => {
  const db = makeDb({
    students: [{ studentId: "SK-1", name: "A", class: "1", parentMobile: "9876543210", status: "Inactive" }],
  });
  const res = await verifyParentStudentAccess(db, parentDoc({ linkedStudentIds: ["SK-1"] }), "SK-1");
  assert.equal(res.ok, false);
  assert.equal(res.failure.status, 403);
  assert.equal(res.failure.body.reason, "STUDENT_INACTIVE");
  const src = readSource("../src/app/api/parent/fees/route.ts");
  assert.match(src, /verifyParentStudentAccess/);
});

test("11. direct receipt API request for deleted student: no access/leak; archived linked student returns STUDENT_INACTIVE", async () => {
  // deleted (missing)
  const dbMissing = makeDb({ students: [] });
  const missing = await verifyParentStudentAccess(dbMissing, parentDoc({ linkedStudentIds: ["SK-DEL"] }), "SK-DEL");
  assert.equal(missing.ok, false);
  assert.equal(missing.failure.status, 404);

  // archived but still present
  const dbArchived = makeDb({ students: [{ studentId: "SK-1", name: "A", class: "1", parentMobile: "9876543210", status: "Inactive" }] });
  const archived = await verifyParentStudentAccess(dbArchived, parentDoc({ linkedStudentIds: ["SK-1"] }), "SK-1");
  assert.equal(archived.ok, false);
  assert.equal(archived.failure.status, 403);

  const src = readSource("../src/app/api/parent/receipt/[receiptNo]/route.ts");
  assert.match(src, /verifyParentStudentAccess/);
  assert.match(src, /Receipt not found/); // anti-leak for not linked/missing
  assert.match(src, /STUDENT_INACTIVE|studentInactiveBody/);
});

test("12. parent attempting to access another parent's student: 404 without exposing other parent's info", async () => {
  const db = makeDb({ students: [{ studentId: "SK-OTHER", name: "Other", class: "1", parentMobile: "1111111111", status: "Active" }] });
  const res = await verifyParentStudentAccess(db, parentDoc({ linkedStudentIds: ["SK-MINE"] }), "SK-OTHER");
  assert.equal(res.ok, false);
  assert.deepEqual(res.failure, { status: 404, body: { success: false, error: "Student not found" } });
});

test("13. temporary database failure is distinguishable from access restriction", () => {
  const routes = [
    "../src/app/api/parent/login/route.ts",
    "../src/app/api/parent/me/route.ts",
    "../src/app/api/parent/students/route.ts",
    "../src/app/api/parent/attendance/route.ts",
    "../src/app/api/parent/fees/route.ts",
    "../src/app/api/parent/fees/payments/route.ts",
    "../src/app/api/parent/receipt/[receiptNo]/route.ts",
  ];
  for (const p of routes) {
    const src = readSource(p);
    assert.match(src, /catch/, `${p} must handle errors`);
    assert.match(src, /500|503/, `${p} must return server error status on failure`);
    // generic outer failure handlers must not produce restriction payloads/codes
    const m = src.match(/catch\s*\(error\)\s*\{[\s\S]*$/) || src.match(/catch\s*\{[\s\S]*$/);
    const outerCatch = m ? m[0] : "";
    assert.ok(outerCatch.length > 0, `${p} must have outer catch handling`);
    assert.doesNotMatch(outerCatch, /parentAccessRestrictedBody\(/, `${p} must not return restriction body from catch`);
    assert.doesNotMatch(outerCatch, /PARENT_ACCESS_RESTRICTED|NO_ACTIVE_STUDENTS|PARENT_ACCOUNT_INACTIVE|STUDENT_ACCESS_RESTRICTED|STUDENT_INACTIVE/, `${p} must not map failures to access restrictions`);
    assert.match(outerCatch, /500|503/);
  }
});

test("14. existing sibling admission and login compatibility: active siblings preserved and shared parent not deleted", async () => {
  const pid = new ObjectId().toString();
  const db = makeDb({
    students: [
      { studentId: "SK-ARCH", name: "Archived", class: "1", status: "Inactive" },
      { studentId: "SK-ACT", name: "Active", class: "2", status: "Active" },
    ],
    parents: [{ _id: new ObjectId(pid), linkedStudentIds: ["SK-ARCH", "SK-ACT"] }],
    sessions: [{ parentId: pid, revokedAt: null, jti: "j1" }],
  });
  // archiving/deleting one sibling must not revoke if another active remains
  await revokeParentSessionsForAffectedStudentsIfNoActive(db, ["SK-ARCH"]);
  assert.equal(db.state.sessions[0].revokedAt, null);

  // all inactive -> revoke
  db.state.students[1].status = "Inactive";
  await revokeParentSessionsForAffectedStudentsIfNoActive(db, ["SK-ACT"]);
  assert.ok(db.state.sessions[0].revokedAt instanceof Date);

  // archive/delete routes and admission flow compatibility hooks present
  const archiveSrc = readSource("../src/app/api/students/[id]/route.ts");
  const permSrc = readSource("../src/app/api/students/[id]/permanent/route.ts");
  const bulkSrc = readSource("../src/app/api/students/bulk/route.ts");
  assert.match(archiveSrc, /revokeParentSessionsIfNoActiveLinkedStudents/);
  assert.match(permSrc, /revokeParentSessionsIfNoActiveLinkedStudents/);
  assert.match(bulkSrc, /revokeParentSessionsForAffectedStudentsIfNoActive/);
  const loginSrc = readSource("../src/app/api/parent/login/route.ts");
  assert.match(loginSrc, /getActiveLinkedStudents/);
  assert.match(loginSrc, /NO_ACTIVE_STUDENTS/);
});

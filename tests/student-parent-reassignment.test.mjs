import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ObjectId } from "mongodb";
import {
  getActiveLinkedStudents,
  reassignStudentParentLinks,
  verifyParentStudentAccess,
} from "../src/lib/parent-auth.ts";

const mobileA = "9876543210";
const mobileB = "9123456780";
const studentId = "SK-1001";

function makeDb() {
  const state = {
    students: [
      { studentId, name: "Learner One", class: "Class 5", parentMobile: mobileA, status: "Active" },
      { studentId: "SK-1002", name: "Sibling", class: "Class 3", parentMobile: mobileA, status: "Active" },
      { studentId: "SK-2001", name: "Other Child", class: "Class 4", parentMobile: mobileB, status: "Active" },
    ],
    parents: [
      { _id: new ObjectId(), parentMobile: mobileA, linkedStudentIds: [studentId, "SK-1002"] },
      { _id: new ObjectId(), parentMobile: mobileB, linkedStudentIds: ["SK-2001"] },
    ],
  };
  let failUpdateForMobile = null;

  function collection(name) {
    if (name === "parents") {
      return {
        find(query) {
          let rows = state.parents;
          if (query.parentMobile?.$in) {
            rows = rows.filter((p) => query.parentMobile.$in.includes(p.parentMobile));
          }
          if (query._id?.$in) rows = rows.filter((p) => query._id.$in.some((id) => id.equals(p._id)));
          return { async toArray() { return rows.map((p) => ({ ...p, linkedStudentIds: [...p.linkedStudentIds] })); } };
        },
        async updateOne(query, update) {
          const parent = state.parents.find((p) => p._id.equals(query._id));
          if (!parent) return { matchedCount: 0 };
          if (parent.parentMobile === failUpdateForMobile) throw new Error("simulated transaction failure");
          if (update.$pull?.linkedStudentIds?.$in) {
            parent.linkedStudentIds = parent.linkedStudentIds.filter((id) => !update.$pull.linkedStudentIds.$in.includes(id));
          }
          if (update.$addToSet?.linkedStudentIds && !parent.linkedStudentIds.includes(update.$addToSet.linkedStudentIds)) {
            parent.linkedStudentIds.push(update.$addToSet.linkedStudentIds);
          }
          if (update.$set) Object.assign(parent, update.$set);
          return { matchedCount: 1 };
        },
      };
    }
    if (name === "students") {
      return {
        find(query, options = {}) {
          const ids = query.studentId?.$in || [];
          let rows = state.students.filter((s) => ids.includes(s.studentId) && s.status === "Active");
          if (options.projection?._id === 0) rows = rows.map((s) => ({ ...s }));
          return { async toArray() { return rows.map((s) => ({ ...s })); } };
        },
        async findOne(query) { return state.students.find((s) => s.studentId === query.studentId) || null; },
      };
    }
    throw new Error(`Unexpected collection ${name}`);
  }

  return {
    collection,
    state,
    failParentUpdate(mobile) { failUpdateForMobile = mobile; },
  };
}

function parent(db, mobile) {
  return db.state.parents.find((p) => p.parentMobile === mobile);
}

async function transaction(db, callback) {
  const before = {
    students: db.state.students.map((s) => ({ ...s })),
    parents: db.state.parents.map((p) => ({ ...p, linkedStudentIds: [...p.linkedStudentIds] })),
  };
  try {
    return await callback({});
  } catch (error) {
    db.state.students = before.students;
    db.state.parents = before.parents;
    throw error;
  }
}

async function reassign(db, toMobile) {
  const now = new Date();
  return transaction(db, async (session) => {
    const student = db.state.students.find((s) => s.studentId === studentId);
    student.parentMobile = toMobile;
    return reassignStudentParentLinks(db, session, {
      studentId,
      previousParentMobile: mobileA,
      nextParentMobile: toMobile,
      now,
    });
  });
}

test("reassignment removes old access, links the new parent and preserves siblings", async () => {
  const db = makeDb();
  await reassign(db, mobileB);

  assert.deepEqual(parent(db, mobileA).linkedStudentIds, ["SK-1002"]);
  assert.deepEqual(parent(db, mobileB).linkedStudentIds, ["SK-2001", studentId]);
  assert.deepEqual((await getActiveLinkedStudents(db, parent(db, mobileA).linkedStudentIds, mobileA)).map((s) => s.studentId), ["SK-1002"]);
  assert.deepEqual((await getActiveLinkedStudents(db, parent(db, mobileB).linkedStudentIds, mobileB)).map((s) => s.studentId), ["SK-2001", studentId]);

  const oldAccess = await verifyParentStudentAccess(db, {
    _id: parent(db, mobileA)._id,
    parentMobile: mobileA,
    linkedStudentIds: [studentId], // deliberately simulate a stale cached link
  }, studentId);
  assert.equal(oldAccess.ok, false);
  assert.equal(oldAccess.failure.status, 404);

  const newAccess = await verifyParentStudentAccess(db, {
    _id: parent(db, mobileB)._id,
    parentMobile: mobileB,
    linkedStudentIds: [studentId],
  }, studentId);
  assert.equal(newAccess.ok, true);
});

test("reassignment to an existing parent adds one link and retains that parent's other students", async () => {
  const db = makeDb();
  const oldParentIds = await reassign(db, mobileB);
  assert.equal(oldParentIds.length, 1);
  assert.deepEqual(parent(db, mobileB).linkedStudentIds, ["SK-2001", studentId]);
});

test("same-parent edit does not duplicate links or remove sibling links", async () => {
  const db = makeDb();
  await transaction(db, async (session) => {
    return reassignStudentParentLinks(db, session, {
      studentId,
      previousParentMobile: mobileA,
      nextParentMobile: ` ${mobileA} `,
      now: new Date(),
    });
  });
  assert.deepEqual(parent(db, mobileA).linkedStudentIds, [studentId, "SK-1002"]);
});

test("a failed transaction restores the student and both parent link lists", async () => {
  const db = makeDb();
  db.failParentUpdate(mobileB);
  await assert.rejects(reassign(db, mobileB), /simulated transaction failure/);
  assert.equal(db.state.students.find((s) => s.studentId === studentId).parentMobile, mobileA);
  assert.deepEqual(parent(db, mobileA).linkedStudentIds, [studentId, "SK-1002"]);
  assert.deepEqual(parent(db, mobileB).linkedStudentIds, ["SK-2001"]);
});

test("student update uses the existing transaction and parent login/student list retain shared filtering", () => {
  const updateRoute = readFileSync(new URL("../src/app/api/students/[id]/route.ts", import.meta.url), "utf8");
  const loginRoute = readFileSync(new URL("../src/app/api/parent/login/route.ts", import.meta.url), "utf8");
  const studentsRoute = readFileSync(new URL("../src/app/api/parent/students/route.ts", import.meta.url), "utf8");
  assert.match(updateRoute, /session\.withTransaction/);
  assert.match(updateRoute, /reassignStudentParentLinks/);
  assert.match(loginRoute, /getActiveLinkedStudents\(db, parent\.linkedStudentIds, parent\.parentMobile\)/);
  assert.match(studentsRoute, /getActiveLinkedStudents\(db, auth\.parent\.linkedStudentIds, auth\.parent\.parentMobile\)/);
});

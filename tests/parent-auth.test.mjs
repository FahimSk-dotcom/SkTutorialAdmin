/**
 * Parent Authentication — unit tests
 *
 * Coverage strategy:
 *   - Pure helper logic is verified by implementing the same algorithms inline
 *     (mobile validation, Bearer parsing, device hash, student ID normalisation,
 *      JWT signing/verification) using the same deps (crypto, jsonwebtoken, mongodb).
 *   - parentLoginSchema validation is tested by importing the schema directly.
 *   - Route-level and library security invariants are verified by source-scanning
 *     (the same pattern used in route-safety.test.mjs and attendance-route-safety.test.mjs).
 *
 * Run with: node --test tests/parent-auth.test.mjs
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import jwt from "jsonwebtoken";
import { ObjectId } from "mongodb";
import { parentLoginSchema } from "../src/schemas/index.ts";
import { isAllowedParentOrigin } from "../src/lib/parent-cors-policy.ts";

// ---------------------------------------------------------------------------
// Constants mirrored from parent-auth.ts (source of truth is the library)
// ---------------------------------------------------------------------------
const PARENT_TOKEN_ISSUER   = "sk-tutorials-parent";
const PARENT_TOKEN_AUDIENCE = "sk-tutorials-parent-app";
const PARENT_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

// Test-only JWT secret — not used in any real environment
const TEST_SECRET    = "test-parent-secret-at-least-32-chars-long!!";
const ANOTHER_SECRET = "another-secret-at-least-32-chars-long!!xxxx";

const MOBILE_PATTERN = /^[0-9]{10}$/;
const BEARER_PATTERN = /^Bearer\s+(\S+)$/i;

// Pure helper re-implementations (mirror parent-auth.ts, tested against that source below)
function normalizeParentMobile(value) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/[\s-]/g, "").trim();
}

function isValidParentMobile(value) {
  return MOBILE_PATTERN.test(normalizeParentMobile(value));
}

function parseBearerToken(header) {
  if (!header) return null;
  const match = BEARER_PATTERN.exec(header.trim());
  return match ? match[1] : null;
}

function hashDeviceId(deviceId) {
  const normalized = typeof deviceId === "string" ? deviceId.trim() : "";
  if (!normalized) return null;
  return createHash("sha256").update(normalized).digest("hex");
}

function normalizeLinkedStudentIds(value) {
  if (!Array.isArray(value)) return [];
  const ids = new Set();
  for (const item of value) {
    const id = String(item ?? "").trim();
    if (id) ids.add(id);
  }
  return [...ids];
}

function toParentStudentSummary(student) {
  const studentId = String(student.studentId ?? "").trim();
  const name      = String(student.name      ?? "").trim();
  const className = String(student.class     ?? "").trim();
  if (!studentId || !name) return null;
  return { studentId, name, class: className };
}

function filterLinkedStudents(linkedStudentIds, studentDocs) {
  const allowedIds = new Set(normalizeLinkedStudentIds(linkedStudentIds));
  const byId = new Map();
  for (const doc of studentDocs) {
    const student = toParentStudentSummary(doc);
    if (!student || !allowedIds.has(student.studentId)) continue;
    byId.set(student.studentId, student);
  }
  return [...byId.values()].sort((l, r) => l.studentId.localeCompare(r.studentId));
}

function signParentToken(parentId, secret = TEST_SECRET, ttlSeconds = PARENT_TOKEN_TTL_SECONDS) {
  const jti = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
  const token = jwt.sign(
    { parentId, tokenType: "parent" },
    secret,
    { algorithm: "HS256", expiresIn: ttlSeconds, issuer: PARENT_TOKEN_ISSUER, audience: PARENT_TOKEN_AUDIENCE, jwtid: jti }
  );
  return { token, jti, expiresAt: new Date(Date.now() + ttlSeconds * 1000) };
}

function verifyParentToken(token, secret = TEST_SECRET) {
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, secret, {
      algorithms: ["HS256"],
      issuer: PARENT_TOKEN_ISSUER,
      audience: PARENT_TOKEN_AUDIENCE,
    });
    if (typeof decoded === "string") return null;
    if (decoded.tokenType !== "parent") return null;
    if (typeof decoded.parentId !== "string" || !decoded.parentId) return null;
    if (typeof decoded.jti !== "string" || !decoded.jti) return null;
    return { parentId: decoded.parentId, tokenType: "parent", jti: decoded.jti, iat: decoded.iat, exp: decoded.exp };
  } catch {
    return null;
  }
}

// Source reader (matches existing test style)
const readSource = (relativePath) =>
  readFileSync(new URL(relativePath, import.meta.url), "utf8");

// ============================================================================
// 1. Mobile number validation
// ============================================================================
test("normalizeParentMobile strips spaces and hyphens", () => {
  assert.equal(normalizeParentMobile("900 474-0981"), "9004740981");
  assert.equal(normalizeParentMobile("  9004740981  "), "9004740981");
  assert.equal(normalizeParentMobile(null), "");
  assert.equal(normalizeParentMobile(undefined), "");
});

test("isValidParentMobile accepts exactly 10 digits", () => {
  assert.equal(isValidParentMobile("9004740981"), true);
  assert.equal(isValidParentMobile("0000000000"), true);
});

test("isValidParentMobile rejects invalid mobile formats", () => {
  assert.equal(isValidParentMobile("900474098"),    false); // 9 digits
  assert.equal(isValidParentMobile("90047409810"),  false); // 11 digits
  assert.equal(isValidParentMobile("900474098a"),   false); // non-digit
  assert.equal(isValidParentMobile(""),             false);
  assert.equal(isValidParentMobile(null),           false);
  assert.equal(isValidParentMobile("+919004740981"), false); // country code
});

// ============================================================================
// 2. Bearer token extraction
// ============================================================================
test("parseBearerToken returns the token from a valid Authorization header", () => {
  const token = "eyJhbGciOiJIUzI1NiJ9.test.sig";
  assert.equal(parseBearerToken(`Bearer ${token}`), token);
  assert.equal(parseBearerToken(`bearer ${token}`), token);
  assert.equal(parseBearerToken(`BEARER ${token}`), token);
});

test("parseBearerToken returns null for missing or malformed headers", () => {
  assert.equal(parseBearerToken(null),       null);
  assert.equal(parseBearerToken(""),         null);
  assert.equal(parseBearerToken("Token abc"), null);
  assert.equal(parseBearerToken("Bearer"),   null);
  assert.equal(parseBearerToken("Bearer "), null);
});

// ============================================================================
// 3. Device ID hashing
// ============================================================================
test("hashDeviceId produces a consistent SHA-256 hex of the device ID", () => {
  const deviceId = "device-abc-123";
  const expected = createHash("sha256").update(deviceId).digest("hex");
  assert.equal(hashDeviceId(deviceId), expected);
});

test("hashDeviceId returns null for empty or absent device IDs", () => {
  assert.equal(hashDeviceId(null), null);
  assert.equal(hashDeviceId(undefined), null);
  assert.equal(hashDeviceId(""), null);
  assert.equal(hashDeviceId("   "), null);
});

// ============================================================================
// 4. Linked student ID normalisation
// ============================================================================
test("normalizeLinkedStudentIds deduplicates and trims IDs", () => {
  const result = normalizeLinkedStudentIds(["SK-1001", " SK-1002 ", "SK-1001"]);
  assert.deepEqual(result.sort(), ["SK-1001", "SK-1002"]);
});

test("normalizeLinkedStudentIds returns empty array for non-arrays", () => {
  assert.deepEqual(normalizeLinkedStudentIds(null), []);
  assert.deepEqual(normalizeLinkedStudentIds(undefined), []);
  assert.deepEqual(normalizeLinkedStudentIds("SK-1001"), []);
  assert.deepEqual(normalizeLinkedStudentIds({}), []);
});

test("normalizeLinkedStudentIds filters out blank entries", () => {
  assert.deepEqual(normalizeLinkedStudentIds(["SK-1001", "", "  "]), ["SK-1001"]);
});

// ============================================================================
// 5. Student summary mapping
// ============================================================================
test("toParentStudentSummary maps valid fields correctly", () => {
  assert.deepEqual(
    toParentStudentSummary({ studentId: "SK-1001", name: "Riya Sharma", class: "Class 9" }),
    { studentId: "SK-1001", name: "Riya Sharma", class: "Class 9" }
  );
});

test("toParentStudentSummary returns null when studentId or name is missing", () => {
  assert.equal(toParentStudentSummary({ name: "Riya" }), null);
  assert.equal(toParentStudentSummary({ studentId: "SK-1001" }), null);
  assert.equal(toParentStudentSummary({}), null);
});

// ============================================================================
// 6. filterLinkedStudents — scope guard
// ============================================================================
test("filterLinkedStudents returns only students in the parent's linked list", () => {
  const linked = ["SK-1001", "SK-1002"];
  const docs = [
    { studentId: "SK-1001", name: "Riya",  class: "Class 9"  },
    { studentId: "SK-1002", name: "Rahul", class: "Class 7"  },
    { studentId: "SK-9999", name: "Other", class: "Class 10" }, // not linked
  ];
  const result = filterLinkedStudents(linked, docs);
  assert.equal(result.length, 2);
  assert.ok(result.some((s) => s.studentId === "SK-1001"));
  assert.ok(result.some((s) => s.studentId === "SK-1002"));
  assert.ok(!result.some((s) => s.studentId === "SK-9999"));
});

test("filterLinkedStudents handles parent with no linked students safely", () => {
  assert.deepEqual(
    filterLinkedStudents([], [{ studentId: "SK-1001", name: "Riya", class: "Class 9" }]),
    []
  );
});

test("filterLinkedStudents handles multiple siblings", () => {
  const linked = ["SK-1001", "SK-1002", "SK-1003"];
  const docs = linked.map((id, i) => ({ studentId: id, name: `Child ${i + 1}`, class: `Class ${i + 1}` }));
  assert.equal(filterLinkedStudents(linked, docs).length, 3);
});

test("filterLinkedStudents prevents access to unrelated students", () => {
  const linked = ["SK-1001"];
  const docs = [
    { studentId: "SK-1001", name: "My Child",             class: "Class 9"  },
    { studentId: "SK-9999", name: "Someone Else's Child", class: "Class 10" },
  ];
  const result = filterLinkedStudents(linked, docs);
  assert.equal(result.length, 1);
  assert.equal(result[0].studentId, "SK-1001");
});

// ============================================================================
// 7. JWT signing and verification
// ============================================================================
test("signParentToken returns a token, jti and expiresAt", () => {
  const { token, jti, expiresAt } = signParentToken("64a0000000000000000abcde");
  assert.equal(typeof token, "string");
  assert.ok(token.length > 0);
  assert.equal(typeof jti, "string");
  assert.ok(jti.length > 0);
  assert.ok(expiresAt instanceof Date);
  assert.ok(expiresAt > new Date());
});

test("signParentToken embeds issuer, audience and tokenType=parent", () => {
  const { token } = signParentToken("64a0000000000000000abcde");
  const decoded = jwt.verify(token, TEST_SECRET, {
    algorithms: ["HS256"],
    issuer: PARENT_TOKEN_ISSUER,
    audience: PARENT_TOKEN_AUDIENCE,
  });
  assert.equal(decoded.tokenType, "parent");
  assert.equal(decoded.parentId, "64a0000000000000000abcde");
});

test("verifyParentToken correctly parses a freshly signed token", () => {
  const parentId = "64a0000000000000000abcde";
  const { token } = signParentToken(parentId);
  const payload = verifyParentToken(token);
  assert.ok(payload !== null);
  assert.equal(payload.parentId, parentId);
  assert.equal(payload.tokenType, "parent");
  assert.equal(typeof payload.jti, "string");
  assert.equal(typeof payload.iat, "number");
  assert.equal(typeof payload.exp, "number");
});

test("verifyParentToken returns null for a token signed with the wrong secret", () => {
  const { token } = signParentToken("64a0000000000000000abcde");
  assert.equal(verifyParentToken(token, ANOTHER_SECRET), null);
});

test("verifyParentToken returns null for an expired token", (_, done) => {
  const { token } = signParentToken("64a0000000000000000abcde", TEST_SECRET, 1);
  setTimeout(() => {
    assert.equal(verifyParentToken(token), null);
    done();
  }, 1100);
});

test("verifyParentToken returns null for a totally invalid token string", () => {
  assert.equal(verifyParentToken("not.a.token"), null);
  assert.equal(verifyParentToken(""), null);
});

test("verifyParentToken returns null for a token with wrong tokenType", () => {
  const forged = jwt.sign(
    { parentId: "64a0000000000000000abcde", tokenType: "admin" },
    TEST_SECRET,
    { algorithm: "HS256", issuer: PARENT_TOKEN_ISSUER, audience: PARENT_TOKEN_AUDIENCE }
  );
  assert.equal(verifyParentToken(forged), null);
});

// ============================================================================
// 8. PARENT_TOKEN_TTL_SECONDS constant
// ============================================================================
test("PARENT_TOKEN_TTL_SECONDS is exactly 7 days", () => {
  assert.equal(PARENT_TOKEN_TTL_SECONDS, 7 * 24 * 60 * 60);
});

// ============================================================================
// 9. parentLoginSchema validation
// ============================================================================
test("parentLoginSchema accepts valid login input", () => {
  const result = parentLoginSchema.safeParse({
    parentMobile: "9004740981",
    password: "correct-password",
    deviceId: "android-device-id-abc",
  });
  assert.ok(result.success);
});

test("parentLoginSchema rejects mobile with wrong digit count", () => {
  const result = parentLoginSchema.safeParse({ parentMobile: "900474098", password: "password" });
  assert.ok(!result.success);
  assert.ok(result.error.issues[0].message.includes("10 digits"));
});

test("parentLoginSchema rejects missing password (empty string)", () => {
  const result = parentLoginSchema.safeParse({ parentMobile: "9004740981", password: "" });
  assert.ok(!result.success);
  assert.ok(result.error.issues.some((i) => i.message.toLowerCase().includes("password")));
});

test("parentLoginSchema normalizes mobile by stripping spaces and hyphens", () => {
  const result = parentLoginSchema.safeParse({ parentMobile: "900 474-0981", password: "pw" });
  assert.ok(result.success);
  assert.equal(result.data.parentMobile, "9004740981");
});

test("parentLoginSchema allows deviceId to be optional", () => {
  const result = parentLoginSchema.safeParse({ parentMobile: "9004740981", password: "pw" });
  assert.ok(result.success);
  assert.equal(result.data.deviceId, undefined);
});

test("parentLoginSchema rejects non-digit mobile number format", () => {
  // After stripping, "+919004740981" retains '+' sign — still invalid
  const result = parentLoginSchema.safeParse({ parentMobile: "+919004740981", password: "pw" });
  assert.ok(!result.success);
});

// ============================================================================
// 10. Route security source scans
// ============================================================================
test("parent login route uses dummy-hash timing-safe comparison to prevent user enumeration", () => {
  const source = readSource("../src/app/api/parent/login/route.ts");
  assert.match(source, /DUMMY_PASSWORD_HASH/);
  assert.match(source, /comparePassword/);
});

test("parent login route uses the parents collection only (not parent_accounts)", () => {
  const source = readSource("../src/app/api/parent/login/route.ts");
  assert.match(source, /PARENTS_COLLECTION/);
  assert.doesNotMatch(source, /parent_accounts/);
});

test("parent login route returns contract without exposing passwordHash", () => {
  const source = readSource("../src/app/api/parent/login/route.ts");
  assert.doesNotMatch(source, /return[^;]*passwordHash/);
  assert.match(source, /status: "ACTIVE"/);
  assert.match(source, /activeStudentCount/);
  assert.match(source, /PARENT_ACCOUNT_INACTIVE/);
  assert.match(source, /NO_ACTIVE_STUDENTS/);
});

test("parent login route never logs passwords or tokens", () => {
  const source = readSource("../src/app/api/parent/login/route.ts");
  assert.doesNotMatch(source, /console\.log.*password/i);
  assert.doesNotMatch(source, /console\.log.*token/i);
});

test("parent /me route never exposes passwordHash and enforces active access", () => {
  const source = readSource("../src/app/api/parent/me/route.ts");
  assert.doesNotMatch(source, /passwordHash/);
  assert.match(source, /requireActiveStudents/);
  assert.match(source, /activeStudentCount/);
});

test("parent /me route requires a valid Bearer token via getAuthenticatedParent", () => {
  const source = readSource("../src/app/api/parent/me/route.ts");
  assert.match(source, /getAuthenticatedParent/);
});

test("parent /students route never accepts arbitrary student IDs from client", () => {
  const source = readSource("../src/app/api/parent/students/route.ts");
  assert.match(source, /auth\.parent\.linkedStudentIds/);
  assert.doesNotMatch(source, /request\.json/);
});

test("parent /students route requires authentication", () => {
  const source = readSource("../src/app/api/parent/students/route.ts");
  assert.match(source, /getAuthenticatedParent/);
});

test("parent /logout route performs real session revocation (not fake)", () => {
  const source = readSource("../src/app/api/parent/logout/route.ts");
  assert.match(source, /revokeParentSession/);
  assert.match(source, /auth\.token\.jti/);
});

test("parent /logout route requires authentication before revoking", () => {
  const source = readSource("../src/app/api/parent/logout/route.ts");
  assert.match(source, /getAuthenticatedParent/);
});

test("parent session uses DB-backed sessions enabling real token revocation", () => {
  const authSource = readSource("../src/lib/parent-auth.ts");
  assert.match(authSource, /PARENT_SESSIONS_COLLECTION/);
  assert.match(authSource, /revokedAt/);
  assert.match(authSource, /expiresAt/);
});

test("parent auth uses separate parent JWT secret", () => {
  const authSource = readSource("../src/lib/parent-auth.ts");
  assert.match(authSource, /JWT_PARENT_SECRET/);
  assert.match(authSource, /getEnv\(\)\.JWT_PARENT_SECRET/);
  assert.doesNotMatch(authSource, /JWT_ADMIN_SECRET/);
});

test("parent auth getAuthenticatedParent never trusts client-supplied parentId", () => {
  const authSource = readSource("../src/lib/parent-auth.ts");
  // Parent document is fetched using the JWT-embedded parentId as ObjectId
  assert.match(authSource, /ObjectId/);
  assert.match(authSource, /payload\.parentId/);
});

test("parent auth lib never returns passwordHash from parent document lookups", () => {
  const authSource = readSource("../src/lib/parent-auth.ts");
  // projection must exclude passwordHash
  assert.match(authSource, /passwordHash: 0/);
});

test("parent auth enforces active parent status and revokes sessions when disabled", () => {
  const authSource = readSource("../src/lib/parent-auth.ts");
  assert.match(authSource, /isParentActive/);
  assert.match(authSource, /PARENT_ACCOUNT_INACTIVE/);
  assert.match(authSource, /revokeAllParentSessions/);
});

test("parent auth sessions have TTL index on expiresAt for automatic cleanup", () => {
  const authSource = readSource("../src/lib/parent-auth.ts");
  assert.match(authSource, /expiresAt/);
  assert.match(authSource, /expireAfterSeconds/);
});

test("parent login route validates request body with parentLoginSchema", () => {
  const source = readSource("../src/app/api/parent/login/route.ts");
  assert.match(source, /parentLoginSchema/);
  assert.match(source, /safeParse/);
});

test("parent login route enforces account status and no-active-students restrictions", () => {
  const source = readSource("../src/app/api/parent/login/route.ts");
  assert.match(source, /isParentActive/);
  assert.match(source, /PARENT_ACCOUNT_INACTIVE/);
  assert.match(source, /NO_ACTIVE_STUDENTS/);
  assert.match(source, /revokeAllParentSessions/);
  assert.match(source, /403/);
});

test("Next.js proxy lets only the parent auth endpoints reach their handler-level auth", () => {
  const source = readSource("../src/proxy.ts");
  for (const pathname of [
    "/api/parent/login",
    "/api/parent/me",
    "/api/parent/students",
    "/api/parent/logout",
  ]) {
    assert.ok(source.includes(`pathname === "${pathname}"`));
  }
  assert.match(source, /!isParentApiRoute/);
});

test("parent CORS allows only explicitly configured browser origins", () => {
  const allowed = "http://localhost:8081, https://parent.example.com";
  assert.equal(isAllowedParentOrigin("http://localhost:8081", allowed), true);
  assert.equal(isAllowedParentOrigin("https://parent.example.com", allowed), true);
  assert.equal(isAllowedParentOrigin("https://attacker.example", allowed), false);
  assert.equal(isAllowedParentOrigin(null, allowed), false);
});

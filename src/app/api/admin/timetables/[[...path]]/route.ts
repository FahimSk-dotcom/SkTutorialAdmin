import { getAuthenticatedAdmin } from "@/lib/auth";
import { normalizeClass } from "@/lib/class-utils";
import { getDb } from "@/lib/mongodb";
import { timetableUpdate } from "@/lib/timetable-model";
import { getTimetable, listTimetableClasses, saveTimetable } from "@/lib/timetables";

type Context = { params: Promise<{ path?: string[] }> };
const json = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { "Cache-Control": "private, no-store" } });

async function handle(request: Request, context: Context) {
  try {
    const admin = await getAuthenticatedAdmin();
    if (!admin) return json({ error: "Unauthorized." }, 401);
    const { path = [] } = await context.params;
    const listing = request.method === "GET" && path.length === 0;
    if (!listing && (path.length !== 1 || path[0].length > 64)) return json({ error: "Class not found." }, 404);
    const classId = listing ? "" : normalizeClass(path[0]);

    if (request.method === "PUT" && request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
      return json({ error: "Use an application/json request." }, 415);
    }
    const db = await getDb();
    const classes = await listTimetableClasses(db);
    if (listing) return json({ classes });
    if (!classes.some(({ id }) => id === classId)) return json({ error: "Select an existing class." }, 404);
    if (request.method === "GET") return json({ timetable: await getTimetable(db, classId) });
    const parsed = timetableUpdate.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return json({ error: "Choose a valid layout and enter a subject of 1–100 characters in every required cell, Monday through Saturday." }, 400);
    }
    const saved = await saveTimetable(db, classId, parsed.data.timetable, parsed.data.revision, admin.adminId);
    return saved ? json({ timetable: saved })
      : json({ error: "This timetable changed while you were editing. Reload it before saving again." }, 409);
  } catch (error) {
    console.error("Admin timetable operation failed", error);
    return json({ error: "Unable to complete the timetable operation." }, 500);
  }
}

export { handle as GET, handle as PUT };

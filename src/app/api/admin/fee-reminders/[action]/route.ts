import { z } from "zod";
import { getAuthenticatedAdmin } from "@/lib/auth";
import { getDb } from "@/lib/mongodb";
import { feeReminderSettingsSchema } from "@/lib/fee-reminder-config";
import {
  executeFeeReminders, getReminderHistory, loadReminderSettings, previewReminders, saveReminderSettings,
} from "@/lib/fee-reminders";

export const maxDuration = 300;

const manualSchema = z.object({ requestId: z.uuid(), confirmed: z.literal(true) }).strict();
const testSchema = z.object({
  requestId: z.uuid(),
  parentId: z.string().regex(/^[0-9a-f]{24}$/i),
}).strict();

type Context = { params: Promise<{ action: string }> };
const json = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { "Cache-Control": "private, no-store" } });

async function handle(request: Request, context: Context) {
  try {
    const admin = await getAuthenticatedAdmin();
    if (!admin) return json({ error: "Unauthorized" }, 401);
    const { action } = await context.params;
    if (["PUT", "POST"].includes(request.method) &&
      request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
      return json({ error: "Use an application/json request body." }, 415);
    }
    const db = await getDb();

    if (request.method === "GET") {
      if (action === "settings") return json(await loadReminderSettings(db));
      if (action === "preview") return json(await previewReminders(db));
      if (action === "history") return json(await getReminderHistory(db));
    }
    if (request.method === "PUT" && action === "settings") {
      const parsed = feeReminderSettingsSchema.safeParse(await request.json().catch(() => null));
      if (!parsed.success) return json({ error: parsed.error.issues[0].message }, 400);
      return json(await saveReminderSettings(db, parsed.data, admin.adminId));
    }
    if (request.method === "POST" && (action === "test" || action === "run")) {
      const body: unknown = await request.json().catch(() => null);
      if (action === "test") {
        const parsed = testSchema.safeParse(body);
        if (!parsed.success) return json({ error: "Select an eligible parent and provide a valid request ID." }, 400);
        const result = await executeFeeReminders(db, {
          ...parsed.data, type: "test", adminId: admin.adminId,
        });
        return result ? json(result) : json({ error: "This request ID already belongs to another parent." }, 409);
      }
      const parsed = manualSchema.safeParse(body);
      if (!parsed.success) return json({ error: "Explicit confirmation and a valid request ID are required." }, 400);
      return json(await executeFeeReminders(db, {
        type: "manual", adminId: admin.adminId, requestId: parsed.data.requestId,
      }));
    }
    return json({ error: "Unknown fee reminder operation" }, 404);
  } catch (error) {
    console.error("Fee reminder admin operation failed", error);
    return json({ error: "The fee reminder operation could not be completed. Check execution history before repeating a send." }, 500);
  }
}

export { handle as GET, handle as POST, handle as PUT };

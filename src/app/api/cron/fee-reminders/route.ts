import { timingSafeEqual } from "node:crypto";
import { executeFeeReminders } from "@/lib/fee-reminders";
import { getDb } from "@/lib/mongodb";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (request.method !== "GET") return new Response(null, { status: 405 });
  const secret = process.env.CRON_SECRET?.trim();
  const header = Buffer.from(request.headers.get("authorization") ?? "");
  if (!secret || secret.length < 16) {
    return Response.json({ error: "Cron authentication is unavailable" }, { status: 503 });
  }
  const expected = Buffer.from(`Bearer ${secret}`);
  if (header.length !== expected.length || !timingSafeEqual(header, expected)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    return Response.json(await executeFeeReminders(await getDb(), { type: "scheduled" }), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("Scheduled fee reminder failed", error);
    return Response.json({ error: "Scheduled fee reminder failed" }, { status: 500 });
  }
}

export function HEAD() {
  return new Response(null, { status: 405 });
}

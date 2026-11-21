import { NextResponse } from "next/server";
import { getAuthenticatedAdmin } from "@/lib/auth";
import { getDb } from "@/lib/mongodb";
import { getDistinctActiveClasses } from "@/lib/announcements";

export async function GET() {
  try {
    const admin = await getAuthenticatedAdmin();
    if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const db = await getDb();
    const classes = await getDistinctActiveClasses(db);
    return NextResponse.json({ success: true, classes });
  } catch (error) {
    console.error("GET /api/admin/announcements/classes error:", error);
    return NextResponse.json({ error: "Failed to fetch classes" }, { status: 500 });
  }
}

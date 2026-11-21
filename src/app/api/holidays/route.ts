import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { getAuthenticatedAdmin } from "@/lib/auth";
import { holidaySchema } from "@/schemas";

export async function GET(req: Request) {
  try {
    const admin = await getAuthenticatedAdmin();
    if (!admin) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const date = searchParams.get("date");
    const month = searchParams.get("month");
    const batch = searchParams.get("batch");

    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: "Date must be YYYY-MM-DD" }, { status: 400 });
    }
    if (month && !/^\d{4}-\d{2}$/.test(month)) {
      return NextResponse.json({ error: "Month must be YYYY-MM" }, { status: 400 });
    }

    const db = await getDb();
    const query: Record<string, any> = { docType: "holiday" };

    if (date) query.date = date;
    if (month) query.date = new RegExp(`^${month}`);
    if (batch && batch !== "All") query.batch = { $in: ["ALL", batch] };

    const holidays = await db
      .collection("attendance")
      .find(query)
      .sort({ date: 1 })
      .toArray();

    return NextResponse.json(holidays);
  } catch (error: any) {
    console.error("GET holidays error:", error);
    return NextResponse.json({ error: "Failed to fetch holidays" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const admin = await getAuthenticatedAdmin();
    if (!admin) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const parsed = holidaySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 }
      );
    }

    const db = await getDb();
    const existing = await db.collection("attendance").findOne({
      docType: "holiday",
      date: parsed.data.date,
      batch: parsed.data.batch,
    });

    if (existing) {
      return NextResponse.json(
        { error: "A holiday already exists for this date and batch" },
        { status: 409 }
      );
    }

    const doc = {
      docType: "holiday",
      date: parsed.data.date,
      batch: parsed.data.batch,
      reason: parsed.data.reason,
      description: parsed.data.description || "",
      createdAt: new Date().toISOString(),
    };

    const result = await db.collection("attendance").insertOne(doc);

    return NextResponse.json({ success: true, _id: result.insertedId, ...doc }, { status: 201 });
  } catch (error: any) {
    console.error("POST holiday error:", error);
    return NextResponse.json({ error: "Failed to create holiday" }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const admin = await getAuthenticatedAdmin();
    if (!admin) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    const date = searchParams.get("date");
    const batch = searchParams.get("batch");

    if (!id && !date) {
      return NextResponse.json(
        { error: "Provide holiday id or date" },
        { status: 400 }
      );
    }

    const db = await getDb();
    const query: Record<string, any> = { docType: "holiday" };

    if (id) {
      if (!ObjectId.isValid(id)) {
        return NextResponse.json({ error: "Invalid holiday id" }, { status: 400 });
      }
      query._id = new ObjectId(id);
    } else {
      query.date = date;
      if (batch && batch !== "All") query.batch = batch;
    }

    const result = await db.collection("attendance").deleteOne(query);

    if (result.deletedCount === 0) {
      return NextResponse.json({ error: "Holiday not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("DELETE holiday error:", error);
    return NextResponse.json({ error: "Failed to delete holiday" }, { status: 500 });
  }
}

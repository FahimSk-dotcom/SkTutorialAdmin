import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { getAuthenticatedAdmin } from "@/lib/auth";
import { unifiedSettingsUpdateSchema } from "@/schemas";
import {
  DEFAULT_LOGO_URL,
  GENERAL_SETTINGS_FILTER,
  generalSettings,
  DEFAULT_QR_URL,
  DEFAULT_FEE_SETTINGS,
  DEFAULT_ATTENDANCE_SETTINGS,
  pickAttendanceSettings,
} from "@/lib/app-settings";

const DEFAULT_SETTINGS = DEFAULT_FEE_SETTINGS;

export async function GET() {
  try {
    const admin = await getAuthenticatedAdmin();
    if (!admin) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const db = await getDb();
    const settings = await generalSettings(db).findOne(GENERAL_SETTINGS_FILTER);
    const legacySettings = await db
      .collection("attendance")
      .findOne({ docType: "settings", key: "app_settings" });

    const attendanceSource =
      settings && settings.teacherName !== undefined ? settings : legacySettings;
    const attendanceSettings = pickAttendanceSettings(attendanceSource);

    return NextResponse.json({
      settings: {
        _id: settings?._id?.toString(),
        instituteName: settings?.instituteName || DEFAULT_SETTINGS.instituteName,
        logoUrl: settings?.logoUrl || DEFAULT_LOGO_URL,
        upiId: settings?.upiId || DEFAULT_SETTINGS.upiId,
        upiQrUrl: settings?.upiQrUrl || DEFAULT_QR_URL,
        receiptFooter: settings?.receiptFooter || DEFAULT_SETTINGS.receiptFooter,
      },
      attendanceSettings,
    });
  } catch (error: any) {
    console.error("GET /api/settings error:", error);
    return NextResponse.json({ error: "Failed to fetch settings" }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const admin = await getAuthenticatedAdmin();
    if (!admin) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const parsed = unifiedSettingsUpdateSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    const db = await getDb();
    const collection = generalSettings(db);
    const existing = await collection.findOne(GENERAL_SETTINGS_FILTER);
    const now = new Date();

    const feeData = {
      instituteName:
        parsed.data.instituteName ?? existing?.instituteName ?? DEFAULT_SETTINGS.instituteName,
      logoUrl: parsed.data.logoUrl ?? existing?.logoUrl ?? DEFAULT_LOGO_URL,
      upiId: parsed.data.upiId ?? existing?.upiId ?? DEFAULT_SETTINGS.upiId,
      upiQrUrl: parsed.data.upiQrUrl ?? existing?.upiQrUrl ?? DEFAULT_QR_URL,
      receiptFooter:
        parsed.data.receiptFooter ??
        existing?.receiptFooter ??
        DEFAULT_SETTINGS.receiptFooter,
    };

    const attendanceData = pickAttendanceSettings({
      ...DEFAULT_ATTENDANCE_SETTINGS,
      ...(existing || {}),
      ...parsed.data,
    });

    const updateData = {
      ...feeData,
      ...attendanceData,
      updatedAt: now,
    };

    if (existing) {
      await collection.updateOne({ _id: existing._id }, { $set: updateData });
    } else {
      await db.collection("settings").insertOne(updateData);
    }

    const legacyData = {
      docType: "settings",
      key: "app_settings",
      ...attendanceData,
      updatedAt: now,
    };

    const legacyExisting = await db
      .collection("attendance")
      .findOne({ docType: "settings", key: "app_settings" });

    if (legacyExisting) {
      await db
        .collection("attendance")
        .updateOne({ _id: legacyExisting._id }, { $set: legacyData });
    } else {
      await db.collection("attendance").insertOne(legacyData);
    }

    return NextResponse.json({
      success: true,
      message: "Settings updated successfully",
      settings: updateData,
      attendanceSettings: attendanceData,
    });
  } catch (error: any) {
    console.error("PUT /api/settings error:", error);
    return NextResponse.json({ error: "Failed to update settings" }, { status: 500 });
  }
}

import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { getDb } from "@/lib/mongodb";
import { parentBinary, parentJson, parentOptions } from "@/lib/parent-cors";
import {
  getAuthenticatedParent,
  parentAccessRestrictedBody,
  ParentAuthConfigError,
  verifyParentStudentAccess,
} from "@/lib/parent-auth";
import { loadFeeSettings } from "@/lib/app-settings";
import {
  buildReceiptContentDisposition,
  isValidReceiptNo,
  PARENT_RECEIPT_CONTENT_TYPE,
} from "@/lib/parent-fees";
import { buildReceiptPdf } from "@/lib/receipt-pdf";

export const runtime = "nodejs";

const PAYMENTS_COLLECTION = "payments";
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_EXTENSION_MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
};

interface ReceiptPaymentDocument {
  studentId?: unknown;
  receiptNo?: unknown;
  paymentDate?: unknown;
  month?: unknown;
  year?: unknown;
  amount?: unknown;
  mode?: unknown;
  createdAt?: unknown;
}

interface ImageAsset {
  buffer: Buffer;
  mimeType: string;
}

function toAbsolutePublicPath(assetPath: string): string | null {
  const normalized = assetPath.startsWith("/") ? assetPath.slice(1) : assetPath;
  const publicDir = path.resolve(process.cwd(), "public");
  const absolutePath = path.resolve(publicDir, normalized);
  const publicPrefix = `${publicDir}${path.sep}`;

  if (absolutePath !== publicDir && !absolutePath.startsWith(publicPrefix)) {
    return null;
  }

  return absolutePath;
}

async function loadLocalImageAsset(assetPath: string): Promise<ImageAsset | null> {
  if (!assetPath) return null;

  if (/^https?:\/\//i.test(assetPath)) {
    const response = await fetch(assetPath);
    if (!response.ok) return null;

    const mimeType = response.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
    if (!mimeType.startsWith("image/")) return null;

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength === 0 || buffer.byteLength > MAX_IMAGE_BYTES) {
      return null;
    }

    return { buffer, mimeType };
  }

  const absolutePath = toAbsolutePublicPath(assetPath);
  if (!absolutePath) return null;

  const extension = path.extname(absolutePath).toLowerCase();
  const mimeType = IMAGE_EXTENSION_MIME[extension];
  if (!mimeType) return null;

  const fileStat = await stat(absolutePath).catch(() => null);
  if (!fileStat?.isFile() || fileStat.size > MAX_IMAGE_BYTES) {
    return null;
  }

  const buffer = await readFile(absolutePath).catch(() => null);
  if (!buffer || buffer.byteLength === 0) return null;

  return { buffer, mimeType };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ receiptNo: string }> }
) {
  try {
    const auth = await getAuthenticatedParent(request, { requireActiveStudents: true });
    if (!auth.ok) {
      if (auth.restriction) {
        return parentJson(request, parentAccessRestrictedBody(auth.restriction), auth.status);
      }
      return parentJson(
        request,
        { success: false, error: auth.error ?? "Authentication failed" },
        auth.status
      );
    }

    const { receiptNo: rawReceiptNo } = await params;
    const receiptNo = decodeURIComponent(rawReceiptNo).trim();
    if (!isValidReceiptNo(receiptNo)) {
      return parentJson(
        request,
        { success: false, error: "Invalid receipt number" },
        400
      );
    }

    const db = await getDb();
    const payment = await db
      .collection(PAYMENTS_COLLECTION)
      .findOne({ receiptNo });

    if (!payment) {
      return parentJson(
        request,
        { success: false, error: "Receipt not found" },
        404
      );
    }

    const paymentRecord = payment as ReceiptPaymentDocument;
    const studentId = String(paymentRecord.studentId ?? "").trim();
    if (!studentId) {
      return parentJson(
        request,
        { success: false, error: "Receipt not found" },
        404
      );
    }

    // Enforce ownership and active status without leaking other parents' data.
    // If not linked or student missing -> 404. If linked but inactive/archived -> 403 STUDENT_INACTIVE.
    const access = await verifyParentStudentAccess(db, auth.parent, studentId);
    if (!access.ok) {
      if (access.failure.status === 404) {
        return parentJson(request, { success: false, error: "Receipt not found" }, 404);
      }
      return parentJson(request, access.failure.body, access.failure.status);
    }

    const student = access.student as any;
    const settings = await loadFeeSettings(db).catch(() => null);

    const [logo, qr] = await Promise.all([
      loadLocalImageAsset(settings?.logoUrl ?? ""),
      loadLocalImageAsset(settings?.upiQrUrl ?? ""),
    ]);

    const receiptPayment = {
      receiptNo: String(paymentRecord.receiptNo ?? receiptNo),
      studentId,
      paymentDate: String(paymentRecord.paymentDate ?? ""),
      month: Number(paymentRecord.month ?? 0),
      year: Number(paymentRecord.year ?? 0),
      amount: Number(paymentRecord.amount ?? 0),
      mode: paymentRecord.mode === "UPI" ? "UPI" : "Cash",
    };

    const pdf = await buildReceiptPdf({
      payment: receiptPayment,
      studentName: String(student.name ?? ""),
      studentClass: String(student.class ?? ""),
      instituteName: settings?.instituteName || "SK TUTORIALS",
      logoDataUrl: logo ? `data:${logo.mimeType};base64,${logo.buffer.toString("base64")}` : "",
      qrDataUrl: qr ? `data:${qr.mimeType};base64,${qr.buffer.toString("base64")}` : "",
    });

    const buffer = Buffer.from(pdf.output("arraybuffer"));

    return parentBinary(
      request,
      buffer,
      {
        "Content-Type": PARENT_RECEIPT_CONTENT_TYPE,
        "Content-Disposition": buildReceiptContentDisposition(receiptPayment.receiptNo),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
      200
    );
  } catch (error) {
    if (error instanceof ParentAuthConfigError) {
      console.error(
        "GET /api/parent/receipt/[receiptNo] configuration error:",
        error instanceof Error ? error.message : String(error)
      );
      return parentJson(
        request,
        { success: false, error: "Parent service is temporarily unavailable" },
        503
      );
    }

    console.error(
      "GET /api/parent/receipt/[receiptNo] failed:",
      error instanceof Error ? `${error.name}: ${error.message}` : String(error)
    );
    return parentJson(
      request,
      { success: false, error: "Unable to load receipt right now" },
      500
    );
  }
}

export function OPTIONS(request: Request) {
  return parentOptions(request);
}

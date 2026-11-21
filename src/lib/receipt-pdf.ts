import { getMonthName } from "./due-calculator.ts";
import { cleanClassDisplay } from "./format.ts";
import { numberToWordsRupees } from "./amount-in-words.ts";

export interface ReceiptPdfPayment {
  receiptNo: string;
  studentId: string;
  paymentDate: string;
  month: number;
  year: number;
  amount: number;
  mode: string;
}

export interface ReceiptPdfInput {
  payment: ReceiptPdfPayment;
  studentName?: string;
  studentClass?: string;
  instituteName?: string;
  logoDataUrl?: string;
  qrDataUrl?: string;
}

function imageFormat(
  dataUrl: string,
  fallback: "PNG" | "JPEG"
): "PNG" | "JPEG" {
  if (dataUrl.startsWith("data:image/png")) return "PNG";
  if (
    dataUrl.startsWith("data:image/jpeg") ||
    dataUrl.startsWith("data:image/jpg")
  ) {
    return "JPEG";
  }
  return fallback;
}

/**
 * Builds the official SK Tutorials tuition fee receipt. This is the same
 * vector layout used by the admin ReceiptModal so parent downloads and admin
 * print/share receipts stay visually identical.
 */
export async function buildReceiptPdf(
  input: ReceiptPdfInput
): Promise<import("jspdf").jsPDF> {
  const jspdfModule = (await import("jspdf")) as any;
  const JsPDF =
    jspdfModule.jsPDF ??
    jspdfModule.default?.jsPDF ??
    jspdfModule.default;

  if (typeof JsPDF !== "function") {
    throw new Error("jsPDF could not be loaded");
  }

  const {
    payment,
    instituteName = "SK TUTORIALS",
    logoDataUrl = "",
    qrDataUrl = "",
  } = input;

  const accurateStudentName = (input.studentName || "").trim() || "Student";
  const cleanClass = cleanClassDisplay(input.studentClass || "");
  const displayClass =
    cleanClass && cleanClass !== "-" ? `Class ${cleanClass}` : "Class 10";

  const py = payment.year || 2026;
  const academicYear = `${py}-${String(py + 1).slice(-2)}`;

  const pdf = new JsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
  });

  const primaryBlue = [13, 59, 102];
  const goldAccent = [199, 133, 0];
  const emeraldGreen = [4, 120, 87];
  const bgLightBlue = [240, 249, 255];
  const bgLightGray = [248, 250, 252];
  const textDark = [15, 23, 42];
  const textMuted = [100, 116, 139];

  // Outer Frame
  pdf.setDrawColor(primaryBlue[0], primaryBlue[1], primaryBlue[2]);
  pdf.setLineWidth(1.2);
  pdf.roundedRect(8, 8, 194, 280, 5, 5, "S");

  // Header Logo
  if (logoDataUrl) {
    try {
      pdf.addImage(logoDataUrl, imageFormat(logoDataUrl, "PNG"), 14, 14, 22, 22);
    } catch (e) {}
  }

  // Institute Name & Subtitle
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(22);
  pdf.setTextColor(primaryBlue[0], primaryBlue[1], primaryBlue[2]);
  pdf.text(instituteName, 105, 22, { align: "center" });

  pdf.setFontSize(10);
  pdf.setTextColor(goldAccent[0], goldAccent[1], goldAccent[2]);
  pdf.text("--- Excellence in Education ---", 105, 28, { align: "center" });

  pdf.setFontSize(8);
  pdf.setTextColor(textMuted[0], textMuted[1], textMuted[2]);
  pdf.setFont("helvetica", "normal");
  pdf.text("Goregaon (E), Mumbai  |  +91 89769 46230", 105, 33, {
    align: "center",
  });
  pdf.text(
    "https://sk-tutorials.vercel.app/  |  s.k.tutorials126@gmail.com",
    105,
    37,
    { align: "center" }
  );

  // Top-Right PAID Badge Stamp
  pdf.setDrawColor(emeraldGreen[0], emeraldGreen[1], emeraldGreen[2]);
  pdf.setFillColor(236, 253, 245);
  pdf.circle(180, 24, 10, "FD");
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(9);
  pdf.setTextColor(emeraldGreen[0], emeraldGreen[1], emeraldGreen[2]);
  pdf.text("PAID", 180, 24.5, { align: "center" });
  pdf.setFontSize(7);
  pdf.text("* * *", 180, 28, { align: "center" });

  // Separator Line
  pdf.setDrawColor(226, 232, 240);
  pdf.line(14, 42, 196, 42);

  // Official Title Ribbon
  pdf.setFillColor(241, 245, 249);
  pdf.setDrawColor(203, 213, 225);
  pdf.roundedRect(60, 46, 90, 7, 3.5, 3.5, "FD");
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(9);
  pdf.setTextColor(primaryBlue[0], primaryBlue[1], primaryBlue[2]);
  pdf.text("--- OFFICIAL TUITION FEE RECEIPT ---", 105, 51, {
    align: "center",
  });

  // Meta Bar
  pdf.setFillColor(bgLightBlue[0], bgLightBlue[1], bgLightBlue[2]);
  pdf.setDrawColor(186, 230, 253);
  pdf.roundedRect(14, 57, 182, 12, 3, 3, "FD");

  pdf.setFontSize(8);
  pdf.setTextColor(textMuted[0], textMuted[1], textMuted[2]);
  pdf.text("Receipt No.", 20, 61);
  pdf.setFontSize(10);
  pdf.setTextColor(primaryBlue[0], primaryBlue[1], primaryBlue[2]);
  pdf.text(payment.receiptNo, 20, 66);

  pdf.setFontSize(8);
  pdf.setTextColor(textMuted[0], textMuted[1], textMuted[2]);
  pdf.text("Date", 190, 61, { align: "right" });
  pdf.setFontSize(10);
  pdf.setTextColor(textDark[0], textDark[1], textDark[2]);
  pdf.text(payment.paymentDate, 190, 66, { align: "right" });

  // Student Info Card (Left)
  pdf.setDrawColor(226, 232, 240);
  pdf.setFillColor(bgLightGray[0], bgLightGray[1], bgLightGray[2]);
  pdf.roundedRect(14, 73, 88, 42, 3, 3, "FD");

  pdf.setFillColor(primaryBlue[0], primaryBlue[1], primaryBlue[2]);
  pdf.roundedRect(14, 73, 88, 7, 3, 3, "F");
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(8);
  pdf.setTextColor(255, 255, 255);
  pdf.text("STUDENT INFORMATION", 18, 78);

  pdf.setFontSize(8);
  pdf.setTextColor(textMuted[0], textMuted[1], textMuted[2]);
  pdf.setFont("helvetica", "normal");
  pdf.text("Student Name :", 18, 86);
  pdf.setFont("helvetica", "bold");
  pdf.setTextColor(textDark[0], textDark[1], textDark[2]);
  pdf.text(accurateStudentName, 98, 86, { align: "right" });

  pdf.setFont("helvetica", "normal");
  pdf.setTextColor(textMuted[0], textMuted[1], textMuted[2]);
  pdf.text("Class :", 18, 93);
  pdf.setFont("helvetica", "bold");
  pdf.setTextColor(textDark[0], textDark[1], textDark[2]);
  pdf.text(displayClass, 98, 93, { align: "right" });

  pdf.setFont("helvetica", "normal");
  pdf.setTextColor(textMuted[0], textMuted[1], textMuted[2]);
  pdf.text("Student ID :", 18, 100);
  pdf.setFont("helvetica", "bold");
  pdf.setTextColor(textDark[0], textDark[1], textDark[2]);
  pdf.text(payment.studentId, 98, 100, { align: "right" });

  pdf.setFont("helvetica", "normal");
  pdf.setTextColor(textMuted[0], textMuted[1], textMuted[2]);
  pdf.text("Academic Year :", 18, 107);
  pdf.setFont("helvetica", "bold");
  pdf.setTextColor(textDark[0], textDark[1], textDark[2]);
  pdf.text(academicYear, 98, 107, { align: "right" });

  // Payment Info Card (Right)
  pdf.setDrawColor(226, 232, 240);
  pdf.setFillColor(bgLightGray[0], bgLightGray[1], bgLightGray[2]);
  pdf.roundedRect(108, 73, 88, 42, 3, 3, "FD");

  pdf.setFillColor(primaryBlue[0], primaryBlue[1], primaryBlue[2]);
  pdf.roundedRect(108, 73, 88, 7, 3, 3, "F");
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(8);
  pdf.setTextColor(255, 255, 255);
  pdf.text("PAYMENT INFORMATION", 112, 78);

  pdf.setFontSize(8);
  pdf.setTextColor(textMuted[0], textMuted[1], textMuted[2]);
  pdf.setFont("helvetica", "normal");
  pdf.text("Fee Month :", 112, 86);
  pdf.setFont("helvetica", "bold");
  pdf.setTextColor(textDark[0], textDark[1], textDark[2]);
  pdf.text(`${getMonthName(payment.month)} ${payment.year}`, 192, 86, {
    align: "right",
  });

  pdf.setFont("helvetica", "normal");
  pdf.setTextColor(textMuted[0], textMuted[1], textMuted[2]);
  pdf.text("Amount Paid :", 112, 93);
  pdf.setFont("helvetica", "bold");
  pdf.setTextColor(emeraldGreen[0], emeraldGreen[1], emeraldGreen[2]);
  pdf.text(`Rs. ${payment.amount}`, 192, 93, { align: "right" });

  pdf.setFont("helvetica", "normal");
  pdf.setTextColor(textMuted[0], textMuted[1], textMuted[2]);
  pdf.text("Payment Mode :", 112, 100);
  pdf.setFont("helvetica", "bold");
  pdf.setTextColor(textDark[0], textDark[1], textDark[2]);
  pdf.text(payment.mode, 192, 100, { align: "right" });

  pdf.setFont("helvetica", "normal");
  pdf.setTextColor(textMuted[0], textMuted[1], textMuted[2]);
  pdf.text("Payment Status :", 112, 107);
  pdf.setFont("helvetica", "bold");
  pdf.setTextColor(emeraldGreen[0], emeraldGreen[1], emeraldGreen[2]);
  pdf.text("Paid", 192, 107, { align: "right" });

  // Amount Received Box
  pdf.setFillColor(236, 253, 245);
  pdf.setDrawColor(110, 231, 183);
  pdf.roundedRect(14, 120, 182, 24, 4, 4, "FD");

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(8);
  pdf.setTextColor(6, 95, 70);
  pdf.text("AMOUNT RECEIVED", 105, 126, { align: "center" });

  pdf.setFontSize(22);
  pdf.setTextColor(emeraldGreen[0], emeraldGreen[1], emeraldGreen[2]);
  pdf.text(`Rs. ${payment.amount}`, 105, 136, { align: "center" });

  pdf.setFontSize(8);
  pdf.setTextColor(51, 65, 85);
  pdf.setFont("helvetica", "normal");
  pdf.text(`(${numberToWordsRupees(payment.amount)})`, 105, 141, {
    align: "center",
  });

  // Collection Signature & QR Section
  pdf.setFillColor(bgLightGray[0], bgLightGray[1], bgLightGray[2]);
  pdf.setDrawColor(226, 232, 240);
  pdf.roundedRect(14, 148, 88, 24, 3, 3, "FD");

  pdf.setFontSize(7);
  pdf.setTextColor(textMuted[0], textMuted[1], textMuted[2]);
  pdf.text("Collected By", 18, 154);

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(10);
  pdf.setTextColor(textDark[0], textDark[1], textDark[2]);
  pdf.text("Prof. Fahim Sir", 18, 160);

  pdf.setFontSize(7);
  pdf.setTextColor(textMuted[0], textMuted[1], textMuted[2]);
  pdf.setFont("helvetica", "normal");
  pdf.text("SK Tutorials", 18, 165);

  pdf.setFont("times", "bolditalic");
  pdf.setFontSize(12);
  pdf.setTextColor(49, 46, 129);
  pdf.text("Fahim Sir", 95, 162, { align: "right" });

  // Scan to Pay QR
  pdf.setFillColor(bgLightBlue[0], bgLightBlue[1], bgLightBlue[2]);
  pdf.setDrawColor(186, 230, 253);
  pdf.roundedRect(108, 148, 88, 24, 3, 3, "FD");

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(8);
  pdf.setTextColor(primaryBlue[0], primaryBlue[1], primaryBlue[2]);
  pdf.text("Thank you for choosing SK Tutorials.", 112, 155);

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(6.5);
  pdf.setTextColor(textMuted[0], textMuted[1], textMuted[2]);
  pdf.text("Your trust and support motivate us to", 112, 160);
  pdf.text("deliver the best education.", 112, 163);

  if (qrDataUrl) {
    try {
      pdf.addImage(qrDataUrl, imageFormat(qrDataUrl, "JPEG"), 175, 150, 16, 16);
    } catch (e) {}
  }
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(6);
  pdf.setTextColor(primaryBlue[0], primaryBlue[1], primaryBlue[2]);
  pdf.text("Scan to Pay", 183, 169, { align: "center" });

  // Bottom Banner
  pdf.setFillColor(primaryBlue[0], primaryBlue[1], primaryBlue[2]);
  pdf.roundedRect(14, 176, 182, 10, 3, 3, "F");

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(8);
  pdf.setTextColor(255, 255, 255);
  pdf.text(
    "Quality Education   |   Better Learning   |   Bright Future",
    105,
    181.5,
    { align: "center" }
  );

  // Footer Text
  pdf.setFont("helvetica", "italic");
  pdf.setFontSize(7.5);
  pdf.setTextColor(100, 116, 139);
  pdf.text("Created by Prof. Fahim Sir  |  SK Tutorials", 105, 192, {
    align: "center",
  });

  return pdf;
}

"use client";

import React, { useEffect, useState, use } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  User,
  Phone,
  Calendar,
  CreditCard,
  Printer,
  Users,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Receipt,
  ClipboardCheck,
  XCircle,
  Shield,
  KeyRound,
  Eye,
  EyeOff,
  Loader2,
} from "lucide-react";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { CollectFeeModal } from "@/components/students/CollectFeeModal";
import { ReceiptModal } from "@/components/payments/ReceiptModal";
import { Student, Payment, DynamicDueResult } from "@/types";
import { getMonthName } from "@/lib/due-calculator";
import { isArchivedStudent } from "@/lib/student-archive";
import { toast } from "sonner";

export default function StudentDetailsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  // Modals
  const [isCollectFeeOpen, setIsCollectFeeOpen] = useState(false);
  const [receiptPayment, setReceiptPayment] = useState<Payment | null>(null);

  // Parent account management
  const [parentAccount, setParentAccount] = useState<any>(null);
  const [parentAccountLoading, setParentAccountLoading] = useState(false);
  const [parentAccountError, setParentAccountError] = useState<string | null>(null);
  const [isResetPasswordOpen, setIsResetPasswordOpen] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmNewPassword, setShowConfirmNewPassword] = useState(false);
  const [resettingPassword, setResettingPassword] = useState(false);

  const fetchStudentData = async () => {
    try {
      const res = await fetch(`/api/students/${id}`);
      const json = await res.json();
      if (res.ok) {
        setData(json);
      }
    } catch (err) {
      console.error("Student detail fetch error:", err);
    } finally {
      setLoading(false);
    }
  };

  const fetchParentAccount = async (mobile: string) => {
    if (!mobile) return;
    setParentAccountLoading(true);
    setParentAccountError(null);
    try {
      const res = await fetch(`/api/admin/parents/lookup?mobile=${encodeURIComponent(mobile)}`, {
        cache: "no-store",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setParentAccount(null);
        setParentAccountError(json?.error || "Failed to load parent account details");
        return;
      }
      setParentAccount(json);
    } catch (err) {
      setParentAccount(null);
      setParentAccountError("Network error while loading parent account details");
    } finally {
      setParentAccountLoading(false);
    }
  };

  useEffect(() => {
    fetchStudentData();
  }, [id]);

  useEffect(() => {
    if (data?.student?.parentMobile) {
      fetchParentAccount(data.student.parentMobile);
    }
  }, [data?.student?.parentMobile]);

  const handleResetParentPassword = async () => {
    if (!parentAccount?.parent?._id) {
      toast.error("Parent account not found");
      return;
    }
    if (newPassword.length < 8) {
      toast.error("Password must be at least 8 characters");
      return;
    }
    if (newPassword !== confirmNewPassword) {
      toast.error("Passwords do not match");
      return;
    }
    const confirmed = window.confirm(
      "Are you sure you want to reset this parent account password? This will update login credentials for all students linked to this parent account."
    );
    if (!confirmed) return;

    setResettingPassword(true);
    try {
      const res = await fetch(`/api/admin/parents/${parentAccount.parent._id}/password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studentId: data.student.studentId,
          newPassword,
          confirmPassword: confirmNewPassword,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(json?.error || "Failed to reset parent password");
        return;
      }
      toast.success(json?.message || "Parent password updated successfully");
      setIsResetPasswordOpen(false);
      setNewPassword("");
      setConfirmNewPassword("");
      setShowNewPassword(false);
      setShowConfirmNewPassword(false);
      fetchParentAccount(data.student.parentMobile);
    } catch (err) {
      toast.error("Failed to reset parent password");
    } finally {
      setResettingPassword(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-10 w-32 bg-card rounded-2xl" />
        <div className="h-48 bg-card rounded-3xl" />
        <div className="h-64 bg-card rounded-3xl" />
      </div>
    );
  }

  if (!data || !data.student) {
    return (
      <div className="text-center py-12">
        <p className="font-bold text-lg">Student not found</p>
        <Link href="/students" className="text-indigo-600 font-semibold text-xs hover:underline mt-2 block">
          Back to Students
        </Link>
      </div>
    );
  }

  const student: Student = data.student;
  const payments: Payment[] = data.payments || [];
  const dueInfo: DynamicDueResult = data.dueInfo;
  const siblings: any[] = data.siblings || [];
  const archived = isArchivedStudent(student);
  const attendanceSummary = data.attendanceSummary || null;
  const attendanceRecords: any[] = data.attendanceRecords || [];

  return (
    <div className="space-y-6">
      {/* Back Button */}
      <div>
        <Link
          href="/students"
          className="inline-flex items-center gap-1.5 text-xs font-bold text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Students Directory</span>
        </Link>
      </div>

      {archived && (
        <div className="p-4 rounded-3xl bg-amber-500/10 border border-amber-500/30 text-amber-800 dark:text-amber-300 text-xs flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-bold">This student is archived.</p>
            <p className="text-[11px] text-amber-700 dark:text-amber-400 mt-0.5">
              New fee collection is disabled. Payment history and receipts remain available.
              {student.archivedAt
                ? ` Archived on ${student.archivedAt.split("T")[0]}.`
                : ""}
            </p>
          </div>
        </div>
      )}

      {/* Student Main Profile Header */}
      <div className="bg-card border border-border p-6 rounded-3xl shadow-soft flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="flex items-start gap-4">
          <div className="w-14 h-14 rounded-2xl bg-indigo-600 text-white flex items-center justify-center font-black text-xl shadow-md shadow-indigo-500/20">
            {student.name.charAt(0)}
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-extrabold tracking-tight">{student.name}</h1>
              <StatusBadge status={archived ? "Inactive" : dueInfo.status} size="sm" />
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              ID: <span className="font-bold text-foreground">{student.studentId}</span> •{" "}
              <span className="font-bold text-foreground">{student.class}</span>
              {student.effectiveBatch && student.effectiveBatch !== "Unassigned" ? (
                <>
                  {" "}• Batch{" "}
                  <span className="font-bold text-foreground">{student.effectiveBatch}</span>
                </>
              ) : null}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Admission Date: {student.admissionDate ? student.admissionDate.split("T")[0] : "-"}
            </p>
          </div>
        </div>

        {!archived && (
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => setIsCollectFeeOpen(true)}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-sm transition-all active:scale-95"
            >
              <CreditCard className="w-4 h-4" />
              <span>Collect Fee</span>
            </button>
          </div>
        )}
      </div>

      {/* Details & Due Breakdown */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Student Information Card */}
        <div className="bg-card border border-border p-5 rounded-3xl shadow-soft space-y-4">
          <h2 className="font-bold text-sm text-foreground border-b border-border pb-2">
            Student Information
          </h2>

          <div className="space-y-3 text-xs">
            <div>
              <span className="text-muted-foreground block text-[10px]">Monthly Tuition Fee:</span>
              <span className="font-extrabold text-sm text-indigo-600 dark:text-indigo-400">
                ₹{student.monthlyFee} / month
              </span>
            </div>

            <div>
              <span className="text-muted-foreground block text-[10px]">Parent / Guardian Name:</span>
              <span className="font-bold text-foreground">{student.parentName}</span>
            </div>

            <div>
              <span className="text-muted-foreground block text-[10px]">Parent Mobile Number:</span>
              <span className="font-bold text-foreground">{student.parentMobile}</span>
            </div>

            {student.alternateMobile && (
              <div>
                <span className="text-muted-foreground block text-[10px]">Alternate Contact:</span>
                <span className="font-bold text-foreground">{student.alternateMobile}</span>
              </div>
            )}

            {student.address && (
              <div>
                <span className="text-muted-foreground block text-[10px]">Address:</span>
                <span className="font-medium text-foreground">{student.address}</span>
              </div>
            )}

            {student.remarks && (
              <div>
                <span className="text-muted-foreground block text-[10px]">Remarks:</span>
                <span className="font-medium text-foreground">{student.remarks}</span>
              </div>
            )}
          </div>
        </div>

        {/* Dynamic Pending Fee Status Card */}
        <div className="bg-card border border-border p-5 rounded-3xl shadow-soft space-y-4 md:col-span-2">
          <div className="flex items-center justify-between border-b border-border pb-2">
            <h2 className="font-bold text-sm text-foreground">Dynamic Due Status</h2>
            <StatusBadge status={archived ? "Inactive" : dueInfo.status} size="sm" />
          </div>

          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="p-3 rounded-2xl bg-muted/40 border border-border/60">
              <span className="text-muted-foreground text-[10px] block font-semibold">
                Total Pending Months
              </span>
              <span className="text-xl font-extrabold text-foreground">{dueInfo.totalDueMonths}</span>
            </div>

            <div className="p-3 rounded-2xl bg-rose-500/10 border border-rose-500/20">
              <span className="text-rose-600 dark:text-rose-400 text-[10px] block font-semibold">
                Total Pending Amount
              </span>
              <span className="text-xl font-black text-rose-600 dark:text-rose-400">
                ₹{dueInfo.totalPendingAmount}
              </span>
            </div>
          </div>

          {/* Pending Month Breakdown List */}
          <div>
            <h3 className="text-xs font-bold text-muted-foreground mb-2">Unpaid Pending Months:</h3>
            {dueInfo.pendingMonths.length === 0 ? (
              <div className="p-3 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-xs font-semibold flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4" />
                <span>All tuition fees up to date!</span>
              </div>
            ) : (
              <div className="space-y-2">
                {dueInfo.pendingMonths.map((pm) => (
                  <div
                    key={`${pm.year}-${pm.month}`}
                    className="flex items-center justify-between p-3 rounded-2xl bg-muted/40 border border-border/60 text-xs"
                  >
                    <div>
                      <span className="font-bold text-foreground">{pm.monthName}</span>
                      <span className="text-[10px] text-muted-foreground block">
                        Due Date: {pm.dueDate}
                      </span>
                    </div>

                    <div className="text-right">
                      <span className="font-extrabold text-rose-600 dark:text-rose-400 block">
                        ₹{pm.amount}
                      </span>
                      {pm.isDueToday ? (
                        <span className="text-[10px] font-bold text-amber-500">Due Today</span>
                      ) : (
                        <span className="text-[10px] font-bold text-rose-500">Overdue</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Parent Account Management */}
      <div className="bg-card border border-border p-5 rounded-3xl shadow-soft space-y-4">
        <div className="flex items-center justify-between border-b border-border pb-2">
          <h2 className="font-bold text-sm text-foreground flex items-center gap-2">
            <Shield className="w-4 h-4 text-indigo-500" />
            <span>PARENT ACCOUNT MANAGEMENT</span>
          </h2>
          {parentAccount?.parent?._id && (
            <button
              onClick={() => setIsResetPasswordOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold transition-all"
            >
              <KeyRound className="w-3.5 h-3.5" />
              <span>Reset Parent Password</span>
            </button>
          )}
        </div>

        {parentAccountLoading ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Loading parent account details...</span>
          </div>
        ) : parentAccountError ? (
          <div className="p-3 rounded-2xl border border-rose-500/30 bg-rose-500/10 text-xs text-rose-700 dark:text-rose-300 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" />
            <span>{parentAccountError}</span>
          </div>
        ) : !parentAccount?.found ? (
          <div className="p-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 text-xs text-amber-800 dark:text-amber-300 space-y-1">
            <p className="font-semibold">No parent account found for this mobile number.</p>
            <p className="text-[11px]">A parent account may be created during a new admission for this mobile number through the approved flow.</p>
          </div>
        ) : (
          <div className="space-y-3 text-xs">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <span className="text-muted-foreground block text-[10px]">Parent Name</span>
                <span className="font-bold text-foreground">{parentAccount.parent?.parentName || "-"}</span>
              </div>
              <div>
                <span className="text-muted-foreground block text-[10px]">Parent Mobile Number</span>
                <span className="font-bold text-foreground">{parentAccount.parent?.parentMobile || student.parentMobile}</span>
              </div>
              <div>
                <span className="text-muted-foreground block text-[10px]">Parent Account Status</span>
                <span className="font-bold text-foreground">{parentAccount.parent?.isActive ? "Active" : "Inactive"}</span>
              </div>
              <div>
                <span className="text-muted-foreground block text-[10px]">Number of Linked Active Students</span>
                <span className="font-bold text-foreground">{(parentAccount.activeStudents || []).length}</span>
              </div>
              <div>
                <span className="text-muted-foreground block text-[10px]">Password Configuration Status</span>
                <span className="font-bold text-foreground">{parentAccount.parent?.hasPassword ? "Configured" : "Not Configured"}</span>
              </div>
            </div>

            {(parentAccount.activeStudents || []).length > 1 && (
              <div className="p-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300">
                Changing this password will update the login credentials for all students linked to this parent account.
              </div>
            )}
            {parentAccount.hasArchivedOnly && (
              <div className="p-3 rounded-2xl border border-border bg-muted/30 text-muted-foreground">
                This parent account currently has archived students only.
              </div>
            )}
            {parentAccount.hasMixedActiveArchived && (
              <div className="p-3 rounded-2xl border border-border bg-muted/30 text-muted-foreground">
                This parent account has both active and archived linked students.
              </div>
            )}
          </div>
        )}
      </div>

      {/* Attendance Summary & History */}
      <div className="bg-card border border-border p-5 rounded-3xl shadow-soft space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-extrabold text-base flex items-center gap-2">
            <ClipboardCheck className="w-4.5 h-4.5 text-indigo-500" />
            <span>Attendance Overview</span>
          </h2>
          {student.effectiveBatch && student.effectiveBatch !== "Unassigned" ? (
            <Link
              href={`/attendance?batch=${student.effectiveBatch}`}
              className="text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:underline"
            >
              Open Attendance
            </Link>
          ) : null}
        </div>

        {!attendanceSummary ? (
          <p className="text-xs text-muted-foreground text-center py-4">
            No attendance data available for this student.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="p-3 rounded-2xl bg-indigo-500/10 border border-indigo-500/20">
                <span className="text-[10px] font-bold text-indigo-600 block">
                  Overall Attendance
                </span>
                <span className="text-xl font-black text-indigo-600">
                  {attendanceSummary.percentage}%
                </span>
              </div>
              <div className="p-3 rounded-2xl bg-emerald-500/10 border border-emerald-500/20">
                <span className="text-[10px] font-bold text-emerald-600 block">
                  Present / Conducted
                </span>
                <span className="text-xl font-black text-emerald-600">
                  {attendanceSummary.presentCount}/{attendanceSummary.totalConducted}
                </span>
              </div>
              <div className="p-3 rounded-2xl bg-rose-500/10 border border-rose-500/20">
                <span className="text-[10px] font-bold text-rose-600 block">
                  Current Month
                </span>
                <span className="text-xl font-black text-rose-600">
                  {attendanceSummary.currentMonthPercentage}%
                </span>
              </div>
              <div className="p-3 rounded-2xl bg-amber-500/10 border border-amber-500/20">
                <span className="text-[10px] font-bold text-amber-700 dark:text-amber-300 block">
                  Consecutive Absences
                </span>
                <span className="text-xl font-black text-amber-700 dark:text-amber-300">
                  {attendanceSummary.consecutiveAbsences}
                </span>
              </div>
            </div>

            <div>
              <h3 className="text-xs font-bold text-muted-foreground mb-2">
                Recent Attendance History
              </h3>
              {attendanceRecords.length === 0 ? (
                <div className="text-center py-6 text-muted-foreground border border-dashed border-border rounded-2xl text-xs">
                  No attendance records yet.
                </div>
              ) : (
                <div className="divide-y divide-border/60 border border-border rounded-2xl overflow-hidden">
                  {attendanceRecords.slice(0, 12).map((rec) => (
                    <div
                      key={rec._id || `${rec.date}-${rec.studentId}`}
                      className="p-3 flex items-center justify-between text-xs"
                    >
                      <div>
                        <span className="font-bold text-foreground">{rec.date}</span>
                        <span className="ml-2 px-2 py-0.5 rounded-md bg-indigo-500/10 text-indigo-600 font-bold text-[10px]">
                          {rec.batch} Batch
                        </span>
                      </div>
                      {rec.status === "present" ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-emerald-500/10 text-emerald-600 font-black text-[10px]">
                          <CheckCircle2 className="w-3 h-3" />
                          Present
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-rose-500/10 text-rose-600 font-black text-[10px]">
                          <XCircle className="w-3 h-3" />
                          Absent
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Sibling Group Family Card */}
      {siblings.length > 0 && (
        <div className="bg-card border border-border p-5 rounded-3xl shadow-soft space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-sm flex items-center gap-2">
              <Users className="w-4 h-4 text-indigo-500" />
              <span>Family Siblings (Same Mobile: {student.parentMobile})</span>
            </h2>
            <span className="text-xs text-muted-foreground font-medium">
              Family siblings share the same parent contact
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
            {siblings.map((sib: any) => (
              <div
                key={sib.student._id}
                className="p-3 rounded-2xl bg-muted/30 border border-border/60 flex items-center justify-between"
              >
                <div>
                  <Link
                    href={`/students/${sib.student._id}`}
                    className="font-bold text-xs hover:text-indigo-600"
                  >
                    {sib.student.name}
                  </Link>
                  <p className="text-[10px] text-muted-foreground">
                    Class {sib.student.class} • Fee: ₹{sib.student.monthlyFee}
                  </p>
                </div>

                <div className="text-right">
                  <StatusBadge
                    status={
                      isArchivedStudent(sib.student) ? "Inactive" : sib.dueInfo.status
                    }
                    size="sm"
                  />
                  {!isArchivedStudent(sib.student) && (
                    <p className="text-[10px] text-rose-500 font-bold mt-0.5">
                      Due: ₹{sib.dueInfo.totalPendingAmount}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Payment History Ledger */}
      <div className="bg-card border border-border p-5 rounded-3xl shadow-soft space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-extrabold text-base flex items-center gap-2">
            <Receipt className="w-4.5 h-4.5 text-indigo-500" />
            <span>Payment History Ledger</span>
          </h2>
          <span className="text-xs text-muted-foreground font-semibold">
            {payments.length} payment(s) recorded
          </span>
        </div>

        {payments.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground border border-dashed border-border rounded-2xl text-xs">
            No payments collected yet for this student.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-border bg-muted/40 font-semibold text-muted-foreground uppercase tracking-wider">
                  <th className="p-3">Receipt No</th>
                  <th className="p-3">Paid Date</th>
                  <th className="p-3">Fee Month</th>
                  <th className="p-3">Amount</th>
                  <th className="p-3">Mode</th>
                  <th className="p-3 text-right">Receipt</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {payments.map((p) => (
                  <tr key={p._id} className="hover:bg-muted/30 transition-colors">
                    <td className="p-3 font-bold text-foreground">{p.receiptNo}</td>
                    <td className="p-3 text-muted-foreground">{p.paymentDate}</td>
                    <td className="p-3 font-semibold text-foreground">
                      {getMonthName(p.month)} {p.year}
                    </td>
                    <td className="p-3 font-extrabold text-emerald-600 dark:text-emerald-400">
                      ₹{p.amount}
                    </td>
                    <td className="p-3 font-medium text-foreground">{p.mode}</td>
                    <td className="p-3 text-right">
                      <button
                        onClick={() => setReceiptPayment(p)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-indigo-500/10 text-indigo-600 font-semibold hover:bg-indigo-500/20 transition-all"
                      >
                        <Printer className="w-3.5 h-3.5" />
                        <span>Print</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modals */}
      <CollectFeeModal
        isOpen={isCollectFeeOpen}
        onClose={() => setIsCollectFeeOpen(false)}
        onSuccess={(payment) => {
          fetchStudentData();
          setReceiptPayment(payment);
        }}
        student={student}
      />

      <ReceiptModal
        isOpen={!!receiptPayment}
        onClose={() => setReceiptPayment(null)}
        payment={receiptPayment}
      />

      {isResetPasswordOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="w-full max-w-md bg-card text-card-foreground border border-border rounded-3xl p-6 shadow-elevated relative">
            <button
              onClick={() => !resettingPassword && setIsResetPasswordOpen(false)}
              className="absolute top-4 right-4 p-1.5 rounded-full text-muted-foreground hover:bg-muted transition-colors"
              disabled={resettingPassword}
            >
              <XCircle className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-2xl bg-indigo-600/10 text-indigo-600 flex items-center justify-center">
                <KeyRound className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-lg">Reset Parent Password</h3>
                <p className="text-xs text-muted-foreground">Set a new password for this parent account</p>
              </div>
            </div>

            {(parentAccount?.activeStudents || []).length > 1 && (
              <div className="mb-4 p-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 text-xs text-amber-800 dark:text-amber-300">
                Changing this password will update the login credentials for all students linked to this parent account.
              </div>
            )}

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold mb-1">New Password *</label>
                <div className="relative">
                  <input
                    type={showNewPassword ? "text" : "password"}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="w-full px-3.5 py-2 pr-10 text-sm bg-muted/50 border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                    placeholder="Minimum 8 characters"
                    autoComplete="new-password"
                  />
                  <button type="button" onClick={() => setShowNewPassword((v) => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground">
                    {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1">Confirm New Password *</label>
                <div className="relative">
                  <input
                    type={showConfirmNewPassword ? "text" : "password"}
                    value={confirmNewPassword}
                    onChange={(e) => setConfirmNewPassword(e.target.value)}
                    className="w-full px-3.5 py-2 pr-10 text-sm bg-muted/50 border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                    placeholder="Re-enter password"
                    autoComplete="new-password"
                  />
                  <button type="button" onClick={() => setShowConfirmNewPassword((v) => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground">
                    {showConfirmNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground">You will be asked to confirm before saving.</p>
            </div>

            <div className="flex items-center justify-end gap-2 pt-4 mt-4 border-t border-border">
              <button
                type="button"
                onClick={() => setIsResetPasswordOpen(false)}
                disabled={resettingPassword}
                className="px-4 py-2 text-xs font-semibold text-muted-foreground hover:bg-muted rounded-xl transition-all"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleResetParentPassword}
                disabled={resettingPassword}
                className="inline-flex items-center gap-1.5 px-5 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl shadow-sm transition-all active:scale-95 disabled:opacity-50"
              >
                {resettingPassword ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
                <span>{resettingPassword ? "Saving..." : "Save New Password"}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

"use client";

import React, { useState, useEffect } from "react";
import { X, CreditCard, CheckCircle2, AlertTriangle, Calendar } from "lucide-react";
import { toast } from "sonner";
import { Student, Payment, PendingMonthDetail } from "@/types";
import { getMonthName, calculateStudentDueStatus } from "@/lib/due-calculator";
import { isArchivedStudent } from "@/lib/student-archive";

interface CollectFeeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (payment: Payment) => void;
  student: Student | null;
}

interface MonthOption {
  month: number;
  year: number;
  label: string;
  isPending: boolean;
  isOverdue?: boolean;
}

export function CollectFeeModal({
  isOpen,
  onClose,
  onSuccess,
  student,
}: CollectFeeModalProps) {
  const currentDate = new Date();
  const [paymentDate, setPaymentDate] = useState(
    currentDate.toISOString().split("T")[0]
  );
  
  const [availableMonthOptions, setAvailableMonthOptions] = useState<MonthOption[]>([]);
  const [selectedKey, setSelectedKey] = useState<string>("");
  const [mode, setMode] = useState<"Cash" | "UPI">("Cash");
  const [remarks, setRemarks] = useState("");
  const [loading, setLoading] = useState(false);
  const [pendingSummary, setPendingSummary] = useState<{ count: number; total: string; monthsStr: string }>({
    count: 0,
    total: "0",
    monthsStr: "",
  });

  useEffect(() => {
    if (!isOpen || !student) return;

    // Reset initial states
    setPaymentDate(new Date().toISOString().split("T")[0]);
    setMode("Cash");
    setRemarks("");
    setSelectedKey("");
    setAvailableMonthOptions([]);

    if (isArchivedStudent(student)) {
      setPendingSummary({ count: 0, total: "0", monthsStr: "Archived" });
      return;
    }

    // Fetch student's existing payments to accurately extract ONLY pending/unpaid months
    fetch(`/api/students/${student._id}`)
      .then(async (res) => {
        const contentType = res.headers.get("content-type") || "";
        if (!res.ok) {
          const body = contentType.includes("application/json")
            ? await res.json().catch(() => null)
            : null;
          throw new Error(body?.error || `Student details request failed (${res.status})`);
        }
        if (!contentType.includes("application/json")) {
          throw new Error("Student details request returned an unexpected response");
        }
        return res.json();
      })
      .then((data) => {
        const studentData = data.student || student;
        const paymentsData: Payment[] = data.payments || [];

        // Compute dynamic due status
        const dueInfo = calculateStudentDueStatus(studentData, paymentsData);
        const pending: PendingMonthDetail[] = dueInfo.pendingMonths || [];

        // Build list of options: pending months first, then the current month when collectible
        const options: MonthOption[] = [];
        const optionKeysSet = new Set<string>();

        pending.forEach((p) => {
          const key = `${p.year}-${p.month}`;
          optionKeysSet.add(key);
          options.push({
            month: p.month,
            year: p.year,
            label: `${p.monthName} (${p.isOverdue ? "Overdue" : "Due"})`,
            isPending: true,
            isOverdue: p.isOverdue,
          });
        });

        // Add the current month only when it is not before admission and not already paid
        const paidKeysSet = new Set(paymentsData.map((p) => `${p.year}-${p.month}`));
        const curM = currentDate.getMonth() + 1;
        const curY = currentDate.getFullYear();
        const curKey = `${curY}-${curM}`;
        const admission = new Date(studentData.admissionDate);
        const admissionMonthIndex = Number.isNaN(admission.getTime())
          ? Number.POSITIVE_INFINITY
          : admission.getFullYear() * 12 + admission.getMonth();
        const currentMonthIndex = curY * 12 + (curM - 1);

        if (
          currentMonthIndex >= admissionMonthIndex &&
          !optionKeysSet.has(curKey) &&
          !paidKeysSet.has(curKey)
        ) {
          options.push({
            month: curM,
            year: curY,
            label: `${getMonthName(curM)} ${curY} (Current Month)`,
            isPending: false,
          });
          optionKeysSet.add(curKey);
        }

        setAvailableMonthOptions(options);

        // Default selected option to the earliest pending month
        if (options.length > 0) {
          const defaultOpt = options[0];
          setSelectedKey(`${defaultOpt.year}-${defaultOpt.month}`);
        } else {
          setSelectedKey("");
        }

        // Summary for banner
        if (pending.length > 0) {
          setPendingSummary({
            count: pending.length,
            total: dueInfo.totalPendingAmount.toLocaleString("en-IN"),
            monthsStr: pending.map((p) => p.monthName).join(", "),
          });
        } else {
          setPendingSummary({ count: 0, total: "0", monthsStr: "None (Up to Date)" });
        }
      })
      .catch((err) => {
        console.error("Error building fee collection options:", err);
      });
  }, [isOpen, student]);

  if (!isOpen || !student) return null;

  const isArchived = isArchivedStudent(student);

  // Selected Month & Year parsed from selectedKey
  const [selY, selM] = selectedKey.split("-").map(Number);
  const selectedMonth = selM || currentDate.getMonth() + 1;
  const selectedYear = selY || currentDate.getFullYear();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isArchived) {
      toast.error("Archived students cannot receive new payments.");
      return;
    }
    if (!selectedKey) {
      toast.error("Please select a valid fee month.");
      return;
    }
    setLoading(true);

    try {
      const res = await fetch("/api/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studentId: student.studentId,
          paymentDate,
          month: selectedMonth,
          year: selectedYear,
          amount: student.monthlyFee,
          mode,
          remarks,
        }),
      });

      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error || "Payment collection failed");
        setLoading(false);
        return;
      }

      toast.success(`Fee collected successfully for ${getMonthName(selectedMonth)} ${selectedYear}`);
      onSuccess(json.payment);
      onClose();
    } catch (err) {
      toast.error("Failed to submit payment");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="w-full max-w-lg bg-card text-card-foreground border border-border rounded-3xl p-6 shadow-elevated relative">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 rounded-full text-muted-foreground hover:bg-muted transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Header */}
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-2xl bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400 flex items-center justify-center font-bold">
            <CreditCard className="w-5 h-5" />
          </div>
          <div>
            <h2 className="font-bold text-lg">Collect Tuition Fee</h2>
            <p className="text-xs text-muted-foreground">
              {student.name} ({student.studentId}) • {student.class}
            </p>
          </div>
        </div>

        {/* Pending Fee Banner Notice */}
        {isArchived ? (
          <div className="mb-4 p-3 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-800 dark:text-amber-300 text-xs flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
            <div>
              <span className="font-bold">This student is archived.</span>
              <p className="text-[11px] text-amber-700 dark:text-amber-400 mt-0.5">
                New payments are disabled. Existing payment history and receipts remain available.
              </p>
            </div>
          </div>
        ) : pendingSummary.count > 0 ? (
          <div className="mb-4 p-3 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-800 dark:text-amber-300 text-xs flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
            <div>
              <span className="font-bold">
                {pendingSummary.count} Pending Month(s): {pendingSummary.monthsStr}
              </span>
              <p className="text-[11px] text-amber-700 dark:text-amber-400 mt-0.5">
                Total Pending Due: ₹{pendingSummary.total} • Select a month below to collect payment.
              </p>
            </div>
          </div>
        ) : (
          <div className="mb-4 p-3 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-300 text-xs flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            <span className="font-medium">All past tuition fees are fully paid up to date!</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Fee Month Dropdown (Shows Only Due and Current Months) */}
          <div>
            <label className="block text-xs font-semibold mb-1">
              Select Fee Month to Collect *
            </label>
            <select
              value={selectedKey}
              onChange={(e) => setSelectedKey(e.target.value)}
              disabled={isArchived}
              className="w-full px-3.5 py-2.5 text-sm bg-muted/50 border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/50 font-bold text-foreground disabled:opacity-60"
            >
              {availableMonthOptions.length === 0 ? (
                <option value="">No collectible months available</option>
              ) : (
                availableMonthOptions.map((opt) => {
                  const optKey = `${opt.year}-${opt.month}`;
                  return (
                    <option key={optKey} value={optKey}>
                      {opt.label}
                    </option>
                  );
                })
              )}
            </select>
          </div>

          {/* Amount & Mode */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold mb-1">Fee Amount (₹) *</label>
              <input
                type="number"
                value={student.monthlyFee}
                readOnly
                className="w-full px-3.5 py-2 text-sm bg-muted/50 border border-border rounded-xl font-bold text-emerald-600 dark:text-emerald-400 cursor-not-allowed"
              />
              <p className="text-[10px] text-muted-foreground mt-1">
                Full monthly fee only; partial payments are not supported.
              </p>
            </div>

            <div>
              <label className="block text-xs font-semibold mb-1">Payment Mode *</label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setMode("Cash")}
                  className={`flex-1 py-2 text-xs font-bold rounded-xl border transition-all ${
                    mode === "Cash"
                      ? "bg-emerald-600 text-white border-emerald-600 shadow-xs"
                      : "bg-muted/50 border-border text-muted-foreground hover:bg-muted"
                  }`}
                >
                  💵 Cash
                </button>
                <button
                  type="button"
                  onClick={() => setMode("UPI")}
                  className={`flex-1 py-2 text-xs font-bold rounded-xl border transition-all ${
                    mode === "UPI"
                      ? "bg-emerald-600 text-white border-emerald-600 shadow-xs"
                      : "bg-muted/50 border-border text-muted-foreground hover:bg-muted"
                  }`}
                >
                  📱 UPI
                </button>
              </div>
            </div>
          </div>

          {/* Payment Collection Date */}
          <div>
            <label className="block text-xs font-semibold mb-1">Collection Date *</label>
            <input
              type="date"
              value={paymentDate}
              onChange={(e) => setPaymentDate(e.target.value)}
              className="w-full px-3.5 py-2 text-sm bg-muted/50 border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/50 font-medium"
            />
          </div>

          {/* Remarks */}
          <div>
            <label className="block text-xs font-semibold mb-1">Remarks (Optional)</label>
            <input
              type="text"
              placeholder="e.g. Cash received by Prof. Fahim Sir"
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              className="w-full px-3.5 py-2 text-sm bg-muted/50 border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-4 border-t border-border">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-muted-foreground hover:bg-muted rounded-xl transition-all"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || isArchived || !selectedKey}
              className="inline-flex items-center gap-1.5 px-5 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl shadow-sm transition-all active:scale-95 disabled:opacity-50"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>{loading ? "Recording..." : "Record Payment"}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

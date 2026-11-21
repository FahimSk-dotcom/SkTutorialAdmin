"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import {
  Users,
  Wallet,
  CalendarCheck,
  AlertTriangle,
  Clock,
  UserPlus,
  CreditCard,
  ArrowUpRight,
  TrendingUp,
  ReceiptText,
  Plus,
  ClipboardCheck,
  CheckCircle2,
  Phone,
} from "lucide-react";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { StudentModal } from "@/components/students/StudentModal";
import { CollectFeeModal } from "@/components/students/CollectFeeModal";
import { ReceiptModal } from "@/components/payments/ReceiptModal";
import { Student, Payment } from "@/types";

export default function DashboardPage() {
  const [data, setData] = useState<any>(null);
  const [attendanceData, setAttendanceData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  // Modals state
  const [isAddStudentOpen, setIsAddStudentOpen] = useState(false);
  const [isCollectFeeOpen, setIsCollectFeeOpen] = useState(false);
  const [selectedStudentForCollect, setSelectedStudentForCollect] = useState<Student | null>(null);
  const [receiptPayment, setReceiptPayment] = useState<Payment | null>(null);

  const fetchDashboardData = async () => {
    try {
      const [res, attendanceRes] = await Promise.all([
        fetch("/api/dashboard"),
        fetch("/api/dashboard/attendance"),
      ]);
      const json = await res.json();
      if (res.ok) {
        setData(json);
      }
      const attendanceJson = await attendanceRes.json();
      if (attendanceRes.ok) {
        setAttendanceData(attendanceJson);
      }
    } catch (err) {
      console.error("Dashboard fetch error:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboardData();
  }, []);

  if (loading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-28 bg-card border border-border rounded-3xl" />
          ))}
        </div>
        <div className="h-64 bg-card border border-border rounded-3xl" />
      </div>
    );
  }

  const stats = data?.stats || {};
  const recentPayments = data?.recentPayments || [];
  const dueStudentsList: any[] = data?.dueStudentsList || [];
  const collectionChartData = data?.collectionChartData || [];

  const attendanceStats57 = attendanceData?.stats57;
  const attendanceStats79 = attendanceData?.stats79;
  const todaysAbsentees: any[] = attendanceData?.todaysAbsentees || [];
  const consecutiveAbsenceAlerts: any[] = attendanceData?.consecutiveAbsenceAlerts || [];
  const lowAttendanceAlerts: any[] = attendanceData?.lowAttendanceAlerts || [];

  return (
    <div className="space-y-6">
      {/* Top Banner & Quick Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-gradient-to-r from-indigo-600 to-indigo-800 text-white p-6 rounded-3xl shadow-elevated">
        <div>
          <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight">
            SK Tutorials Fee Management
          </h1>
          <p className="text-xs sm:text-sm text-indigo-100/80 mt-1 font-medium">
            Welcome back, Admin! Here is today&apos;s tuition overview.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setIsAddStudentOpen(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-white text-indigo-700 hover:bg-indigo-50 font-semibold text-xs rounded-2xl shadow-sm transition-all active:scale-95"
          >
            <UserPlus className="w-4 h-4" />
            <span>Add Student</span>
          </button>

          <button
            onClick={() => {
              if (dueStudentsList.length > 0) {
                setSelectedStudentForCollect(dueStudentsList[0].student);
              }
              setIsCollectFeeOpen(true);
            }}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-white font-semibold text-xs rounded-2xl shadow-sm transition-all active:scale-95"
          >
            <CreditCard className="w-4 h-4" />
            <span>Collect Fee</span>
          </button>
        </div>
      </div>

      {/* Primary KPI Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {/* Active Students */}
        <div className="bg-card border border-border p-4 rounded-3xl shadow-soft">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-muted-foreground">Active Students</span>
            <div className="p-2 rounded-2xl bg-indigo-500/10 text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-400">
              <Users className="w-4.5 h-4.5" />
            </div>
          </div>
          <div className="text-2xl sm:text-3xl font-black text-foreground">
            {stats.totalActiveStudents || 0}
          </div>
          <p className="text-[11px] text-muted-foreground mt-1 font-medium">Enrolled in institute</p>
        </div>

        {/* Today's Collection */}
        <div className="bg-card border border-border p-4 rounded-3xl shadow-soft">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-muted-foreground">Today&apos;s Collection</span>
            <div className="p-2 rounded-2xl bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400">
              <Wallet className="w-4.5 h-4.5" />
            </div>
          </div>
          <div className="text-2xl sm:text-3xl font-black text-emerald-600 dark:text-emerald-400">
            ₹{stats.todaysCollection || 0}
          </div>
          <p className="text-[11px] text-muted-foreground mt-1 font-medium">Collected today</p>
        </div>

        {/* Current Month Collection */}
        <div className="bg-card border border-border p-4 rounded-3xl shadow-soft">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-muted-foreground">Month Collection</span>
            <div className="p-2 rounded-2xl bg-indigo-500/10 text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-400">
              <CalendarCheck className="w-4.5 h-4.5" />
            </div>
          </div>
          <div className="text-2xl sm:text-3xl font-black text-indigo-600 dark:text-indigo-400">
            ₹{stats.currentMonthCollection || 0}
          </div>
          <p className="text-[11px] text-muted-foreground mt-1 font-medium">This month&apos;s total</p>
        </div>

        {/* Total Pending Amount */}
        <div className="bg-card border border-border p-4 rounded-3xl shadow-soft">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-muted-foreground">Pending Amount</span>
            <div className="p-2 rounded-2xl bg-rose-500/10 text-rose-600 dark:bg-rose-500/20 dark:text-rose-400">
              <AlertTriangle className="w-4.5 h-4.5" />
            </div>
          </div>
          <div className="text-2xl sm:text-3xl font-black text-rose-600 dark:text-rose-400">
            ₹{stats.totalPendingAmount || 0}
          </div>
          <p className="text-[11px] text-muted-foreground mt-1 font-medium">
            {stats.studentsWithDueCount || 0} students due
          </p>
        </div>
      </div>

      {/* Attendance Overview */}
      <div className="bg-card border border-border rounded-3xl p-5 shadow-soft space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-extrabold text-base flex items-center gap-2">
              <ClipboardCheck className="w-4 h-4 text-indigo-500" />
              <span>Today&apos;s Attendance</span>
            </h2>
            <p className="text-xs text-muted-foreground">
              {attendanceData?.formattedDate || "Today"} • {attendanceData?.teacherName || "Teacher"}
            </p>
          </div>
          <Link
            href="/attendance"
            className="text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:underline inline-flex items-center gap-1"
          >
            <span>Take Attendance</span>
            <ArrowUpRight className="w-3.5 h-3.5" />
          </Link>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {[attendanceStats57, attendanceStats79].filter(Boolean).map((batch: any) => (
            <div
              key={batch.batch}
              className="p-4 rounded-2xl border border-border/80 bg-muted/30 space-y-3"
            >
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-extrabold text-sm">{batch.batchName} Batch</h3>
                  <p className="text-[11px] text-muted-foreground">{batch.batchTiming}</p>
                </div>
                <span
                  className={`px-2.5 py-1 rounded-xl text-[10px] font-black ${
                    batch.isHoliday
                      ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
                      : batch.status === "Completed"
                      ? "bg-emerald-500/10 text-emerald-600"
                      : "bg-slate-500/10 text-slate-600 dark:text-slate-300"
                  }`}
                >
                  {batch.isHoliday ? "Holiday" : batch.status}
                </span>
              </div>

              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="p-2 rounded-xl bg-card border border-border/50">
                  <p className="text-[10px] text-muted-foreground font-bold">Total</p>
                  <p className="font-black text-sm">{batch.totalStudents}</p>
                </div>
                <div className="p-2 rounded-xl bg-emerald-500/10">
                  <p className="text-[10px] text-emerald-600 font-bold">Present</p>
                  <p className="font-black text-sm text-emerald-600">{batch.present}</p>
                </div>
                <div className="p-2 rounded-xl bg-rose-500/10">
                  <p className="text-[10px] text-rose-600 font-bold">Absent</p>
                  <p className="font-black text-sm text-rose-600">{batch.absent}</p>
                </div>
              </div>

              <div className="flex items-center justify-between text-[11px] font-bold text-muted-foreground">
                <span>Attendance: {batch.attendancePercentage}%</span>
                <Link href={`/attendance?batch=${batch.batch}`} className="text-indigo-600 hover:underline">
                  Open batch
                </Link>
              </div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="p-3 rounded-2xl bg-rose-500/5 border border-rose-500/20">
            <p className="text-[11px] font-black text-rose-600 uppercase mb-1">
              Today&apos;s Absentees ({todaysAbsentees.length})
            </p>
            {todaysAbsentees.length === 0 ? (
              <p className="text-xs text-muted-foreground font-semibold">No absentees today.</p>
            ) : (
              <div className="space-y-1">
                {todaysAbsentees.slice(0, 4).map((abs) => (
                  <div key={abs.studentId} className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold truncate">{abs.name}</span>
                    {abs.telLink ? (
                      <a
                        href={abs.telLink}
                        className="p-1 rounded-md bg-blue-600 text-white shrink-0"
                        title="Call parent"
                      >
                        <Phone className="w-3 h-3" />
                      </a>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="p-3 rounded-2xl bg-amber-500/5 border border-amber-500/20">
            <p className="text-[11px] font-black text-amber-700 dark:text-amber-300 uppercase mb-1">
              Consecutive Absence Alerts ({consecutiveAbsenceAlerts.length})
            </p>
            {consecutiveAbsenceAlerts.length === 0 ? (
              <p className="text-xs text-muted-foreground font-semibold">No alerts.</p>
            ) : (
              <div className="space-y-1">
                {consecutiveAbsenceAlerts.slice(0, 4).map((alert) => (
                  <div
                    key={alert.student.studentId}
                    className="flex items-center justify-between gap-2"
                  >
                    <span className="text-xs font-bold truncate">{alert.student.name}</span>
                    <span className="text-[10px] font-black text-amber-700 dark:text-amber-300">
                      {alert.consecutiveAbsences} days
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="p-3 rounded-2xl bg-indigo-500/5 border border-indigo-500/20">
            <p className="text-[11px] font-black text-indigo-600 dark:text-indigo-300 uppercase mb-1">
              Low Attendance Alerts ({lowAttendanceAlerts.length})
            </p>
            {lowAttendanceAlerts.length === 0 ? (
              <p className="text-xs text-muted-foreground font-semibold">No alerts.</p>
            ) : (
              <div className="space-y-1">
                {lowAttendanceAlerts.slice(0, 4).map((alert) => (
                  <div
                    key={alert.student.studentId}
                    className="flex items-center justify-between gap-2"
                  >
                    <span className="text-xs font-bold truncate">{alert.student.name}</span>
                    <span className="text-[10px] font-black text-indigo-600 dark:text-indigo-300">
                      {alert.percentage}%
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Due Students Quick Action Section */}
      <div className="bg-card border border-border rounded-3xl p-5 shadow-soft">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="font-extrabold text-base flex items-center gap-2">
              <Clock className="w-4 h-4 text-amber-500" />
              <span>Students with Pending & Due Fees</span>
            </h2>
            <p className="text-xs text-muted-foreground">
              {stats.studentsDueTodayCount || 0} due today • Review pending fee follow-ups
            </p>
          </div>
          <Link
            href="/students?dueFilter=OVERDUE"
            className="text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:underline inline-flex items-center gap-1"
          >
            <span>View All</span>
            <ArrowUpRight className="w-3.5 h-3.5" />
          </Link>
        </div>

        {dueStudentsList.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground border border-dashed border-border rounded-2xl">
            <p className="text-sm font-semibold">🎉 All tuition fees are fully collected!</p>
            <p className="text-xs">No pending or overdue fees found.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {dueStudentsList.slice(0, 6).map((item: any) => (
              <div
                key={item.student.studentId}
                className="p-4 rounded-2xl border border-border/80 bg-muted/40 hover:bg-muted/70 transition-all space-y-3"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-bold text-sm">{item.student.name}</h3>
                    <p className="text-xs text-muted-foreground">
                      {item.student.studentId} • Class {item.student.class}
                    </p>
                  </div>
                  <StatusBadge status={item.dueInfo.status} size="sm" />
                </div>

                <div className="flex items-center justify-between text-xs pt-1 border-t border-border/50">
                  <div>
                    <span className="text-muted-foreground block text-[10px]">Total Pending:</span>
                    <span className="font-extrabold text-rose-600 dark:text-rose-400">
                      ₹{item.dueInfo.totalPendingAmount}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => {
                        setSelectedStudentForCollect(item.student);
                        setIsCollectFeeOpen(true);
                      }}
                      className="px-2.5 py-1 text-xs font-bold bg-indigo-600 text-white rounded-xl shadow-xs hover:bg-indigo-700 transition-all active:scale-95"
                    >
                      Collect
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Monthly Collection Visual Breakdown & Recent Payments */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Collection Breakdown Cards */}
        <div className="bg-card border border-border rounded-3xl p-5 shadow-soft lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="font-extrabold text-base flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-emerald-500" />
                <span>Monthly Fee Collection Overview</span>
              </h2>
              <p className="text-xs text-muted-foreground">Yearly progress breakdown per month</p>
            </div>
          </div>

          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2 pt-2">
            {collectionChartData.map((item: any) => (
              <div
                key={item.month}
                className="p-3 rounded-2xl bg-muted/40 border border-border/60 text-center space-y-1"
              >
                <span className="text-[11px] font-bold text-muted-foreground uppercase">{item.month}</span>
                <p className="font-extrabold text-xs text-foreground">₹{item.amount}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Recent Collection Timeline */}
        <div className="bg-card border border-border rounded-3xl p-5 shadow-soft">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-extrabold text-base flex items-center gap-2">
              <ReceiptText className="w-4 h-4 text-indigo-500" />
              <span>Recent Payments</span>
            </h2>
            <Link
              href="/payments"
              className="text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:underline"
            >
              All History
            </Link>
          </div>

          {recentPayments.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-6">No payments recorded yet</p>
          ) : (
            <div className="space-y-3">
              {recentPayments.map((p: any) => (
                <div
                  key={p._id}
                  onClick={() => setReceiptPayment(p)}
                  className="flex items-center justify-between p-3 rounded-2xl bg-muted/30 border border-border/40 hover:bg-muted/60 transition-all cursor-pointer"
                >
                  <div>
                    <p className="font-bold text-xs">{p.studentName}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {p.receiptNo} • {p.paymentDate}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-extrabold text-xs text-emerald-600 dark:text-emerald-400">
                      +₹{p.amount}
                    </p>
                    <span className="text-[10px] text-muted-foreground font-semibold">{p.mode}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Floating Action Button for Mobile */}
      <button
        onClick={() => setIsAddStudentOpen(true)}
        className="md:hidden fixed bottom-20 right-4 z-40 w-12 h-12 rounded-full bg-indigo-600 text-white flex items-center justify-center shadow-lg shadow-indigo-600/40 active:scale-95"
        title="Add New Student"
      >
        <Plus className="w-6 h-6" />
      </button>

      {/* Modals */}
      <StudentModal
        isOpen={isAddStudentOpen}
        onClose={() => setIsAddStudentOpen(false)}
        onSuccess={fetchDashboardData}
      />

      <CollectFeeModal
        isOpen={isCollectFeeOpen}
        onClose={() => {
          setIsCollectFeeOpen(false);
          setSelectedStudentForCollect(null);
        }}
        onSuccess={(payment) => {
          fetchDashboardData();
          setReceiptPayment(payment);
        }}
        student={selectedStudentForCollect}
      />

      <ReceiptModal
        isOpen={!!receiptPayment}
        onClose={() => setReceiptPayment(null)}
        payment={receiptPayment}
      />
    </div>
  );
}

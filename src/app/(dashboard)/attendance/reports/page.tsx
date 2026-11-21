"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import {
  TrendingUp,
  FileSpreadsheet,
  FileText,
  Phone,
  Users,
  ArrowLeft,
} from "lucide-react";
import { toast } from "sonner";
import { exportToExcel } from "@/lib/export-utils";
import { generateAttendancePDF } from "@/lib/pdf-attendance-report";

type ReportTab = "monthly" | "student" | "batch" | "low" | "consecutive";

const TAB_LABELS: Record<ReportTab, string> = {
  monthly: "Monthly Matrix",
  student: "Student Summary",
  batch: "Batch Comparison",
  low: "Low Attendance (<75%)",
  consecutive: "Consecutive Absence (>=3)",
};

export default function AttendanceReportsPage() {
  const [activeTab, setActiveTab] = useState<ReportTab>("monthly");
  const [month, setMonth] = useState<number>(new Date().getMonth() + 1);
  const [year, setYear] = useState<number>(new Date().getFullYear());
  const [batchFilter, setBatchFilter] = useState<string>("All");

  const [loading, setLoading] = useState<boolean>(true);
  const [reportData, setReportData] = useState<any>(null);

  const fetchReport = async () => {
    try {
      setLoading(true);
      const query = new URLSearchParams({
        type: activeTab,
        month: String(month),
        year: String(year),
        batch: batchFilter,
      });

      const res = await fetch(`/api/reports/attendance?${query.toString()}`);
      const json = await res.json();
      if (res.ok) {
        setReportData(json);
      } else {
        toast.error(json.error || "Failed to load report data");
      }
    } catch (err) {
      console.error("Fetch report error:", err);
      toast.error("Failed to load report data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, month, year, batchFilter]);

  const getReportRows = (): Record<string, any>[] => {
    if (!reportData) return [];

    if (activeTab === "monthly" && reportData.studentRows) {
      return reportData.studentRows.map((row: any) => ({
        "Student ID": row.studentId,
        Name: row.name,
        Class: row.class,
        Batch: row.batch,
        Conducted: row.conducted,
        Present: row.present,
        Absent: row.absent,
        "Attendance %": `${row.percentage}%`,
      }));
    }

    if (activeTab === "batch" && reportData.batch57) {
      const toRow = (b: any) => ({
        Batch: b.name,
        Timing: b.timing,
        "Total Students": b.totalStudents,
        "Classes Conducted": b.classesConducted,
        "Total Present": b.totalPresent,
        "Total Absent": b.totalAbsent,
        "Avg Attendance %": `${b.avgPercentage}%`,
      });
      return [toRow(reportData.batch57), toRow(reportData.batch79)];
    }

    const students = (reportData.students || []).filter((st: any) => {
      if (activeTab === "low") return st.isLowAttendance;
      if (activeTab === "consecutive") return st.isConsecutiveAbsenceAlert;
      return true;
    });

    return students.map((st: any) => ({
      "Student ID": st.studentId,
      Name: st.name,
      Class: st.class,
      Batch: st.batch,
      Conducted: st.totalConducted,
      Present: st.presentCount,
      Absent: st.absentCount,
      "Attendance %": `${st.percentage}%`,
      "Consecutive Absences": st.consecutiveAbsences,
    }));
  };

  const downloadPDF = async () => {
    if (!reportData) {
      toast.error("No report data available to export");
      return;
    }
    const rows = getReportRows();
    if (rows.length === 0) {
      toast.error("No report data to export");
      return;
    }
    try {
      const monthName = new Date(year, month - 1, 1).toLocaleString("en-IN", { month: "long" });
      const title =
        activeTab === "monthly"
          ? `Monthly Attendance Report — ${monthName} ${year}`
          : activeTab === "low"
            ? "Low Attendance Alert Report (<75%)"
            : activeTab === "consecutive"
              ? "Consecutive Absence Alert Report (≥3 Days)"
              : `Student Attendance Summary Report — ${year}`;
      const pdf = await generateAttendancePDF(reportData, {
        title,
        month,
        year,
        batchFilter: batchFilter === "All" ? undefined : batchFilter,
        activeTab,
      });
      pdf.save(`SK_Tutorials_Attendance_${year}_${month}_${activeTab}.pdf`);
      toast.success("PDF report downloaded successfully");
    } catch (error) {
      console.error("Error generating PDF:", error);
      toast.error("Failed to generate PDF");
    }
  };

  const exportExcel = () => {
    const rows = getReportRows();
    if (rows.length === 0) {
      toast.error("No report data available to export");
      return;
    }

    try {
      exportToExcel(`SK_Tutorials_Attendance_${year}_${month}_${activeTab}`, rows);
      toast.success("Excel report exported successfully");
    } catch (error) {
      console.error("Error exporting Excel:", error);
      toast.error("Export failed");
    }
  };

  return (
    <div className="space-y-6 pb-16">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-card border border-border p-5 sm:p-6 rounded-3xl shadow-soft">
        <div>
          <div className="flex items-center gap-2">
            <Link
              href="/attendance"
              className="p-1.5 rounded-lg bg-muted hover:bg-muted/80 text-muted-foreground"
              title="Back to Attendance"
            >
              <ArrowLeft className="w-4 h-4" />
            </Link>
            <h1 className="text-xl sm:text-2xl font-black text-foreground flex items-center gap-2">
              <TrendingUp className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
              <span>Attendance Reports & Analytics</span>
            </h1>
          </div>
          <p className="text-xs text-muted-foreground mt-1 font-medium">
            Monthly matrix, batch comparisons, low attendance and consecutive absence alerts.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 self-start lg:self-auto">
          <button
            onClick={downloadPDF}
            disabled={loading}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-rose-600 hover:bg-rose-700 text-white font-extrabold text-xs rounded-2xl shadow-sm transition-all active:scale-95 disabled:opacity-50"
          >
            <FileText className="w-4 h-4" />
            <span>Download PDF</span>
          </button>
          <button
            onClick={exportExcel}
            disabled={loading}
            className="inline-flex items-center justify-center gap-2 px-3.5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs rounded-2xl shadow-sm transition-all active:scale-95 disabled:opacity-50"
          >
            <FileSpreadsheet className="w-4 h-4" />
            <span>Excel</span>
          </button>
        </div>
      </div>

      <div className="flex items-center gap-1.5 bg-card p-2 rounded-3xl border border-border shadow-soft overflow-x-auto">
        {(Object.keys(TAB_LABELS) as ReportTab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2.5 rounded-2xl text-xs font-extrabold whitespace-nowrap transition-all ${
              activeTab === tab
                ? "bg-indigo-600 text-white shadow-md"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            {TAB_LABELS[tab]}
          </button>
        ))}
      </div>

      <div className="bg-card border border-border rounded-3xl p-4 shadow-soft flex flex-wrap items-center gap-3">
        {activeTab === "monthly" && (
          <>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-muted-foreground">Month:</span>
              <select
                value={month}
                onChange={(e) => setMonth(parseInt(e.target.value, 10))}
                className="px-3 py-1.5 text-xs font-bold bg-muted border border-border rounded-xl"
              >
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((m) => (
                  <option key={m} value={m}>
                    {new Date(2026, m - 1, 1).toLocaleString("en-IN", { month: "long" })}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-muted-foreground">Year:</span>
              <select
                value={year}
                onChange={(e) => setYear(parseInt(e.target.value, 10))}
                className="px-3 py-1.5 text-xs font-bold bg-muted border border-border rounded-xl"
              >
                {[2025, 2026, 2027].map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </div>
          </>
        )}

        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-muted-foreground">Batch:</span>
          <select
            value={batchFilter}
            onChange={(e) => setBatchFilter(e.target.value)}
            className="px-3 py-1.5 text-xs font-bold bg-muted border border-border rounded-xl"
          >
            <option value="All">All Batches</option>
            <option value="5-7">5–7 Batch</option>
            <option value="7-9">7–9 Batch</option>
          </select>
        </div>
      </div>

      {loading ? (
        <div className="h-64 bg-card border border-border rounded-3xl animate-pulse" />
      ) : activeTab === "monthly" && reportData ? (
        <div className="bg-card border border-border rounded-3xl p-5 shadow-soft space-y-4 overflow-hidden">
          <h2 className="text-lg font-black text-foreground">
            Monthly Attendance Matrix —{" "}
            {new Date(year, month - 1, 1).toLocaleString("en-IN", { month: "long" })} {year}
          </h2>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-border bg-muted/50 text-muted-foreground font-black uppercase text-[10px]">
                  <th className="p-3">Student</th>
                  <th className="p-3">Batch</th>
                  <th className="p-3 text-center">Conducted</th>
                  <th className="p-3 text-center text-emerald-600">Present</th>
                  <th className="p-3 text-center text-rose-600">Absent</th>
                  <th className="p-3 text-center">Attendance %</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {reportData.studentRows?.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-6 text-center text-muted-foreground">
                      No attendance data for this month.
                    </td>
                  </tr>
                ) : (
                  reportData.studentRows?.map((row: any) => (
                    <tr
                      key={row.studentId}
                      className="hover:bg-muted/30 transition-all font-semibold"
                    >
                      <td className="p-3 font-bold text-foreground">
                        {row.name}
                        <span className="block text-[10px] text-muted-foreground font-normal">
                          {row.studentId} • {row.class}
                        </span>
                      </td>
                      <td className="p-3">
                        <span className="px-2 py-0.5 rounded-md bg-indigo-500/10 text-indigo-600 font-bold whitespace-nowrap">
                          {row.batch === "5-7"
                            ? "5–7 Batch"
                            : row.batch === "7-9"
                            ? "7–9 Batch"
                            : row.batch}
                        </span>
                      </td>
                      <td className="p-3 text-center font-bold">{row.conducted}</td>
                      <td className="p-3 text-center font-extrabold text-emerald-600">
                        {row.present}
                      </td>
                      <td className="p-3 text-center font-extrabold text-rose-600">
                        {row.absent}
                      </td>
                      <td className="p-3 text-center font-black">
                        <span
                          className={`px-2.5 py-1 rounded-xl text-xs font-black ${
                            row.percentage >= 75
                              ? "bg-emerald-500/10 text-emerald-600"
                              : "bg-rose-500/10 text-rose-600"
                          }`}
                        >
                          {row.percentage}%
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : activeTab === "batch" && reportData ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[reportData.batch57, reportData.batch79].map((batch: any, index: number) => (
            <div
              key={index}
              className="bg-card border border-border rounded-3xl p-6 shadow-soft space-y-4"
            >
              <h2 className="text-xl font-black text-foreground">{batch?.name} Overview</h2>
              <p className="text-xs text-muted-foreground font-medium">{batch?.timing}</p>

              <div className="grid grid-cols-2 gap-3 pt-2">
                <div className="p-4 rounded-2xl bg-muted/40 text-center">
                  <span className="text-xs text-muted-foreground block font-bold">
                    Total Students
                  </span>
                  <span className="text-2xl font-black">{batch?.totalStudents}</span>
                </div>
                <div className="p-4 rounded-2xl bg-muted/40 text-center">
                  <span className="text-xs text-muted-foreground block font-bold">
                    Classes Conducted
                  </span>
                  <span className="text-2xl font-black">{batch?.classesConducted}</span>
                </div>
                <div className="p-4 rounded-2xl bg-emerald-500/10 text-center">
                  <span className="text-xs text-emerald-600 block font-bold">
                    Total Present
                  </span>
                  <span className="text-2xl font-black text-emerald-600">
                    {batch?.totalPresent}
                  </span>
                </div>
                <div className="p-4 rounded-2xl bg-indigo-500/10 text-center">
                  <span className="text-xs text-indigo-600 block font-bold">
                    Avg Attendance
                  </span>
                  <span className="text-2xl font-black text-indigo-600">
                    {batch?.avgPercentage}%
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-card border border-border rounded-3xl p-5 shadow-soft space-y-4">
          {activeTab === "low" || activeTab === "consecutive" ? (
            <div className="flex items-center gap-2 text-xs font-bold text-muted-foreground">
              <Users className="w-4 h-4" />
              <span>
                {activeTab === "low"
                  ? "Students with attendance below the configured threshold."
                  : "Students with consecutive absences at or above the configured threshold."}
              </span>
            </div>
          ) : null}

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-border bg-muted/50 text-muted-foreground font-black uppercase text-[10px]">
                  <th className="p-3">Student</th>
                  <th className="p-3">Batch</th>
                  <th className="p-3 text-center">Conducted</th>
                  <th className="p-3 text-center text-emerald-600">Present</th>
                  <th className="p-3 text-center text-rose-600">Absent</th>
                  <th className="p-3 text-center">Attendance %</th>
                  <th className="p-3 text-right">Contact</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {(() => {
                  const students = (reportData?.students || []).filter((st: any) => {
                    if (activeTab === "low") return st.isLowAttendance;
                    if (activeTab === "consecutive") return st.isConsecutiveAbsenceAlert;
                    return true;
                  });

                  if (students.length === 0) {
                    return (
                      <tr>
                        <td colSpan={7} className="p-6 text-center text-muted-foreground">
                          No students match this report.
                        </td>
                      </tr>
                    );
                  }

                  return students.map((st: any) => (
                    <tr
                      key={st.studentId}
                      className="hover:bg-muted/30 transition-all font-semibold"
                    >
                      <td className="p-3 font-bold text-foreground">
                        {st.name}
                        <span className="block text-[10px] text-muted-foreground font-normal">
                          {st.studentId} • {st.class}
                        </span>
                      </td>
                      <td className="p-3">
                        <span className="px-2 py-0.5 rounded-md bg-indigo-500/10 text-indigo-600 font-bold whitespace-nowrap">
                          {st.batch === "5-7"
                            ? "5–7 Batch"
                            : st.batch === "7-9"
                            ? "7–9 Batch"
                            : st.batch}
                        </span>
                      </td>
                      <td className="p-3 text-center font-bold">{st.totalConducted}</td>
                      <td className="p-3 text-center font-extrabold text-emerald-600">
                        {st.presentCount}
                      </td>
                      <td className="p-3 text-center font-extrabold text-rose-600">
                        {st.absentCount}
                      </td>
                      <td className="p-3 text-center font-black">
                        <span
                          className={`px-2.5 py-1 rounded-xl text-xs font-black ${
                            st.percentage >= 75
                              ? "bg-emerald-500/10 text-emerald-600"
                              : "bg-rose-500/10 text-rose-600"
                          }`}
                        >
                          {st.percentage}%
                        </span>
                      </td>
                      <td className="p-3 text-right">
                        {st.telLink ? (
                          <a
                            href={st.telLink}
                            className="inline-flex p-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                            title="Call Parent"
                          >
                            <Phone className="w-3.5 h-3.5" />
                          </a>
                        ) : (
                          <span className="text-[10px] text-muted-foreground">No phone</span>
                        )}
                      </td>
                    </tr>
                  ));
                })()}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

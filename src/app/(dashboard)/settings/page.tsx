"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Settings as SettingsIcon,
  Save,
  QrCode,
  Building2,
  Receipt,
  ClipboardCheck,
  Plus,
  Trash2,
  CalendarOff,
} from "lucide-react";
import { settingsSchema, SettingsInput } from "@/schemas";
import { toast } from "sonner";
import { ALL_CLASSES, AttendanceSettingsConfig, HolidayDoc } from "@/types";
import { DEFAULT_ATTENDANCE_SETTINGS } from "@/lib/app-settings";
import { getKolkataToday } from "@/lib/date";

type Tab = "institute" | "attendance";

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<Tab>("institute");
  const [loading, setLoading] = useState(true);

  const [attendanceSettings, setAttendanceSettings] = useState<AttendanceSettingsConfig>(
    DEFAULT_ATTENDANCE_SETTINGS
  );
  const [savingAttendance, setSavingAttendance] = useState(false);

  const [holidays, setHolidays] = useState<HolidayDoc[]>([]);
  const [holidayDate, setHolidayDate] = useState(getKolkataToday());
  const [holidayBatch, setHolidayBatch] = useState<"ALL" | "5-7" | "7-9">("ALL");
  const [holidayReason, setHolidayReason] = useState<
    "Holiday" | "Vacation" | "Personal" | "Other"
  >("Holiday");
  const [holidayDescription, setHolidayDescription] = useState("");
  const [savingHoliday, setSavingHoliday] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<SettingsInput>({
    resolver: zodResolver(settingsSchema),
    defaultValues: {
      instituteName: "SK Tutorials",
      logoUrl:
        "https://res.cloudinary.com/dfmcngduw/image/upload/v1784896530/86a65215-ce9c-427d-9cc5-f67d0a08040c_gyndgk.png",
      upiId: "fs308605@okhdfcbank",
      upiQrUrl: "/upi-qr.jpg",
      receiptFooter:
        "Thank you for choosing SK Tutorials. Fee once paid is non-refundable.",
    },
  });

  const fetchSettings = async () => {
    try {
      const res = await fetch("/api/settings");
      const json = await res.json();
      if (res.ok && json.settings) {
        reset(json.settings);
      }
      if (res.ok && json.attendanceSettings) {
        setAttendanceSettings(json.attendanceSettings);
      }
    } catch (err) {
      toast.error("Failed to load settings");
    } finally {
      setLoading(false);
    }
  };

  const fetchHolidays = async () => {
    try {
      const res = await fetch("/api/holidays");
      const json = await res.json();
      if (res.ok) {
        setHolidays(json);
      }
    } catch (err) {
      console.error("Fetch holidays error:", err);
    }
  };

  useEffect(() => {
    fetchSettings();
    fetchHolidays();
  }, [reset]);

  const onSubmit = async (data: SettingsInput) => {
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      const json = await res.json();
      if (res.ok) {
        toast.success("Institute settings saved successfully!");
      } else {
        toast.error(json.error || "Save failed");
      }
    } catch (err) {
      toast.error("Failed to update settings");
    }
  };

  const updateAttendanceField = <K extends keyof AttendanceSettingsConfig>(
    key: K,
    value: AttendanceSettingsConfig[K]
  ) => {
    setAttendanceSettings((prev) => ({ ...prev, [key]: value }));
  };

  const toggleClass = (batch: "batch1Classes" | "batch2Classes", className: string) => {
    setAttendanceSettings((prev) => {
      const current = prev[batch];
      const next = current.includes(className)
        ? current.filter((c) => c !== className)
        : [...current, className];
      return { ...prev, [batch]: next };
    });
  };

  const saveAttendanceSettings = async () => {
    try {
      setSavingAttendance(true);
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(attendanceSettings),
      });

      const json = await res.json();
      if (res.ok) {
        toast.success("Attendance settings saved successfully!");
      } else {
        toast.error(json.error || "Save failed");
      }
    } catch (err) {
      toast.error("Failed to update attendance settings");
    } finally {
      setSavingAttendance(false);
    }
  };

  const addHoliday = async () => {
    try {
      setSavingHoliday(true);
      const res = await fetch("/api/holidays", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: holidayDate,
          batch: holidayBatch,
          reason: holidayReason,
          description: holidayDescription,
        }),
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || "Failed to add holiday");
      }

      toast.success("Holiday added successfully");
      setHolidayDescription("");
      fetchHolidays();
    } catch (err: any) {
      toast.error(err.message || "Failed to add holiday");
    } finally {
      setSavingHoliday(false);
    }
  };

  const deleteHoliday = async (holiday: HolidayDoc) => {
    if (!holiday._id) return;
    if (!window.confirm(`Delete holiday on ${holiday.date}?`)) return;

    try {
      const res = await fetch(`/api/holidays?id=${holiday._id}`, {
        method: "DELETE",
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || "Failed to delete holiday");
      }
      toast.success("Holiday deleted");
      fetchHolidays();
    } catch (err: any) {
      toast.error(err.message || "Failed to delete holiday");
    }
  };

  if (loading) {
    return (
      <div className="h-64 bg-card border border-border rounded-3xl animate-pulse" />
    );
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-xl sm:text-2xl font-black tracking-tight text-foreground flex items-center gap-2">
          <SettingsIcon className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
          <span>Institute & Attendance Settings</span>
        </h1>
        <p className="text-xs text-muted-foreground">
          Configure institute profile, payment details, batches, thresholds, and holidays.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 bg-card p-2 rounded-3xl border border-border shadow-soft w-fit">
        <Link href="/settings/fee-reminders" className="rounded-2xl px-4 py-2 text-sm font-semibold text-muted-foreground hover:bg-muted">
          Fee Reminders
        </Link>
        <button
          onClick={() => setActiveTab("institute")}
          className={`inline-flex items-center gap-1.5 px-4 py-2.5 rounded-2xl text-xs font-extrabold transition-all ${
            activeTab === "institute"
              ? "bg-indigo-600 text-white shadow-md"
              : "text-muted-foreground hover:bg-muted hover:text-foreground"
          }`}
        >
          <Building2 className="w-4 h-4" />
          Institute
        </button>
        <button
          onClick={() => setActiveTab("attendance")}
          className={`inline-flex items-center gap-1.5 px-4 py-2.5 rounded-2xl text-xs font-extrabold transition-all ${
            activeTab === "attendance"
              ? "bg-indigo-600 text-white shadow-md"
              : "text-muted-foreground hover:bg-muted hover:text-foreground"
          }`}
        >
          <ClipboardCheck className="w-4 h-4" />
          Attendance
        </button>
      </div>

      {activeTab === "institute" && (
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          <div className="bg-card border border-border p-6 rounded-3xl shadow-soft space-y-4">
            <div className="flex items-center gap-2 border-b border-border pb-3">
              <Building2 className="w-5 h-5 text-indigo-600" />
              <h2 className="font-bold text-sm">Institute Details</h2>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold mb-1 text-foreground">
                  Institute Name *
                </label>
                <input
                  type="text"
                  {...register("instituteName")}
                  className="w-full px-3.5 py-2 text-sm bg-muted/50 border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                />
                {errors.instituteName && (
                  <p className="text-xs text-rose-500 mt-1">{errors.instituteName.message}</p>
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1 text-foreground">
                  Logo URL
                </label>
                <input
                  type="text"
                  placeholder="https://example.com/logo.png"
                  {...register("logoUrl")}
                  className="w-full px-3.5 py-2 text-sm bg-muted/50 border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                />
              </div>
            </div>
          </div>

          <div className="bg-card border border-border p-6 rounded-3xl shadow-soft space-y-4">
            <div className="flex items-center gap-2 border-b border-border pb-3">
              <QrCode className="w-5 h-5 text-emerald-600" />
              <h2 className="font-bold text-sm">UPI & QR Code Details</h2>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold mb-1 text-foreground">
                  UPI VPA / ID
                </label>
                <input
                  type="text"
                  placeholder="sktutorials@upi"
                  {...register("upiId")}
                  className="w-full px-3.5 py-2 text-sm bg-muted/50 border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/50 font-medium"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1 text-foreground">
                  UPI QR Code Image URL (Optional)
                </label>
                <input
                  type="text"
                  placeholder="https://example.com/qr.png"
                  {...register("upiQrUrl")}
                  className="w-full px-3.5 py-2 text-sm bg-muted/50 border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                />
              </div>
            </div>
          </div>

          <div className="bg-card border border-border p-6 rounded-3xl shadow-soft space-y-4">
            <div className="flex items-center gap-2 border-b border-border pb-3">
              <Receipt className="w-5 h-5 text-indigo-600" />
              <h2 className="font-bold text-sm">Receipt Defaults</h2>
            </div>

            <div>
              <label className="block text-xs font-semibold mb-1 text-foreground">
                Receipt Footer Note
              </label>
              <textarea
                rows={2}
                {...register("receiptFooter")}
                className="w-full px-3.5 py-2 text-sm bg-muted/50 border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
              />
            </div>
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={isSubmitting}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-xs shadow-md shadow-indigo-500/20 transition-all active:scale-95 disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              <span>{isSubmitting ? "Saving Settings..." : "Save Institute Settings"}</span>
            </button>
          </div>
        </form>
      )}

      {activeTab === "attendance" && (
        <div className="space-y-6">
          <div className="bg-card border border-border p-6 rounded-3xl shadow-soft space-y-4">
            <div className="flex items-center gap-2 border-b border-border pb-3">
              <ClipboardCheck className="w-5 h-5 text-indigo-600" />
              <h2 className="font-bold text-sm">Teacher & Batch Configuration</h2>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold mb-1 text-foreground">
                  Teacher Name
                </label>
                <input
                  type="text"
                  value={attendanceSettings.teacherName}
                  onChange={(e) => updateAttendanceField("teacherName", e.target.value)}
                  className="w-full px-3.5 py-2 text-sm bg-muted/50 border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1 text-foreground">
                  Low Attendance Threshold (%)
                </label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={attendanceSettings.attendanceThreshold}
                  onChange={(e) =>
                    updateAttendanceField(
                      "attendanceThreshold",
                      parseInt(e.target.value || "0", 10)
                    )
                  }
                  className="w-full px-3.5 py-2 text-sm bg-muted/50 border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1 text-foreground">
                  Consecutive Absence Threshold (days)
                </label>
                <input
                  type="number"
                  min={1}
                  max={30}
                  value={attendanceSettings.consecutiveAbsenceThreshold}
                  onChange={(e) =>
                    updateAttendanceField(
                      "consecutiveAbsenceThreshold",
                      parseInt(e.target.value || "1", 10)
                    )
                  }
                  className="w-full px-3.5 py-2 text-sm bg-muted/50 border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
              <div className="p-4 rounded-2xl bg-muted/30 border border-border/60 space-y-3">
                <div>
                  <label className="block text-xs font-semibold mb-1 text-foreground">
                    Batch 1 Name
                  </label>
                  <input
                    type="text"
                    value={attendanceSettings.batch1Name}
                    onChange={(e) => updateAttendanceField("batch1Name", e.target.value)}
                    className="w-full px-3 py-1.5 text-xs bg-card border border-border rounded-xl"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1 text-foreground">
                    Batch 1 Timing
                  </label>
                  <input
                    type="text"
                    value={attendanceSettings.batch1Timing}
                    onChange={(e) => updateAttendanceField("batch1Timing", e.target.value)}
                    className="w-full px-3 py-1.5 text-xs bg-card border border-border rounded-xl"
                  />
                </div>
                <div>
                  <span className="block text-xs font-semibold mb-1 text-foreground">
                    Batch 1 Classes
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {ALL_CLASSES.map((className) => (
                      <button
                        key={className}
                        type="button"
                        onClick={() => toggleClass("batch1Classes", className)}
                        className={`px-2 py-1 rounded-lg text-[10px] font-bold border ${
                          attendanceSettings.batch1Classes.includes(className)
                            ? "bg-indigo-600 text-white border-indigo-600"
                            : "bg-card text-muted-foreground border-border"
                        }`}
                      >
                        {className}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="p-4 rounded-2xl bg-muted/30 border border-border/60 space-y-3">
                <div>
                  <label className="block text-xs font-semibold mb-1 text-foreground">
                    Batch 2 Name
                  </label>
                  <input
                    type="text"
                    value={attendanceSettings.batch2Name}
                    onChange={(e) => updateAttendanceField("batch2Name", e.target.value)}
                    className="w-full px-3 py-1.5 text-xs bg-card border border-border rounded-xl"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1 text-foreground">
                    Batch 2 Timing
                  </label>
                  <input
                    type="text"
                    value={attendanceSettings.batch2Timing}
                    onChange={(e) => updateAttendanceField("batch2Timing", e.target.value)}
                    className="w-full px-3 py-1.5 text-xs bg-card border border-border rounded-xl"
                  />
                </div>
                <div>
                  <span className="block text-xs font-semibold mb-1 text-foreground">
                    Batch 2 Classes
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {ALL_CLASSES.map((className) => (
                      <button
                        key={className}
                        type="button"
                        onClick={() => toggleClass("batch2Classes", className)}
                        className={`px-2 py-1 rounded-lg text-[10px] font-bold border ${
                          attendanceSettings.batch2Classes.includes(className)
                            ? "bg-indigo-600 text-white border-indigo-600"
                            : "bg-card text-muted-foreground border-border"
                        }`}
                      >
                        {className}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={saveAttendanceSettings}
                disabled={savingAttendance}
                className="inline-flex items-center gap-2 px-6 py-3 rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-xs shadow-md shadow-indigo-500/20 transition-all active:scale-95 disabled:opacity-50"
              >
                <Save className="w-4 h-4" />
                <span>{savingAttendance ? "Saving..." : "Save Attendance Settings"}</span>
              </button>
            </div>
          </div>

          <div className="bg-card border border-border p-6 rounded-3xl shadow-soft space-y-4">
            <div className="flex items-center gap-2 border-b border-border pb-3">
              <CalendarOff className="w-5 h-5 text-amber-600" />
              <h2 className="font-bold text-sm">Holiday Management</h2>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <div>
                <label className="block text-xs font-semibold mb-1 text-foreground">Date</label>
                <input
                  type="date"
                  value={holidayDate}
                  onChange={(e) => setHolidayDate(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-muted/50 border border-border rounded-xl"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1 text-foreground">Batch</label>
                <select
                  value={holidayBatch}
                  onChange={(e) =>
                    setHolidayBatch(e.target.value as "ALL" | "5-7" | "7-9")
                  }
                  className="w-full px-3 py-2 text-xs bg-muted/50 border border-border rounded-xl"
                >
                  <option value="ALL">All Batches</option>
                  <option value="5-7">5–7 Batch</option>
                  <option value="7-9">7–9 Batch</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1 text-foreground">Reason</label>
                <select
                  value={holidayReason}
                  onChange={(e) =>
                    setHolidayReason(
                      e.target.value as "Holiday" | "Vacation" | "Personal" | "Other"
                    )
                  }
                  className="w-full px-3 py-2 text-xs bg-muted/50 border border-border rounded-xl"
                >
                  <option value="Holiday">Holiday</option>
                  <option value="Vacation">Vacation</option>
                  <option value="Personal">Personal</option>
                  <option value="Other">Other</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1 text-foreground">
                  Description
                </label>
                <input
                  type="text"
                  value={holidayDescription}
                  onChange={(e) => setHolidayDescription(e.target.value)}
                  placeholder="Optional note"
                  className="w-full px-3 py-2 text-xs bg-muted/50 border border-border rounded-xl"
                />
              </div>
            </div>

            <button
              type="button"
              onClick={addHoliday}
              disabled={savingHoliday}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-2xl bg-amber-600 hover:bg-amber-700 text-white font-extrabold text-xs disabled:opacity-50"
            >
              <Plus className="w-4 h-4" />
              <span>{savingHoliday ? "Adding..." : "Add Holiday"}</span>
            </button>

            <div className="border border-border rounded-2xl overflow-hidden divide-y divide-border/60">
              {holidays.length === 0 ? (
                <p className="p-4 text-xs text-muted-foreground text-center">
                  No holidays configured.
                </p>
              ) : (
                holidays.map((holiday) => (
                  <div
                    key={holiday._id}
                    className="p-3 flex items-center justify-between gap-3 text-xs"
                  >
                    <div>
                      <span className="font-bold text-foreground">{holiday.date}</span>
                      <span className="ml-2 px-2 py-0.5 rounded-md bg-amber-500/10 text-amber-700 dark:text-amber-300 font-bold text-[10px]">
                        {holiday.batch === "ALL" ? "All Batches" : `${holiday.batch} Batch`}
                      </span>
                      <span className="ml-2 text-muted-foreground font-semibold">
                        {holiday.reason}
                      </span>
                      {holiday.description ? (
                        <span className="block text-[10px] text-muted-foreground">
                          {holiday.description}
                        </span>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      onClick={() => deleteHoliday(holiday)}
                      className="p-1.5 rounded-lg bg-rose-500/10 text-rose-600 hover:bg-rose-500/20"
                      title="Delete holiday"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

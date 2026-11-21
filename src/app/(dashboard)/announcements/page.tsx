"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  Megaphone,
  Send,
  X,
  CheckCircle2,
  AlertCircle,
  Users,
  Smartphone,
  Clock3,
  Eye,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";

type AnnouncementType = "GENERAL" | "CLASS_WISE";

interface AnnouncementListItem {
  _id: string;
  title: string;
  message: string;
  type: AnnouncementType;
  targetClasses: string[];
  createdAt: string;
  status: string;
  isImportant: boolean;
  recipientCount: number;
  deviceCount: number;
  deliveryStats: { pending: number; sent: number; failed: number };
  createdBy?: { name?: string; email?: string };
}

interface AnnouncementDetail extends AnnouncementListItem {
  details?: {
    readCount: number;
    deliveryBreakdown: Array<{ errorCode: string | null; status: string | null; count: number }>;
  };
}

function formatDateTime(value: string) {
  try {
    return new Intl.DateTimeFormat("en-IN", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Asia/Kolkata",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function makeClientPublishId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `pub_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export default function AnnouncementsPage() {
  const [classes, setClasses] = useState<string[]>([]);
  const [loadingClasses, setLoadingClasses] = useState(false);

  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [type, setType] = useState<AnnouncementType>("GENERAL");
  const [selectedClasses, setSelectedClasses] = useState<string[]>([]);
  const [isImportant, setIsImportant] = useState(false);
  const [deleteMode, setDeleteMode] = useState<"custom" | "general" | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [counts, setCounts] = useState<{ total: number; important: number; eligible: number } | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState<{ mode: "custom"; ids: string[] } | { mode: "general"; expected: number } | null>(null);
  const [managing, setManaging] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);

  const [showConfirm, setShowConfirm] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [clientPublishId, setClientPublishId] = useState<string | null>(null);

  const [announcements, setAnnouncements] = useState<AnnouncementListItem[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [detail, setDetail] = useState<AnnouncementDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);

  const canSubmit = useMemo(() => {
    if (!title.trim() || !message.trim()) return false;
    if (title.trim().length > 100) return false;
    if (message.trim().length > 2000) return false;
    if (type === "CLASS_WISE" && selectedClasses.length === 0) return false;
    return true;
  }, [title, message, type, selectedClasses]);

  const targetAudienceDescription = useMemo(() => {
    if (type === "GENERAL") return "All eligible registered parents (active linked students)";
    return `Parents with active children in: ${selectedClasses.join(", ")}`;
  }, [type, selectedClasses]);

  const fetchClasses = async () => {
    setLoadingClasses(true);
    try {
      const res = await fetch("/api/admin/announcements/classes", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load classes");
      setClasses(Array.isArray(json.classes) ? json.classes : []);
    } catch (e: any) {
      toast.error(e.message || "Failed to load classes");
    } finally {
      setLoadingClasses(false);
    }
  };

  const fetchAnnouncements = async (silent = false, targetPage = page) => {
    if (!silent) setLoadingList(true); else setRefreshing(true);
    try {
      const res = await fetch(`/api/admin/announcements?page=${targetPage}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load announcements");
      setAnnouncements(Array.isArray(json.announcements) ? json.announcements : []);
      setPage(targetPage);
      setHasMore(Boolean(json.hasMore));
    } catch (e: any) {
      toast.error(e.message || "Failed to load announcements");
    } finally {
      setLoadingList(false);
      setRefreshing(false);
    }
  };

  const fetchDeleteCounts = async () => {
    setCounts(null);
    try {
      const response = await fetch("/api/admin/announcements/bulk-delete", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setCounts(data);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to load deletion preview.");
    }
  };

  const selectAllEligible = async () => {
    setManaging(true);
    try {
      const response = await fetch("/api/admin/announcements/bulk-delete?select=all", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setSelectedIds(data.ids);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to select announcements.");
    } finally {
      setManaging(false);
    }
  };

  const toggleImportant = async (row: AnnouncementListItem) => {
    if (managing) return;
    setManaging(true);
    try {
      const response = await fetch(`/api/admin/announcements/${row._id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isImportant: !row.isImportant }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setSelectedIds((current) => current.filter((id) => id !== row._id));
      setAnnouncements((current) => current.map((item) => item._id === row._id ? { ...item, isImportant: data.isImportant } : item));
      if (deleteMode === "general") await fetchDeleteCounts();
      toast.success(data.isImportant ? "Marked as important." : "Important status removed.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to update importance.");
    } finally {
      setManaging(false);
    }
  };

  const deleteAnnouncements = async () => {
    if (!deleteConfirmation || managing) return;
    setManaging(true);
    try {
      const response = await fetch("/api/admin/announcements/bulk-delete", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...deleteConfirmation, confirmed: true }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      toast.success(`Deleted ${data.deleted} announcement(s).`);
      if (data.skipped) toast.info(`${data.skipped} selection(s) were protected or already removed.`);
      setSelectedIds([]);
      setDetailOpen(false);
      await fetchAnnouncements(true, 1);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to delete announcements.");
    } finally {
      if (deleteConfirmation.mode === "general") await fetchDeleteCounts();
      setManaging(false);
    }
  };

  const fetchDetail = async (id: string) => {
    setLoadingDetail(true);
    setDetailOpen(true);
    try {
      const res = await fetch(`/api/admin/announcements/${id}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load announcement details");
      setDetail({ ...(json.announcement || {}), details: json.details });
    } catch (e: any) {
      toast.error(e.message || "Failed to load details");
      setDetailOpen(false);
    } finally {
      setLoadingDetail(false);
    }
  };

  useEffect(() => {
    fetchClasses();
    fetchAnnouncements();
  }, []);

  useEffect(() => {
    if (type === "GENERAL") setSelectedClasses([]);
  }, [type]);

  const toggleClass = (className: string) => {
    setSelectedClasses((prev) =>
      prev.includes(className) ? prev.filter((c) => c !== className) : [...prev, className]
    );
  };

  const removeClass = (className: string) => {
    setSelectedClasses((prev) => prev.filter((c) => c !== className));
  };

  const resetForm = () => {
    setTitle("");
    setMessage("");
    setType("GENERAL");
    setSelectedClasses([]);
    setIsImportant(false);
    setClientPublishId(null);
  };

  const openConfirm = () => {
    if (!title.trim()) return toast.error("Title is required");
    if (!message.trim()) return toast.error("Message is required");
    if (title.trim().length > 100) return toast.error("Title must be 100 characters or less");
    if (message.trim().length > 2000) return toast.error("Message must be 2000 characters or less");
    if (type === "CLASS_WISE" && selectedClasses.length === 0) {
      return toast.error("Select at least one class for a class-wise announcement");
    }
    setClientPublishId((prev) => prev ?? makeClientPublishId());
    setShowConfirm(true);
  };

  const publish = async () => {
    if (publishing) return;
    const publishId = clientPublishId ?? makeClientPublishId();
    setClientPublishId(publishId);
    setPublishing(true);
    try {
      const res = await fetch("/api/admin/announcements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          message: message.trim(),
          type,
          targetClasses: type === "CLASS_WISE" ? selectedClasses : [],
          clientPublishId: publishId,
          isImportant,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to publish announcement");
      toast.success(json.duplicate ? "Announcement was already published" : "Announcement published successfully");
      if (json.delivery?.fcm?.ready === false) {
        toast.warning(`Saved, but push delivery is not configured: ${json.delivery.fcm.error ?? "unknown FCM error"}`);
      }
      setShowConfirm(false);
      resetForm();
      fetchAnnouncements(true);
    } catch (e: any) {
      toast.error(e.message || "Failed to publish announcement");
      // keep clientPublishId so retry is idempotent for same payload attempt
    } finally {
      setPublishing(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-black tracking-tight text-foreground flex items-center gap-2">
            <Megaphone className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
            <span>Announcements & Push Notifications</span>
          </h1>
          <p className="text-xs text-muted-foreground">
            Publish general or class-wise announcements to parents (in-app + FCM push) and track delivery.
          </p>
        </div>
        <button
          onClick={() => fetchAnnouncements(true)}
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-2xl bg-muted hover:bg-muted/80 text-foreground font-bold text-xs border border-border transition-all"
        >
          <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">
        {/* Create form */}
        <section className="xl:col-span-2 bg-card border border-border rounded-3xl shadow-soft p-5 sm:p-6 space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="font-extrabold text-sm">Create Announcement</h2>
            <span className="text-[10px] font-bold px-2 py-1 rounded-lg bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 border border-indigo-500/20">
              In-app + Push (default)
            </span>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold mb-1.5 text-foreground">Announcement Type *</label>
              <div className="grid grid-cols-2 gap-2">
                {(["GENERAL", "CLASS_WISE"] as AnnouncementType[]).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setType(t)}
                    className={`px-3 py-2.5 rounded-2xl text-xs font-extrabold border transition-all ${
                      type === t
                        ? "bg-indigo-600 text-white border-indigo-600 shadow-sm"
                        : "bg-muted/40 text-foreground border-border hover:bg-muted"
                    }`}
                  >
                    {t === "GENERAL" ? "General (All Parents)" : "Class-Wise"}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground mt-1.5">
                {type === "GENERAL"
                  ? "Automatically targets all eligible registered parents."
                  : "Select one or more classes. Only eligible parents in selected classes will receive it."}
              </p>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-semibold text-foreground">Title *</label>
                <span className={`text-[10px] font-bold ${title.length > 100 ? "text-rose-600" : "text-muted-foreground"}`}>
                  {title.length}/100
                </span>
              </div>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={120}
                placeholder="e.g. Holiday Notice"
                className="w-full px-3.5 py-2.5 text-sm bg-muted/50 border border-border rounded-2xl focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-semibold text-foreground">Message *</label>
                <span className={`text-[10px] font-bold ${message.length > 2000 ? "text-rose-600" : "text-muted-foreground"}`}>
                  {message.length}/2000
                </span>
              </div>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={7}
                maxLength={2200}
                placeholder="Write the announcement message..."
                className="w-full px-3.5 py-2.5 text-sm bg-muted/50 border border-border rounded-2xl focus:outline-none focus:ring-2 focus:ring-indigo-500/50 whitespace-pre-wrap"
              />
              <p className="text-[11px] text-muted-foreground mt-1">Line breaks are preserved in the parent app.</p>
            </div>

            {type === "CLASS_WISE" && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-semibold text-foreground">Target Classes * (multiple)</label>
                  <button type="button" onClick={fetchClasses} className="text-[10px] font-bold text-indigo-600 hover:underline">
                    Reload classes
                  </button>
                </div>

                {selectedClasses.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {selectedClasses.map((c) => (
                      <span key={c} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-indigo-600 text-white text-[11px] font-bold">
                        {c}
                        <button type="button" onClick={() => removeClass(c)} className="hover:bg-white/20 rounded-full p-0.5" aria-label={`Remove ${c}`}>
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}

                <div className="p-3 rounded-2xl border border-border bg-muted/30 max-h-44 overflow-auto">
                  {loadingClasses ? (
                    <p className="text-xs text-muted-foreground">Loading classes...</p>
                  ) : classes.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No active classes found from student records.</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {classes.map((c) => {
                        const active = selectedClasses.includes(c);
                        return (
                          <button
                            key={c}
                            type="button"
                            onClick={() => toggleClass(c)}
                            className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-all ${
                              active
                                ? "bg-indigo-600 text-white border-indigo-600"
                                : "bg-card text-foreground border-border hover:bg-muted"
                            }`}
                          >
                            {c}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
                {type === "CLASS_WISE" && selectedClasses.length === 0 && (
                  <p className="text-[11px] text-rose-600 font-semibold">Select at least one class to publish.</p>
                )}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div className="p-3 rounded-2xl bg-muted/40 border border-border/60">
                <p className="font-semibold text-foreground">Notification Sound</p>
                <p className="text-muted-foreground mt-0.5">Android default system sound</p>
              </div>
              <div className="p-3 rounded-2xl bg-muted/40 border border-border/60">
                <p className="font-semibold text-foreground">Visibility</p>
                <p className="text-muted-foreground mt-0.5">In-app history + Push notification (enabled)</p>
              </div>
            </div>

            <label className="flex items-center gap-2 text-sm font-semibold">
              <input type="checkbox" checked={isImportant} disabled={publishing}
                onChange={(event) => setIsImportant(event.target.checked)} />
              Mark as Important
            </label>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={resetForm}
                className="px-4 py-2.5 rounded-2xl text-xs font-bold text-muted-foreground hover:bg-muted border border-border transition-all"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={openConfirm}
                disabled={!canSubmit || publishing}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-xs shadow-sm transition-all active:scale-95 disabled:opacity-50"
              >
                <Send className="w-4 h-4" />
                Publish Announcement
              </button>
            </div>
          </div>
        </section>

        {/* History */}
        <section className="xl:col-span-3 bg-card border border-border rounded-3xl shadow-soft p-5 sm:p-6 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="font-extrabold text-sm">Announcement History & Delivery</h2>
              <p className="text-[11px] text-muted-foreground">Saved announcements remain available to eligible parents even if push delivery fails.</p>
            </div>
            <button type="button" disabled={managing} onClick={() => setDeleteMode(deleteMode ? null : "custom")}
              className="rounded-xl border border-border px-3 py-2 text-xs font-bold text-rose-600">
              {deleteMode ? "Close Deletion Controls" : "Delete Announcements"}
            </button>
          </div>

          {deleteMode && <div className="space-y-3 rounded-2xl border border-border p-3 text-sm">
            <div className="flex flex-wrap gap-4">
              <label><input type="radio" name="delete-mode" checked={deleteMode === "custom"} disabled={managing}
                onChange={() => setDeleteMode("custom")} /> Custom Delete</label>
              <label><input type="radio" name="delete-mode" checked={deleteMode === "general"} disabled={managing}
                onChange={() => { setDeleteMode("general"); void fetchDeleteCounts(); }} /> General Delete</label>
            </div>
            {deleteMode === "custom" ? <div className="flex flex-wrap items-center gap-3">
              <button type="button" disabled={managing || loadingList || refreshing} className="font-bold"
                onClick={() => void selectAllEligible()}>Select All</button>
              <button type="button" disabled={managing} className="font-bold" onClick={() => setSelectedIds([])}>Clear Selection</button>
              <span aria-live="polite">{selectedIds.length} selected</span>
              <button type="button" disabled={managing || !selectedIds.length} className="rounded-xl bg-rose-600 px-3 py-2 font-bold text-white disabled:opacity-50"
                onClick={() => setDeleteConfirmation({ mode: "custom", ids: selectedIds })}>Delete Selected ({selectedIds.length})</button>
            </div> : counts ? <div className="space-y-2">
              <p>{counts.total} total · {counts.important} important and protected · {counts.eligible} eligible for deletion</p>
              <button type="button" disabled={managing || !counts.eligible} className="rounded-xl bg-rose-600 px-3 py-2 font-bold text-white disabled:opacity-50"
                onClick={() => setDeleteConfirmation({ mode: "general", expected: counts.eligible })}>Delete All Non-Important Announcements</button>
            </div> : <button type="button" className="font-bold" onClick={() => void fetchDeleteCounts()}>Refresh Deletion Preview</button>}
          </div>}

          {loadingList ? (
            <div className="space-y-3 animate-pulse">
              {[1, 2, 3].map((i) => <div key={i} className="h-24 rounded-2xl bg-muted/50 border border-border" />)}
            </div>
          ) : announcements.length === 0 ? (
            <div className="text-center py-12 border border-dashed border-border rounded-2xl">
              <Megaphone className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
              <p className="font-bold text-sm">No announcements published yet</p>
              <p className="text-xs text-muted-foreground mt-1">Published announcements and delivery stats will appear here.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {announcements.map((a) => (
                <div key={a._id} className="p-4 rounded-2xl border border-border bg-muted/20 hover:bg-muted/30 transition-colors">
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        {deleteMode === "custom" && <input type="checkbox" aria-label={`Select ${a.title}`}
                          title={a.isImportant ? "Remove Important status before deleting" : undefined}
                          disabled={a.isImportant || managing} checked={!a.isImportant && selectedIds.includes(a._id)}
                          onChange={(event) => setSelectedIds((current) => event.target.checked
                            ? [...new Set([...current, a._id])] : current.filter((id) => id !== a._id))} />}
                        {a.isImportant && <span className="rounded-lg bg-amber-500/15 px-2 py-0.5 text-xs font-bold">Important</span>}
                        <span className={`px-2 py-0.5 rounded-lg text-[10px] font-extrabold border ${a.type === "GENERAL" ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20" : "bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 border-indigo-500/20"}`}>
                          {a.type === "GENERAL" ? "General" : "Class-Wise"}
                        </span>
                        <span className="text-[10px] text-muted-foreground font-semibold">{formatDateTime(a.createdAt)}</span>
                      </div>
                      <h3 className="font-bold text-sm text-foreground truncate">{a.title}</h3>
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-2 whitespace-pre-wrap">{a.message}</p>
                      {a.type === "CLASS_WISE" && a.targetClasses?.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {a.targetClasses.map((c) => (
                            <span key={c} className="px-2 py-0.5 rounded-md bg-card border border-border text-[10px] font-semibold">{c}</span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                    <button type="button" disabled={managing} onClick={() => void toggleImportant(a)}
                      className="rounded-xl border border-border px-3 py-2 text-xs font-bold">
                      {a.isImportant ? "Remove Important" : "Mark as Important"}
                    </button>
                    <button
                      onClick={() => fetchDetail(a._id)}
                      className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-card border border-border hover:bg-muted text-xs font-bold shrink-0"
                    >
                      <Eye className="w-3.5 h-3.5" /> Details
                    </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3 text-[11px]">
                    <div className="p-2 rounded-xl bg-card border border-border/60"><span className="text-muted-foreground block">Eligible parents</span><span className="font-extrabold text-foreground inline-flex items-center gap-1"><Users className="w-3 h-3" />{a.recipientCount ?? 0}</span></div>
                    <div className="p-2 rounded-xl bg-card border border-border/60"><span className="text-muted-foreground block">Registered devices</span><span className="font-extrabold text-foreground inline-flex items-center gap-1"><Smartphone className="w-3 h-3" />{a.deviceCount ?? 0}</span></div>
                    <div className="p-2 rounded-xl bg-emerald-500/5 border border-emerald-500/20"><span className="text-emerald-700 dark:text-emerald-300 block">Accepted (sent)</span><span className="font-extrabold text-emerald-700 dark:text-emerald-300 inline-flex items-center gap-1"><CheckCircle2 className="w-3 h-3" />{a.deliveryStats?.sent ?? 0}</span></div>
                    <div className="p-2 rounded-xl bg-rose-500/5 border border-rose-500/20"><span className="text-rose-700 dark:text-rose-300 block">Failed / Pending</span><span className="font-extrabold text-rose-700 dark:text-rose-300 inline-flex items-center gap-1"><AlertCircle className="w-3 h-3" />{(a.deliveryStats?.failed ?? 0)} / {(a.deliveryStats?.pending ?? 0)}</span></div>
                  </div>
                </div>
              ))}
            </div>
          )}
          {(page > 1 || hasMore) && <div className="flex items-center justify-between gap-2 text-xs">
            <button type="button" disabled={page <= 1 || refreshing || managing} onClick={() => void fetchAnnouncements(true, page - 1)}>Previous</button>
            <span>Page {page}</span>
            <button type="button" disabled={!hasMore || refreshing || managing} onClick={() => void fetchAnnouncements(true, page + 1)}>Next</button>
          </div>}
        </section>
      </div>

      <ConfirmDialog isOpen={Boolean(deleteConfirmation)} title="Permanently delete announcements?"
        description={`You are about to permanently delete ${deleteConfirmation?.mode === "general" ? deleteConfirmation.expected : deleteConfirmation?.ids.length ?? 0} non-important announcement(s). Important announcements will be preserved. This action cannot be undone.`}
        confirmLabel="Permanently Delete" onClose={() => setDeleteConfirmation(null)} onConfirm={() => void deleteAnnouncements()} />

      {/* Confirm publish dialog */}
      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="w-full max-w-2xl bg-card text-card-foreground border border-border rounded-3xl shadow-elevated overflow-hidden">
            <div className="flex items-center justify-between p-5 border-b border-border">
              <div>
                <h3 className="font-extrabold text-base">Confirm Publish Announcement</h3>
                <p className="text-xs text-muted-foreground">Review details before sending to parents.</p>
              </div>
              <button onClick={() => !publishing && setShowConfirm(false)} className="p-2 rounded-xl hover:bg-muted text-muted-foreground"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-5 space-y-4 max-h-[70vh] overflow-auto">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                <div className="p-3 rounded-2xl bg-muted/40 border border-border/60">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">Title</p>
                  <p className="font-bold mt-1 break-words">{title.trim()}</p>
                </div>
                <div className="p-3 rounded-2xl bg-muted/40 border border-border/60">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">Announcement Type</p>
                  <p className="font-bold mt-1">{type === "GENERAL" ? "General Announcement" : "Class-Wise Announcement"}</p>
                </div>
              </div>

              {type === "CLASS_WISE" && (
                <div className="p-3 rounded-2xl bg-muted/40 border border-border/60">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold mb-1.5">Selected Classes</p>
                  <div className="flex flex-wrap gap-1.5">
                    {selectedClasses.map((c) => <span key={c} className="px-2.5 py-1 rounded-full bg-indigo-600 text-white text-[11px] font-bold">{c}</span>)}
                  </div>
                </div>
              )}

              <div className="p-3 rounded-2xl bg-muted/40 border border-border/60">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold mb-1.5">Target Audience</p>
                <p className="text-sm font-semibold">{targetAudienceDescription}</p>
                <p className="text-[11px] text-muted-foreground mt-1">Parents with multiple eligible children are deduplicated (one logical notification per registered device).</p>
              </div>

              <div className="p-3 rounded-2xl bg-muted/40 border border-border/60">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold mb-1.5">Message Preview</p>
                <p className="text-sm whitespace-pre-wrap break-words">{message.trim()}</p>
              </div>

              <div className="flex items-start gap-2 p-3 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-800 dark:text-amber-200">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <p>Announcement will be saved first, then push delivery will be attempted. A temporary FCM failure will not remove the announcement from parent history.</p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 p-5 border-t border-border bg-muted/20">
              <button disabled={publishing} onClick={() => setShowConfirm(false)} className="px-4 py-2.5 rounded-2xl text-xs font-bold text-muted-foreground hover:bg-muted border border-border disabled:opacity-50">Cancel</button>
              <button disabled={publishing} onClick={publish} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-xs shadow-sm disabled:opacity-50">
                <Send className="w-4 h-4" /> {publishing ? "Publishing..." : "Confirm & Publish"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Detail modal */}
      {detailOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="w-full max-w-2xl bg-card text-card-foreground border border-border rounded-3xl shadow-elevated overflow-hidden">
            <div className="flex items-center justify-between p-5 border-b border-border">
              <div>
                <h3 className="font-extrabold text-base">Announcement Details</h3>
                <p className="text-xs text-muted-foreground">Delivery and read statistics (FCM accepted ≠ displayed/read).</p>
              </div>
              <button onClick={() => { setDetailOpen(false); setDetail(null); }} className="p-2 rounded-xl hover:bg-muted text-muted-foreground"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-5 space-y-4 max-h-[70vh] overflow-auto">
              {loadingDetail || !detail ? (
                <div className="space-y-3 animate-pulse">
                  <div className="h-20 rounded-2xl bg-muted/50" />
                  <div className="h-32 rounded-2xl bg-muted/50" />
                </div>
              ) : (
                <>
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`px-2 py-0.5 rounded-lg text-[10px] font-extrabold border ${detail.type === "GENERAL" ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20" : "bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 border-indigo-500/20"}`}>
                        {detail.type === "GENERAL" ? "General" : "Class-Wise"}
                      </span>
                      <span className="text-[11px] text-muted-foreground inline-flex items-center gap-1"><Clock3 className="w-3 h-3" />{formatDateTime(detail.createdAt)}</span>
                    </div>
                    <h4 className="font-extrabold text-lg">{detail.title}</h4>
                    <p className="text-sm whitespace-pre-wrap break-words text-foreground/90">{detail.message}</p>
                    {detail.type === "CLASS_WISE" && detail.targetClasses?.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {detail.targetClasses.map((c) => <span key={c} className="px-2.5 py-1 rounded-full bg-indigo-600/10 text-indigo-700 dark:text-indigo-300 border border-indigo-500/20 text-[11px] font-bold">{c}</span>)}
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
                    <div className="p-3 rounded-2xl bg-muted/40 border border-border/60"><p className="text-muted-foreground">Eligible parents</p><p className="font-extrabold text-base mt-0.5">{detail.recipientCount ?? 0}</p></div>
                    <div className="p-3 rounded-2xl bg-muted/40 border border-border/60"><p className="text-muted-foreground">Registered devices</p><p className="font-extrabold text-base mt-0.5">{detail.deviceCount ?? 0}</p></div>
                    <div className="p-3 rounded-2xl bg-muted/40 border border-border/60"><p className="text-muted-foreground">Read in app (parents)</p><p className="font-extrabold text-base mt-0.5">{detail.details?.readCount ?? 0}</p></div>
                    <div className="p-3 rounded-2xl bg-emerald-500/5 border border-emerald-500/20"><p className="text-emerald-700 dark:text-emerald-300">FCM accepted (sent)</p><p className="font-extrabold text-base mt-0.5 text-emerald-700 dark:text-emerald-300">{detail.deliveryStats?.sent ?? 0}</p></div>
                    <div className="p-3 rounded-2xl bg-amber-500/5 border border-amber-500/20"><p className="text-amber-700 dark:text-amber-300">Pending</p><p className="font-extrabold text-base mt-0.5 text-amber-700 dark:text-amber-300">{detail.deliveryStats?.pending ?? 0}</p></div>
                    <div className="p-3 rounded-2xl bg-rose-500/5 border border-rose-500/20"><p className="text-rose-700 dark:text-rose-300">Failed</p><p className="font-extrabold text-base mt-0.5 text-rose-700 dark:text-rose-300">{detail.deliveryStats?.failed ?? 0}</p></div>
                  </div>

                  <div className="p-3 rounded-2xl bg-muted/30 border border-border/60">
                    <p className="text-xs font-bold mb-2">Delivery error breakdown (top)</p>
                    {detail.details?.deliveryBreakdown?.length ? (
                      <div className="space-y-1.5 text-xs">
                        {detail.details.deliveryBreakdown.map((d, idx) => (
                          <div key={idx} className="flex items-center justify-between gap-3 p-2 rounded-xl bg-card border border-border/60">
                            <span className="font-mono text-[11px] break-all">{d.errorCode || "(no error code)"}</span>
                            <span className="font-bold shrink-0">{d.status || "?"}: {d.count}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">No delivery error records.</p>
                    )}
                    <p className="text-[10px] text-muted-foreground mt-2">Note: "FCM accepted" means the message was accepted by FCM for delivery, not that it was displayed or read on device.</p>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

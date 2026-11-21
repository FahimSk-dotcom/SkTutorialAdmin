"use client";

import { CalendarDays } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { SCHOOL_DAYS, timetableInput, type TimetableData, type TimetableLayout, type TimetableView } from "@/lib/timetable-model";

type ClassOption = { id: string; label: string };
type LoadResult = { key: string; timetable: TimetableView | null; error?: string };
const button = "rounded-xl border border-border px-4 py-2 text-sm font-semibold hover:bg-muted disabled:opacity-50";
const primary = "rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50";
const field = "w-full rounded-xl border border-border bg-background px-3 py-2 text-sm disabled:opacity-50";

async function request<T>(classId?: string, body?: unknown): Promise<T> {
  const url = `/api/admin/timetables${classId ? `/${encodeURIComponent(classId)}` : ""}`;
  const response = await fetch(url, {
    cache: "no-store",
    ...(body ? { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error ?? "Unable to load or save the timetable.");
  return data as T;
}

function convertLayout(layout: TimetableLayout, current?: TimetableData): TimetableData {
  const isPublished = current?.isPublished ?? false;
  const subjectAt = (index: number) => current?.layout === "single_subject" ? current.days[index].subject
    : current?.days[index].classwork ?? "";
  return layout === "single_subject"
    ? { layout, isPublished, days: SCHOOL_DAYS.map((day, index) => ({ day, subject: subjectAt(index) })) }
    : { layout, isPublished, days: SCHOOL_DAYS.map((day, index) => ({ day, classwork: subjectAt(index), homework: "" })) };
}

export default function TimetablesPage() {
  const [classes, setClasses] = useState<ClassOption[]>();
  const [classId, setClassId] = useState("");
  const [classAttempt, setClassAttempt] = useState(0);
  const [readAttempt, setReadAttempt] = useState(0);
  const [result, setResult] = useState<LoadResult>();
  const [draft, setDraft] = useState<TimetableData>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [layoutConfirmation, setLayoutConfirmation] = useState<TimetableLayout>();
  const savingRef = useRef(false);
  const viewKey = classId ? `${classId}:${readAttempt}` : "";
  const load = result?.key === viewKey ? result : undefined;
  const timetable = load?.timetable;
  const displayed = draft ?? timetable;

  useEffect(() => {
    let active = true;
    void request<{ classes: ClassOption[] }>().then((data) => {
      if (!active) return;
      setClasses(data.classes);
      setClassId((current) => current || data.classes.find((entry) => entry.id === "1")?.id || data.classes[0]?.id || "");
    }).catch((reason: Error) => { if (active) setError(reason.message); });
    return () => { active = false; };
  }, [classAttempt]);

  useEffect(() => {
    if (!classId) return;
    let active = true;
    void request<{ timetable: TimetableView | null }>(classId).then((data) => {
      if (active) setResult({ key: viewKey, timetable: data.timetable });
    }).catch((reason: Error) => {
      if (active) setResult({ key: viewKey, timetable: null, error: reason.message });
    });
    return () => { active = false; };
  }, [classId, viewKey]);

  function updateCell(index: number, fieldName: "subject" | "classwork" | "homework", value: string) {
    setDraft((current) => {
      if (!current) return current;
      if (current.layout === "single_subject") {
        return { ...current, days: current.days.map((row, position) => position === index ? { ...row, subject: value } : row) };
      }
      if (fieldName === "subject") return current;
      return { ...current, days: current.days.map((row, position) => position === index ? { ...row, [fieldName]: value } : row) };
    });
  }

  function changeLayout(layout: TimetableLayout) {
    if (!draft || draft.layout === layout) return;
    if (draft.layout === "classwork_homework" && draft.days.some(({ homework }) => homework.trim())) {
      setLayoutConfirmation(layout);
      return;
    }
    setDraft(convertLayout(layout, draft));
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!draft || savingRef.current) return;
    const parsed = timetableInput.safeParse(draft);
    if (!parsed.success) {
      setError("Enter a subject of 1–100 characters in every required cell.");
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setError("");
    try {
      const data = await request<{ timetable: TimetableView }>(classId, {
        timetable: parsed.data, revision: timetable?.revision ?? null,
      });
      setResult({ key: viewKey, timetable: data.timetable });
      setDraft(undefined);
      toast.success(data.timetable.isPublished ? "Published timetable saved." : "Unpublished timetable saved.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to save the timetable.");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  function cell(day: string, column: "subject" | "classwork" | "homework", value: string, index: number) {
    return <td className="p-3 sm:p-4 break-words">
      {draft ? <input className={field} aria-label={`${day} ${column}`} required maxLength={100} value={value}
        onChange={(event) => updateCell(index, column, event.target.value)} /> : value}
    </td>;
  }

  return (
    <div className="space-y-5">
      <h1 className="flex items-center gap-2 text-2xl font-bold">
        <CalendarDays className="size-6 text-indigo-600" /> Timetable Management
      </h1>
      <section className="space-y-5 rounded-3xl border border-border bg-card p-4 shadow-soft sm:p-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <label className="block w-full max-w-xs text-sm font-semibold">
            Select Class
            <select className={`${field} mt-1`} disabled={!classes || Boolean(draft)} value={classId} onChange={(event) => {
              setError("");
              setClassId(event.target.value);
            }}>
              {!classes && <option value="">Loading classes…</option>}
              {classes?.map(({ id, label }) => <option key={id} value={id}>{label}</option>)}
            </select>
          </label>
          {load && !load.error && !draft && (
            <button type="button" className={primary} onClick={() => {
              setError("");
              setDraft(timetable ? { layout: timetable.layout, days: timetable.days, isPublished: timetable.isPublished } as TimetableData
                : convertLayout("classwork_homework"));
            }}>{timetable ? "Edit Timetable" : "Create Timetable"}</button>
          )}
        </div>
        {error && <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl border border-rose-500/30 p-3 text-sm text-rose-600 dark:text-rose-400">
          <p>{error}</p>
          {!classes && <button type="button" className={button} onClick={() => { setError(""); setClassAttempt((i) => i + 1); }}>Retry</button>}
          {draft && <button type="button" className={button} onClick={() => {
            setDraft(undefined); setError(""); setReadAttempt((i) => i + 1);
          }}>Discard Edits and Reload</button>}
        </div>}
        {viewKey && !load && <p role="status" className="text-sm text-muted-foreground">Loading timetable…</p>}
        {load?.error && <div role="alert" className="flex flex-wrap items-center gap-3 text-sm">
          <p>{load.error}</p>
          <button type="button" className={button} onClick={() => setReadAttempt((i) => i + 1)}>Retry</button>
        </div>}
        {load && !load.error && !displayed && <p className="rounded-2xl border border-dashed border-border p-6 text-sm">No timetable configured.</p>}

        {displayed && (
          <form onSubmit={(event) => void save(event)} className="space-y-4">
            <fieldset disabled={saving} className="space-y-4">
              <div className="flex flex-wrap items-end justify-between gap-3">
                {draft ? <>
                  <label className="block w-full max-w-xs text-sm font-semibold">
                    Layout
                    <select className={`${field} mt-1`} value={draft.layout} onChange={(event) => changeLayout(event.target.value as TimetableLayout)}>
                      <option value="single_subject">Single Subject</option>
                      <option value="classwork_homework">Classwork and Homework</option>
                    </select>
                  </label>
                  <label className="flex items-center gap-2 text-sm font-semibold">
                    <input type="checkbox" checked={draft.isPublished} onChange={(event) => setDraft({ ...draft, isPublished: event.target.checked })} />
                    Published to parents
                  </label>
                </> : <>
                  <span className={`rounded-xl px-3 py-1.5 text-sm font-semibold ${displayed.isPublished ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "bg-muted"}`}>
                    {displayed.isPublished ? "Published" : "Unpublished"}
                  </span>
                  {timetable?.updatedAt && <span className="text-xs text-muted-foreground">
                    Updated {new Date(timetable.updatedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST
                  </span>}
                </>}
              </div>
              <div className="overflow-x-auto rounded-2xl border border-border">
                <table className="w-full table-fixed text-left text-sm">
                  <thead className="bg-indigo-600 text-white">
                    <tr>
                      <th className="w-[30%] p-3 sm:p-4" scope="col">Day</th>
                      {displayed.layout === "single_subject" ? <th className="p-3 sm:p-4" scope="col">Subject</th> : <>
                        <th className="p-3 sm:p-4" scope="col">Classwork</th>
                        <th className="p-3 sm:p-4" scope="col">Homework</th>
                      </>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {displayed.layout === "single_subject" ? displayed.days.map((row, index) => <tr className="even:bg-muted/40" key={row.day}>
                      <th scope="row" className="p-3 font-semibold sm:p-4">{row.day}</th>
                      {cell(row.day, "subject", row.subject, index)}
                    </tr>) : displayed.days.map((row, index) => <tr className="even:bg-muted/40" key={row.day}>
                      <th scope="row" className="p-3 font-semibold sm:p-4">{row.day}</th>
                      {cell(row.day, "classwork", row.classwork, index)}
                      {cell(row.day, "homework", row.homework, index)}
                    </tr>)}
                  </tbody>
                </table>
              </div>
              {draft && <div className="flex flex-wrap justify-end gap-2">
                <button type="button" className={button} onClick={() => { setDraft(undefined); setError(""); }}>Cancel</button>
                <button className={primary}>{saving ? "Saving…" : "Save Changes"}</button>
              </div>}
            </fieldset>
          </form>
        )}
      </section>
      <ConfirmDialog isOpen={Boolean(layoutConfirmation)} title="Switch to Single Subject?"
        description="The current Classwork entries will become subjects. Homework entries will be removed when you save."
        confirmLabel="Change Layout" onConfirm={() => {
          if (layoutConfirmation && draft) setDraft(convertLayout(layoutConfirmation, draft));
        }} onClose={() => setLayoutConfirmation(undefined)} />
    </div>
  );
}

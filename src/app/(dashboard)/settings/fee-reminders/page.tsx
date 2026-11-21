"use client";

import Link from "next/link";
import { BellRing } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import {
  FEE_REMINDER_CRON_TARGET, REMINDER_FREQUENCIES, formatReminderAmount,
  type ReminderSettings, type ReminderSettingsInput,
} from "@/lib/fee-reminder-config";
import type { ReminderExecutionSummary, ReminderPreview } from "@/lib/fee-reminders";

const card = "space-y-4 rounded-3xl border border-border bg-card p-5 shadow-soft sm:p-6";
const field = "mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm";
const button = "rounded-xl px-4 py-2 text-sm font-semibold disabled:opacity-50";
const primary = `${button} bg-indigo-600 text-white hover:bg-indigo-700`;
const secondary = `${button} border border-border hover:bg-muted`;

async function reminderRequest<T>(action: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(`/api/admin/fee-reminders/${action}`, {
    method,
    cache: "no-store",
    ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error ?? "Request failed. Check execution history before repeating a send.");
  return data as T;
}

const displayDate = (date: Date) => new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata",
}).format(new Date(date));

export default function FeeReminderSettingsPage() {
  const [settings, setSettings] = useState<ReminderSettings | null>(null);
  const [saved, setSaved] = useState<ReminderSettings | null>(null);
  const [history, setHistory] = useState<ReminderExecutionSummary[]>([]);
  const [preview, setPreview] = useState<ReminderPreview | null>(null);
  const [testOpen, setTestOpen] = useState(false);
  const [parentId, setParentId] = useState("");
  const [confirmation, setConfirmation] = useState<ReminderPreview | null>(null);
  const [result, setResult] = useState<ReminderExecutionSummary | null>(null);
  const [busy, setBusy] = useState("Loading settings");
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const dirty = JSON.stringify(settings) !== JSON.stringify(saved);
  const selectedParent = preview?.parents.find((parent) => parent.parentId === parentId && parent.deviceCount > 0);

  useEffect(() => {
    let active = true;
    void Promise.all([
      reminderRequest<ReminderSettings>("settings"),
      reminderRequest<ReminderExecutionSummary[]>("history"),
    ]).then(([loaded, rows]) => {
      if (!active) return;
      setSettings(loaded);
      setSaved(loaded);
      setHistory(rows);
    }).catch((reason: Error) => {
      if (active) setError(reason.message);
    }).finally(() => {
      if (active) setBusy("");
    });
    return () => { active = false; };
  }, []);

  async function perform(label: string, task: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setError("");
    setBusy(label);
    try {
      await task();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The operation failed.");
    } finally {
      setBusy("");
      inFlight.current = false;
    }
  }

  function edit<K extends keyof ReminderSettingsInput>(key: K, value: ReminderSettingsInput[K]) {
    setSettings((current) => current && { ...current, [key]: value });
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!settings) return;
    const { enabled, frequency, title, messageTemplate } = settings;
    void perform("Saving settings", async () => {
      const loaded = await reminderRequest<ReminderSettings>("settings", "PUT", {
        enabled, frequency, title, messageTemplate,
      });
      setSettings(loaded);
      setSaved(loaded);
      setPreview(null);
      setParentId("");
      toast.success("Fee reminder settings saved");
    });
  }

  function loadPreview(next: "preview" | "test" | "run") {
    void perform("Checking outstanding fees", async () => {
      const latest = await reminderRequest<ReminderPreview>("preview");
      setPreview(latest);
      if (next === "test") setTestOpen(true);
      if (next === "run") setConfirmation(latest);
    });
  }

  function send(action: "test" | "run", target?: string) {
    void perform(action === "test" ? "Sending test reminder" : "Running fee reminders", async () => {
      const storageKey = `fee-reminders:${action}:${target ?? "all"}`;
      const requestId = sessionStorage.getItem(storageKey) ?? crypto.randomUUID();
      sessionStorage.setItem(storageKey, requestId);
      setResult(null);
      try {
        const summary = await reminderRequest<ReminderExecutionSummary>(action, "POST", {
          requestId, ...(target ? { parentId: target } : { confirmed: true }),
        });
        setResult(summary);
        if (summary.status !== "running" && !summary.resumable) sessionStorage.removeItem(storageKey);
      } finally {
        const rows = await reminderRequest<ReminderExecutionSummary[]>("history").catch(() => null);
        if (rows) setHistory(rows);
      }
    });
  }

  return (
    <div className="space-y-5">
      <header className="space-y-2">
        <Link href="/settings" className="text-sm font-semibold text-indigo-600 dark:text-indigo-400">Settings</Link>
        <h1 className="flex items-center gap-3 text-2xl font-bold"><BellRing className="size-6 text-indigo-600" /> Fee Reminders</h1>
      </header>
      {busy && <p role="status" className="text-sm text-muted-foreground">{busy}…</p>}
      {error && <p role="alert" className="rounded-xl border border-rose-500/30 p-3 text-sm text-rose-600 dark:text-rose-400">{error}</p>}

      {settings && (
        <>
          <form onSubmit={save} className={card}>
            <h2 className="font-bold">Automatic reminders</h2>
            <fieldset disabled={Boolean(busy)} className="space-y-4">
              <label className="flex items-center gap-3 text-sm font-semibold">
                <input type="checkbox" role="switch" checked={settings.enabled} onChange={(event) => edit("enabled", event.target.checked)} className="size-5 accent-indigo-600" />
                Enable Automatic Fee Reminders
              </label>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="text-sm font-medium">
                  Reminder frequency
                  <select className={field} value={settings.frequency} onChange={(event) => edit("frequency", event.target.value as ReminderSettings["frequency"])}>
                    {Object.entries(REMINDER_FREQUENCIES).map(([value, option]) => <option key={value} value={value}>{option.label}</option>)}
                  </select>
                </label>
                <div className="rounded-xl bg-muted/60 p-3 text-sm">
                  <p className="font-semibold">Deployment schedule · Daily at {FEE_REMINDER_CRON_TARGET}</p>
                  <p className="mt-1 text-muted-foreground">Vercel Hobby runs within the configured UTC hour. Changing the time requires a redeployment.</p>
                  {saved?.scheduleAnchorDate && <p className="mt-1 text-muted-foreground">Kolkata schedule anchor {saved.scheduleAnchorDate}</p>}
                </div>
              </div>
              <label className="block text-sm font-medium">
                Notification title
                <input className={field} maxLength={100} required value={settings.title} onChange={(event) => edit("title", event.target.value)} />
              </label>
              <label className="block text-sm font-medium">
                Notification message
                <textarea className={field} required rows={4} maxLength={400} value={settings.messageTemplate} onChange={(event) => edit("messageTemplate", event.target.value)} />
              </label>
              <p className="text-sm text-muted-foreground">Placeholders <code>{"{studentName}"}</code>, <code>{"{feeMonth}"}</code>, <code>{"{amount}"}</code>. Multiple fees use a consolidated message.</p>
              <button className={primary} disabled={!dirty}>Save Settings</button>
            </fieldset>
          </form>

          <section className={card}>
            <h2 className="font-bold">Preview and send</h2>
            <p className="text-sm text-muted-foreground">Manual batches send to each parent at most once per Kolkata date. Single-parent tests are separate.</p>
            {dirty && <p className="text-sm text-muted-foreground">Save your settings to preview or send with the updated template.</p>}
            <div className="flex flex-wrap gap-2">
              <button className={secondary} disabled={Boolean(busy) || dirty} onClick={() => loadPreview("preview")}>Preview Eligible Parents</button>
              <button className={secondary} disabled={Boolean(busy) || dirty} onClick={() => loadPreview("test")}>Send Test Notification</button>
              <button className={primary} disabled={Boolean(busy) || dirty} onClick={() => loadPreview("run")}>Run Reminder Now</button>
            </div>
            {testOpen && preview && (
              <div className="space-y-3 rounded-2xl border border-border p-4">
                <label className="block text-sm font-medium">
                  Test recipient
                  <select value={selectedParent?.parentId ?? ""} onChange={(event) => setParentId(event.target.value)} className={field} disabled={Boolean(busy) || dirty}>
                    <option value="">Select one parent with a registered device</option>
                    {preview.parents.filter((parent) => parent.deviceCount > 0).map((parent) =>
                      <option key={parent.parentId} value={parent.parentId}>{parent.parentName} · {parent.students.map((student) => student.name).join(", ")}</option>
                    )}
                  </select>
                </label>
                {selectedParent && <ParentDetails parent={selectedParent} title={preview.title} />}
                <button className={primary} disabled={Boolean(busy) || dirty || !selectedParent} onClick={() => selectedParent && send("test", selectedParent.parentId)}>
                  Send to Selected Parent
                </button>
              </div>
            )}
            {result && (
              <div role="status" className="rounded-xl bg-muted/60 p-3 text-sm">
                <p className="font-semibold capitalize">{result.type} execution · {result.status}</p>
                <p>{result.eligible} eligible · {result.attempted} attempted · {result.accepted} accepted by FCM · {result.failed} failed · {result.skipped} skipped · {result.uncertain} uncertain · {result.unprocessed} unprocessed</p>
                {result.error && <p>{result.error}</p>}
                {result.status === "running" && <p>Refresh history to check progress. Repeating this action in this tab checks the same request.</p>}
                {result.resumable && <p>Repeat this action in this tab to continue with unprocessed parents.</p>}
              </div>
            )}
            {preview && (
              <div className="space-y-3">
                <p className="font-semibold">{preview.totalEligible} eligible {preview.totalEligible === 1 ? "parent" : "parents"} · {formatReminderAmount(preview.totalOutstanding)} outstanding</p>
                <div className="grid gap-3 lg:grid-cols-2">
                  {preview.parents.map((parent) => <ParentDetails key={parent.parentId} parent={parent} title={preview.title} />)}
                </div>
              </div>
            )}
          </section>

          <section className={card}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-bold">Execution history</h2>
              <button className={secondary} disabled={Boolean(busy)} onClick={() => void perform("Loading history", async () =>
                setHistory(await reminderRequest<ReminderExecutionSummary[]>("history"))
              )}>Refresh History</button>
            </div>
            <p className="text-sm text-muted-foreground">Accepted counts are device sends accepted by Firebase Cloud Messaging. Device delivery is unconfirmed.</p>
            {history.length === 0 ? <p className="text-sm">No executions recorded.</p> : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-border">
                    <tr>{["Started (IST)", "Type", "Eligible", "Attempted", "Accepted", "Failed", "Skipped", "Status"].map((label) => <th key={label} scope="col" className="p-2">{label}</th>)}</tr>
                  </thead>
                  <tbody>
                    {history.map((row) => (
                      <tr key={row.id} className="border-b border-border align-top">
                        <td className="whitespace-nowrap p-2">{displayDate(row.startedAt)}</td>
                        <td className="p-2 capitalize">{row.type}</td>
                        <td className="p-2">{row.eligible}</td><td className="p-2">{row.attempted}</td><td className="p-2">{row.accepted}</td><td className="p-2">{row.failed}</td><td className="p-2">{row.skipped}</td>
                        <td className="p-2">
                          <details>
                            <summary className="cursor-pointer capitalize">{row.status}</summary>
                            <p className="break-all">ID {row.id}</p>
                            {row.scheduledAt && <p>Scheduled {displayDate(row.scheduledAt)}</p>}
                            <p>{row.uncertain} uncertain · {row.unprocessed} unprocessed</p>
                            {row.error && <p>{row.error}</p>}
                            {row.errorCodes.length > 0 && <p className="break-all">{row.errorCodes.join(", ")}</p>}
                          </details>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
      <ConfirmDialog
        isOpen={Boolean(confirmation)}
        title="Run fee reminders now?"
        description={`You are about to send fee reminders to all eligible parents with outstanding fees. Do you want to continue? Currently eligible: ${confirmation?.totalEligible ?? 0}.`}
        confirmLabel="Send Fee Reminders"
        onConfirm={() => send("run")}
        onClose={() => setConfirmation(null)}
      />
    </div>
  );
}

function ParentDetails({ parent, title }: { parent: ReminderPreview["parents"][number]; title: string }) {
  return (
    <article className="space-y-2 rounded-xl border border-border p-3 text-sm">
      <h3 className="font-semibold">{parent.parentName} · {formatReminderAmount(parent.total)}</h3>
      <p className="text-muted-foreground">{parent.deviceCount} registered {parent.deviceCount === 1 ? "device" : "devices"}</p>
      <ul className="space-y-1">
        {parent.students.map((student) => (
          <li key={student.studentId}>
            <span className="font-medium">{student.name}</span>{" · "}
            {student.months.map((month) => `${month.monthName} (${formatReminderAmount(month.amount)})`).join(", ")}
          </li>
        ))}
      </ul>
      <div className="rounded-lg bg-muted/60 p-2">
        <p className="font-semibold">{title}</p>
        <p className="whitespace-pre-line break-words">{parent.body}</p>
      </div>
    </article>
  );
}

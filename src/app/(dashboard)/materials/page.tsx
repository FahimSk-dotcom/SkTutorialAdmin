"use client";

import { BookOpen, Plus } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import type { AdminMaterial, MaterialUploadTicket } from "@/lib/materials";

type Details = Pick<AdminMaterial, "title" | "description" | "type" | "classes" | "subject" | "status">;
type Page = { items: AdminMaterial[]; classes: string[]; subjects: string[]; page: number; hasMore: boolean };
type Preparation = { material: AdminMaterial; tickets: MaterialUploadTicket[]; notice?: string };
const empty: Details = { title: "", subject: "", description: "", type: "notes", classes: [], status: "draft" };
const panel = "space-y-4 rounded-3xl border border-border bg-card p-4 shadow-soft sm:p-6";
const field = "mt-1 block w-full rounded-xl border border-border bg-background px-3 py-2 text-sm";
const button = "rounded-xl border border-border px-3 py-2 text-sm font-semibold hover:bg-muted disabled:opacity-50";
const primary = "rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50";
const fileFields = (files: File[]) => files.map((file) => ({ originalName: file.name, size: file.size }));

async function api<T>(path = "", method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(`/api/admin/materials${path}`, {
    method, cache: "no-store",
    ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error ?? "The connection ended. Refresh the list before retrying.");
  return data as T;
}

function uploadFile(ticket: MaterialUploadTicket, file: File, onProgress: (loaded: number, total: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", ticket.url);
    request.timeout = 120_000;
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded, event.total);
    };
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) resolve();
      else {
        let reason = "";
        try { reason = JSON.parse(request.responseText)?.error?.message ?? ""; } catch { /* provider returned no JSON */ }
        reject(new Error(`Cloudinary could not upload ${file.name}${reason ? `: ${reason}` : "."}`));
      }
    };
    request.onerror = request.ontimeout = () => reject(new Error(`The connection ended while uploading ${file.name}.`));
    const data = new FormData();
    Object.entries(ticket.fields).forEach(([name, value]) => data.append(name, value));
    data.append("file", file);
    request.send(data);
  });
}

function getDetails(row: AdminMaterial): Details {
  return { title: row.title, description: row.description, type: row.type, classes: row.classes, subject: row.subject, status: row.status };
}

export default function MaterialsPage() {
  const [data, setData] = useState<Page>();
  const [q, setQuery] = useState("");
  const [type, setType] = useState("");
  const [status, setStatus] = useState("");
  const [className, setClass] = useState("");
  const [subject, setSubject] = useState("");
  const [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const [listLoading, setListLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [editor, setEditor] = useState<{ row?: AdminMaterial; details: Details; operationId: string; notifyStudents: boolean }>();
  const [files, setFiles] = useState<File[]>([]);
  const [deleting, setDeleting] = useState<AdminMaterial>();
  const inFlight = useRef(false);

  useEffect(() => {
    let active = true;
    const timeout = window.setTimeout(() => {
      setListLoading(true);
      const params = new URLSearchParams({ q, type, status, class: className, subject, page: String(page) });
      void api<Page>(`?${params}`).then((response) => {
        if (active) setData(response);
      }).catch((reason: Error) => {
        if (active) setError(reason.message);
      }).finally(() => {
        if (active) setListLoading(false);
      });
    }, 200);
    return () => { active = false; window.clearTimeout(timeout); };
  }, [q, type, status, className, subject, page, refresh]);

  function startEditor(row?: AdminMaterial) {
    setFiles([]);
    setError("");
    setEditor({ row, details: row?.pending?.details ?? (row ? getDetails(row) : empty),
      operationId: row?.pending?.id ?? crypto.randomUUID(), notifyStudents: Boolean(row?.pending?.notifyStudents) });
  }

  function edit<K extends keyof Details>(key: K, value: Details[K]) {
    setEditor((current) => current && { ...current, details: { ...current.details, [key]: value } });
  }

  function perform(label: string, work: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(label);
    setError("");
    void work().catch((reason: Error) => setError(reason.message)).finally(() => {
      setBusy("");
      inFlight.current = false;
      setRefresh((value) => value + 1);
    });
  }

  function save(event: FormEvent) {
    event.preventDefault();
    if (!editor) return;
    const { row, details, operationId } = editor;
    const notifyStudents = editor.notifyStudents && details.status === "published";
    perform("Saving material", async () => {
      let preparation: Preparation | undefined;
      if (row?.pending) {
        if (files.length && (files.length !== row.pending.files.length ||
          files.some((file, index) => file.name !== row.pending?.files[index].originalName ||
            file.size !== row.pending?.files[index].size))) {
          throw new Error("Reselect the same files in their original order, or verify the files already uploaded.");
        }
        if (files.length) preparation = await api<Preparation>(`/${row.id}`, "PATCH", { action: "resume", operationId });
      } else if (!row) {
        if (!files.length) throw new Error("Choose at least one file.");
        preparation = await api<Preparation>("", "POST", { id: operationId, details, files: fileFields(files), notifyStudents });
      } else if (files.length) {
        preparation = await api<Preparation>(`/${row.id}`, "PATCH", {
          action: "prepare", revision: row.revision, operationId, details, files: fileFields(files), notifyStudents,
        });
      } else {
        await api(`/${row.id}`, "PATCH", { action: "details", revision: row.revision, details });
      }
      const pending = preparation?.material.pending ?? row?.pending;
      if (pending) {
        // Preserve the server reservation in the editor even if the browser upload is interrupted.
        if (preparation) setEditor({ row: preparation.material, details: pending.details, operationId, notifyStudents: pending.notifyStudents });
        for (const [index, ticket] of (preparation?.tickets ?? []).entries()) {
          setBusy(`Uploading file ${index + 1} of ${files.length}`);
          await uploadFile(ticket, files[index], (loaded, total) => {
            setBusy(`Uploading file ${index + 1} of ${files.length} · ${Math.round(100 * loaded / total)}%`);
          });
        }
        setBusy("Verifying file content and private delivery");
        const result = await api<Preparation>(`/${preparation?.material.id ?? row?.id}`, "PATCH", { action: "commit", operationId });
        if (result.notice) toast.info(result.notice);
      }
      setEditor(undefined);
      setFiles([]);
      toast.success("Material saved.");
    });
  }

  function openFile(materialId: string, fileId: string) {
    const tab = window.open("about:blank", "_blank");
    if (!tab) {
      setError("Allow pop-ups to preview the file.");
      return;
    }
    tab.opener = null;
    void api<{ url: string }>(`/${materialId}/files/${fileId}`).then(({ url }) => {
      tab.location.replace(url);
    }).catch((reason: Error) => {
      tab.close();
      setError(reason.message);
    });
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="flex items-center gap-2 text-2xl font-bold"><BookOpen className="size-6 text-indigo-600" /> Assignments &amp; Notes</h1>
        <button className={primary} disabled={Boolean(busy) || !data} onClick={() => startEditor()}>
          <Plus className="mr-1 inline size-4" /> Upload Material
        </button>
      </header>
      {error && <p role="alert" className="rounded-xl border border-rose-500/30 p-3 text-sm text-rose-600 dark:text-rose-400">{error}</p>}
      {busy && <p role="status" className="text-sm text-muted-foreground">{busy}…</p>}
      {editor && (
        <form className={panel} onSubmit={save} key={editor.operationId}>
          <div className="flex justify-between gap-3">
            <h2 className="font-bold">{editor.row?.pending ? "Resume upload" : editor.row ? "Edit material" : "New material"}</h2>
            <button type="button" className={button} disabled={Boolean(busy)} onClick={() => setEditor(undefined)}>Close</button>
          </div>
          <fieldset disabled={Boolean(busy) || Boolean(editor.row?.pending)} className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">Title<input className={field} required maxLength={120} value={editor.details.title} onChange={(event) => edit("title", event.target.value)} /></label>
            <label className="text-sm">Subject<input className={field} required maxLength={80} list="material-subjects" value={editor.details.subject} onChange={(event) => edit("subject", event.target.value)} /></label>
            <datalist id="material-subjects">{data?.subjects.map((entry) => <option value={entry} key={entry} />)}</datalist>
            <label className="text-sm">Type<select className={field} value={editor.details.type} onChange={(event) => edit("type", event.target.value as Details["type"])}><option value="notes">Notes</option><option value="assignment">Assignment</option></select></label>
            <label className="text-sm">Publication<select className={field} value={editor.details.status} onChange={(event) => edit("status", event.target.value as Details["status"])}><option value="draft">Draft</option><option value="published">Published</option></select></label>
            <label className="text-sm sm:col-span-2">Description<textarea className={field} rows={3} maxLength={3000} value={editor.details.description} onChange={(event) => edit("description", event.target.value)} /></label>
            <div className="sm:col-span-2">
              <p className="mb-2 text-sm font-medium">Target classes</p>
              <div className="flex flex-wrap gap-2">
                {Array.from(new Set([...(data?.classes ?? []), ...editor.details.classes])).map((value) => (
                  <label className="flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm" key={value}>
                    <input type="checkbox" checked={editor.details.classes.includes(value)} onChange={(event) =>
                      edit("classes", event.target.checked ? [...editor.details.classes, value] : editor.details.classes.filter((item) => item !== value))
                    } /> {value}
                  </label>
                ))}
              </div>
            </div>
          </fieldset>
          {editor.row?.pending && <p className="text-sm">Pending files · {editor.row.pending.files.map(({ originalName }) => originalName).join(", ")}</p>}
          <label className="block text-sm">
            {editor.row?.pending ? "Reselect files to retry upload, or leave blank to verify" : editor.row ? "Replace all files (optional)" : "Files"}
            <input className={field} type="file" multiple accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.webp" required={!editor.row} disabled={Boolean(busy)}
              onChange={(event) => setFiles(Array.from(event.target.files ?? []))} />
          </label>
          <p className="text-xs text-muted-foreground">Up to six PDF, DOC, DOCX, JPG, JPEG, PNG, or WEBP files.</p>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={editor.details.status === "published" && editor.notifyStudents}
              disabled={Boolean(busy) || Boolean(editor.row?.pending) || editor.details.status !== "published" || Boolean(editor.row && !files.length)}
              onChange={(event) => setEditor({ ...editor, notifyStudents: event.target.checked })} />
            Notify students in the selected classes when the upload is published
          </label>
          <button className={primary} disabled={Boolean(busy)}>{editor.row?.pending ? "Verify and Save" : "Save Material"}</button>
        </form>
      )}

      <section className={panel}>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          <input aria-label="Search materials" placeholder="Search materials" className={field} value={q} onChange={(event) => { setQuery(event.target.value); setPage(1); }} />
          <select aria-label="Type filter" className={field} value={type} onChange={(event) => { setType(event.target.value); setSubject(""); setPage(1); }}><option value="">All types</option><option value="notes">Notes</option><option value="assignment">Assignment</option></select>
          <select aria-label="Publication filter" className={field} value={status} onChange={(event) => { setStatus(event.target.value); setSubject(""); setPage(1); }}><option value="">All statuses</option><option value="draft">Draft</option><option value="published">Published</option></select>
          <select aria-label="Class filter" className={field} value={className} onChange={(event) => { setClass(event.target.value); setSubject(""); setPage(1); }}><option value="">All classes</option>{data?.classes.map((entry) => <option key={entry}>{entry}</option>)}</select>
          <select aria-label="Subject filter" className={field} value={subject} onChange={(event) => { setSubject(event.target.value); setPage(1); }}><option value="">All subjects</option>{data?.subjects.map((entry) => <option key={entry}>{entry}</option>)}</select>
        </div>
        {listLoading && <p role="status" className="text-sm text-muted-foreground">Loading materials…</p>}
        {!listLoading && data?.items.length === 0 && <p className="text-sm text-muted-foreground">No matching materials.</p>}
        <div className="grid gap-3 lg:grid-cols-2">
          {data?.items.map((row) => (
            <article key={row.id} className="space-y-3 rounded-2xl border border-border p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <h2 className="break-words font-bold">{row.title}</h2>
                  <p className="text-sm text-muted-foreground">{row.subject} · {row.type === "notes" ? "Notes" : "Assignment"} · {row.classes.join(", ")}</p>
                </div>
                <span className="rounded-full bg-muted px-3 py-1 text-xs font-semibold capitalize">{row.state === "active" ? row.status : row.state}</span>
              </div>
              <p className="text-xs text-muted-foreground">{row.files.length} files · {new Date(row.createdAt).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" })}</p>
              {row.pending && <p className="text-sm text-muted-foreground">Upload pending · {row.pending.files.length} files</p>}
              {row.cleanupCount > 0 && <p className="text-sm text-muted-foreground">{row.cleanupCount} replaced files pending cleanup</p>}
              {row.state === "active" && <details>
                <summary className="cursor-pointer text-sm font-semibold">Preview</summary>
                <p className="my-2 whitespace-pre-wrap break-words text-sm">{row.description}</p>
                <div className="flex flex-wrap gap-2">{row.files.map((file) =>
                  <button key={file.id} className={button} onClick={() => openFile(row.id, file.id)}>{file.originalName}</button>
                )}</div>
              </details>}
              <div className="flex flex-wrap gap-2">
                {row.notificationPending && row.state === "active" && <button className={button} disabled={Boolean(busy)} onClick={() =>
                  perform("Checking announcement", async () => {
                    const result = await api<Preparation>(`/${row.id}`, "PATCH", { action: "notify" });
                    if (result.notice) toast.info(result.notice);
                  })
                }>Retry Notification</button>}
                {row.state !== "deleting" && <button className={button} disabled={Boolean(busy)} onClick={() => startEditor(row)}>{row.pending ? "Resume Upload" : "Edit"}</button>}
                {row.state === "active" && !row.pending && <button className={button} disabled={Boolean(busy)} onClick={() =>
                  perform("Changing publication", async () => {
                    const next = row.status === "published" ? "draft" : "published";
                    await api(`/${row.id}`, "PATCH", { action: "details", revision: row.revision, details: { ...getDetails(row), status: next } });
                    toast.success(next === "published" ? "Material published." : "Material unpublished.");
                  })
                }>{row.status === "published" ? "Unpublish" : "Publish"}</button>}
                {row.pending && row.state === "active" && <button className={button} disabled={Boolean(busy)} onClick={() =>
                  perform("Discarding unfinished replacement", async () => {
                    const result = await api<{ message: string }>(`/${row.id}`, "PATCH", { action: "discard", operationId: row.pending?.id });
                    toast.info(result.message);
                  })
                }>Discard Replacement</button>}
                {row.cleanupCount > 0 && row.state === "active" && <button className={button} disabled={Boolean(busy)} onClick={() =>
                  perform("Cleaning up replaced files", async () => {
                    const result = await api<{ message: string }>(`/${row.id}`, "PATCH", { action: "cleanup" });
                    toast.info(result.message);
                  })
                }>Retry File Cleanup</button>}
                <button className={`${button} text-rose-600 dark:text-rose-400`} disabled={Boolean(busy)} onClick={() => setDeleting(row)}>{row.state === "deleting" ? "Retry Delete" : "Delete"}</button>
              </div>
            </article>
          ))}
        </div>
        <div className="flex items-center justify-between gap-3">
          <button className={button} disabled={page === 1 || listLoading} onClick={() => setPage(page - 1)}>Previous</button>
          <span className="text-sm text-muted-foreground">Page {page}</span>
          <button className={button} disabled={!data?.hasMore || listLoading} onClick={() => setPage(page + 1)}>Next</button>
        </div>
      </section>
      <ConfirmDialog isOpen={Boolean(deleting)} title="Delete material?"
        description={`“${deleting?.title ?? ""}” will be hidden from parents immediately. Cloudinary files will be removed before the record is deleted.`}
        confirmLabel="Delete Material" onClose={() => setDeleting(undefined)} onConfirm={() => {
          if (!deleting) return;
          const row = deleting;
          perform("Deleting material", async () => {
            const result = await api<{ deleted: boolean; message: string }>(`/${row.id}`, "DELETE", { revision: row.revision });
            if (result.deleted) toast.success(result.message);
            else toast.info(result.message);
            if (editor?.row?.id === row.id) setEditor(undefined);
          });
        }} />
    </div>
  );
}

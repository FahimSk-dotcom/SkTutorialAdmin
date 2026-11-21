"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  X,
  UserPlus,
  Save,
  AlertTriangle,
  CheckCircle2,
  Info,
  KeyRound,
  Loader2,
  Eye,
  EyeOff,
} from "lucide-react";
import { toast } from "sonner";
import { studentSchema, StudentInput } from "@/schemas";
import { Student } from "@/types";

interface StudentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  studentToEdit?: Student | null;
}

type ParentLookupStatus =
  | "idle"
  | "loading"
  | "found_configured"
  | "found_no_password"
  | "new"
  | "error";

interface ParentLookupResult {
  found: boolean;
  status: string;
  parentMobile: string;
  parent?: {
    _id: string;
    parentName: string;
    parentMobile: string;
    isActive: boolean;
    hasPassword: boolean;
  };
  activeStudents?: Array<{ studentId: string; name: string; class: string }>;
  archivedStudents?: Array<{ studentId: string; name: string; class: string; status: string }>;
  hasActiveStudents?: boolean;
  hasArchivedOnly?: boolean;
  hasMixedActiveArchived?: boolean;
  error?: string;
}

const CLASSES = [
  "Jr.Kg",
  "Sr.Kg",
  "Class 1",
  "Class 2",
  "Class 3",
  "Class 4",
  "Class 5",
  "Class 6",
  "Class 7",
  "Class 8",
  "Class 9",
  "Class 10",
];

export function StudentModal({
  isOpen,
  onClose,
  onSuccess,
  studentToEdit,
}: StudentModalProps) {
  const isEditMode = !!studentToEdit;
  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<StudentInput>({
    // @ts-ignore
    resolver: zodResolver(studentSchema),
    defaultValues: {
      name: "",
      class: "Class 10",
      batch: "",
      monthlyFee: 1500,
      parentName: "",
      parentMobile: "",
      alternateMobile: "",
      admissionDate: new Date().toISOString().split("T")[0],
      status: "Active",
      address: "",
      remarks: "",
    },
  });

  const [parentLookupStatus, setParentLookupStatus] = useState<ParentLookupStatus>("idle");
  const [parentLookupResult, setParentLookupResult] = useState<ParentLookupResult | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [parentPassword, setParentPassword] = useState("");
  const [confirmParentPassword, setConfirmParentPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const lastLookedUpMobileRef = useRef<string>("");
  const [isParentResetOpen, setIsParentResetOpen] = useState(false);
  const [resetNewPassword, setResetNewPassword] = useState("");
  const [resetConfirmPassword, setResetConfirmPassword] = useState("");
  const [showResetNewPassword, setShowResetNewPassword] = useState(false);
  const [showResetConfirmPassword, setShowResetConfirmPassword] = useState(false);
  const [resettingParentPassword, setResettingParentPassword] = useState(false);

  const watchedMobile = watch("parentMobile") || "";

  useEffect(() => {
    if (studentToEdit) {
      reset({
        name: studentToEdit.name,
        class: studentToEdit.class,
        batch: studentToEdit.batch || "",
        monthlyFee: Number(studentToEdit.monthlyFee),
        parentName: studentToEdit.parentName,
        parentMobile: studentToEdit.parentMobile,
        alternateMobile: studentToEdit.alternateMobile || "",
        admissionDate: studentToEdit.admissionDate
          ? studentToEdit.admissionDate.split("T")[0]
          : new Date().toISOString().split("T")[0],
        status: studentToEdit.status,
        address: studentToEdit.address || "",
        remarks: studentToEdit.remarks || "",
      });
    } else {
      reset({
        name: "",
        class: "Class 10",
        batch: "",
        monthlyFee: 1500,
        parentName: "",
        parentMobile: "",
        alternateMobile: "",
        admissionDate: new Date().toISOString().split("T")[0],
        status: "Active",
        address: "",
        remarks: "",
      });
    }
    setParentLookupStatus("idle");
    setParentLookupResult(null);
    setLookupError(null);
    setParentPassword("");
    setConfirmParentPassword("");
    setPasswordError(null);
    lastLookedUpMobileRef.current = "";
    setIsParentResetOpen(false);
    setResetNewPassword("");
    setResetConfirmPassword("");
    setShowResetNewPassword(false);
    setShowResetConfirmPassword(false);
  }, [studentToEdit, reset, isOpen]);

  // In edit mode, resolve credentials from the persisted student relationship,
  // not from a mobile number that may have unsaved form edits.
  useEffect(() => {
    if (!isOpen || !isEditMode || !studentToEdit) return;
    let cancelled = false;
    const digits = String(studentToEdit.parentMobile || "").replace(/\D/g, "");
    if (!/^\d{10}$/.test(digits)) {
      setParentLookupStatus("error");
      setParentLookupResult(null);
      setLookupError("The saved parent mobile number is invalid. Verify the student record first.");
      return;
    }

    setParentLookupStatus("loading");
    setParentLookupResult(null);
    setLookupError(null);
    const controller = new AbortController();
    fetch(`/api/admin/parents/lookup?mobile=${digits}`, {
      method: "GET",
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (res) => ({ res, body: await res.json().catch(() => ({})) }))
      .then(({ res, body }) => {
        if (cancelled) return;
        if (!res.ok) {
          setParentLookupStatus("error");
          setParentLookupResult(null);
          setLookupError(body?.error || "Unable to verify the linked parent account.");
          return;
        }
        if (!body?.found || !body?.parent?._id) {
          setParentLookupStatus("new");
          setParentLookupResult(body);
          return;
        }

        const linkedStudents = [
          ...(body.activeStudents || []),
          ...(body.archivedStudents || []),
        ];
        if (!linkedStudents.some((linked: { studentId?: string }) => linked.studentId === studentToEdit.studentId)) {
          setParentLookupStatus("error");
          setParentLookupResult(null);
          setLookupError("No parent account is linked to this student. Verify the parent relationship first.");
          return;
        }

        setParentLookupResult(body);
        setParentLookupStatus(body.status === "FOUND_NO_PASSWORD" ? "found_no_password" : "found_configured");
      })
      .catch((error) => {
        if (cancelled || error?.name === "AbortError") return;
        setParentLookupStatus("error");
        setParentLookupResult(null);
        setLookupError("Unable to load the linked parent account. Please retry.");
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [isOpen, isEditMode, studentToEdit?.studentId, studentToEdit?.parentMobile]);

  // Debounced automatic parent lookup on new admission only
  useEffect(() => {
    if (!isOpen || isEditMode) return;

    const digits = String(watchedMobile || "").replace(/\D/g, "").slice(0, 10);
    if (digits !== watchedMobile) {
      // keep form value normalized to digits where possible
      // but avoid fighting user typing unnecessarily; register handles value
    }

    if (digits.length !== 10) {
      setParentLookupStatus("idle");
      setParentLookupResult(null);
      setLookupError(null);
      lastLookedUpMobileRef.current = "";
      return;
    }

    if (!/^[0-9]{10}$/.test(digits)) return;
    if (lastLookedUpMobileRef.current === digits && parentLookupStatus !== "error") return;

    let cancelled = false;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setParentLookupStatus("loading");
      setLookupError(null);
      try {
        const res = await fetch(`/api/admin/parents/lookup?mobile=${digits}`, {
          method: "GET",
          signal: controller.signal,
          cache: "no-store",
        });
        const json = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setParentLookupStatus("error");
          setParentLookupResult(null);
          setLookupError(json?.error || "Unable to verify parent account. Please try again.");
          lastLookedUpMobileRef.current = digits;
          return;
        }
        lastLookedUpMobileRef.current = digits;
        if (json?.found && json?.status === "FOUND_CONFIGURED") {
          setParentLookupStatus("found_configured");
          setParentLookupResult(json);
          if (json?.parent?.parentName && !watch("parentName")) {
            setValue("parentName", json.parent.parentName);
          }
          setParentPassword("");
          setConfirmParentPassword("");
          setPasswordError(null);
        } else if (json?.found && json?.status === "FOUND_NO_PASSWORD") {
          setParentLookupStatus("found_no_password");
          setParentLookupResult(json);
          if (json?.parent?.parentName && !watch("parentName")) {
            setValue("parentName", json.parent.parentName);
          }
        } else {
          setParentLookupStatus("new");
          setParentLookupResult(json);
        }
      } catch (err: any) {
        if (cancelled || err?.name === "AbortError") return;
        setParentLookupStatus("error");
        setParentLookupResult(null);
        setLookupError("Network error while verifying parent account. Please retry.");
      }
    }, 500);

    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchedMobile, isOpen, isEditMode]);

  const needsPasswordInput =
    !isEditMode && (parentLookupStatus === "new" || parentLookupStatus === "found_no_password");

  const canSubmit = useMemo(() => {
    if (isEditMode) return true;
    if (parentLookupStatus === "loading") return false;
    if (parentLookupStatus === "error") return false;
    if (parentLookupStatus === "idle") {
      const digits = String(watchedMobile || "").replace(/\D/g, "");
      return digits.length === 10; // allow if valid and lookup will run? better to require resolved state
    }
    return true;
  }, [isEditMode, parentLookupStatus, watchedMobile]);

  if (!isOpen) return null;

  const onSubmit = async (data: StudentInput) => {
    try {
      setPasswordError(null);

      if (!isEditMode) {
        const digits = String(data.parentMobile || "").replace(/\D/g, "");
        if (!/^[0-9]{10}$/.test(digits)) {
          toast.error("Parent mobile number must be exactly 10 digits");
          return;
        }
        if (parentLookupStatus === "loading") {
          toast.error("Please wait for parent account verification to complete");
          return;
        }
        if (parentLookupStatus === "error" || parentLookupStatus === "idle") {
          toast.error("Parent account could not be verified. Please check the mobile number and try again.");
          return;
        }
        if (needsPasswordInput) {
          if (parentPassword.length < 8) {
            setPasswordError("Password must be at least 8 characters");
            return;
          }
          if (parentPassword !== confirmParentPassword) {
            setPasswordError("Passwords do not match");
            return;
          }
        }
      }

      const url = studentToEdit
        ? `/api/students/${studentToEdit._id}`
        : "/api/students";
      const method = studentToEdit ? "PUT" : "POST";

      const payload: any = { ...data, parentMobile: String(data.parentMobile).replace(/\D/g, "") };
      if (!isEditMode) {
        payload.admission = {
          existingParentId:
            parentLookupResult?.parent?._id &&
            (parentLookupStatus === "found_configured" || parentLookupStatus === "found_no_password")
              ? parentLookupResult.parent._id
              : undefined,
          parentPassword: needsPasswordInput ? parentPassword : undefined,
          confirmParentPassword: needsPasswordInput ? confirmParentPassword : undefined,
        };
      }

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(json.error || "Operation failed");
        return;
      }

      toast.success(
        studentToEdit
          ? "Student details updated successfully"
          : "Student registered successfully!"
      );
      onSuccess();
      onClose();
    } catch (err) {
      toast.error("Failed to save student details");
    }
  };

  const isSavedParentMobileUnchanged = Boolean(
    studentToEdit &&
      String(watchedMobile).replace(/\D/g, "") ===
        String(studentToEdit.parentMobile || "").replace(/\D/g, "")
  );

  const handleParentPasswordReset = async () => {
    const parentId = parentLookupResult?.parent?._id;
    if (!studentToEdit || !parentId || !isSavedParentMobileUnchanged) {
      toast.error("Save the student’s parent mobile change before resetting the linked account.");
      return;
    }
    if (resetNewPassword.length < 8 || resetNewPassword.length > 200) {
      toast.error("Password must be between 8 and 200 characters.");
      return;
    }
    if (resetNewPassword !== resetConfirmPassword) {
      toast.error("Passwords do not match.");
      return;
    }

    setResettingParentPassword(true);
    try {
      const response = await fetch(`/api/admin/parents/${parentId}/password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studentId: studentToEdit.studentId,
          newPassword: resetNewPassword,
          confirmPassword: resetConfirmPassword,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        toast.error(result?.error || "Failed to update parent password.");
        return;
      }

      toast.success(result?.message || "Parent password updated successfully.");
      setIsParentResetOpen(false);
      setResetNewPassword("");
      setResetConfirmPassword("");
      setShowResetNewPassword(false);
      setShowResetConfirmPassword(false);
    } catch {
      toast.error("Failed to update parent password. Please try again.");
    } finally {
      setResettingParentPassword(false);
    }
  };

  const activeStudents = parentLookupResult?.activeStudents || [];
  const archivedStudents = parentLookupResult?.archivedStudents || [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="w-full max-w-2xl bg-card text-card-foreground border border-border rounded-3xl p-6 shadow-elevated relative max-h-[90vh] overflow-y-auto">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 rounded-full text-muted-foreground hover:bg-muted transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-2xl bg-indigo-600/10 text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-400 flex items-center justify-center font-bold">
            <UserPlus className="w-5 h-5" />
          </div>
          <div>
            <h2 className="font-bold text-lg">
              {studentToEdit ? `Edit Student (${studentToEdit.studentId})` : "Add New Student"}
            </h2>
            <p className="text-xs text-muted-foreground">
              {studentToEdit
                ? "Update student information and tuition fee settings"
                : "Register a new tuition student into SK Tutorials"}
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit(onSubmit as any)} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Student Name */}
            <div>
              <label className="block text-xs font-semibold mb-1 text-foreground">
                Student Name *
              </label>
              <input
                type="text"
                placeholder="e.g. Ahmed Shaikh"
                {...register("name")}
                className="w-full px-3.5 py-2 text-sm bg-muted/50 border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
              />
              {errors.name && (
                <p className="text-xs text-rose-500 mt-1">{errors.name.message}</p>
              )}
            </div>

            {/* Class */}
            <div>
              <label className="block text-xs font-semibold mb-1 text-foreground">Class *</label>
              <select
                {...register("class")}
                className="w-full px-3.5 py-2 text-sm bg-muted/50 border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
              >
                {CLASSES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            {/* Batch */}
            <div>
              <label className="block text-xs font-semibold mb-1 text-foreground">
                Attendance Batch
              </label>
              <select
                {...register("batch")}
                className="w-full px-3.5 py-2 text-sm bg-muted/50 border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
              >
                <option value="">Auto (by class)</option>
                <option value="5-7">5–7 Batch (5 PM – 7 PM)</option>
                <option value="7-9">7–9 Batch (7 PM – 9 PM)</option>
              </select>
            </div>

            {/* Monthly Fee */}
            <div>
              <label className="block text-xs font-semibold mb-1 text-foreground">
                Monthly Fee (₹) *
              </label>
              <input
                type="number"
                placeholder="1500"
                {...register("monthlyFee", { valueAsNumber: true })}
                className="w-full px-3.5 py-2 text-sm bg-muted/50 border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
              />
              {errors.monthlyFee && (
                <p className="text-xs text-rose-500 mt-1">{errors.monthlyFee.message}</p>
              )}
            </div>

            {/* Parent Name */}
            <div>
              <label className="block text-xs font-semibold mb-1 text-foreground">
                Parent Name *
              </label>
              <input
                type="text"
                placeholder="Parent / Guardian Name"
                {...register("parentName")}
                className="w-full px-3.5 py-2 text-sm bg-muted/50 border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
              />
              {errors.parentName && (
                <p className="text-xs text-rose-500 mt-1">{errors.parentName.message}</p>
              )}
            </div>

            {/* Parent Mobile */}
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold mb-1 text-foreground">
                Parent Mobile (10 digits) *
              </label>
              <input
                type="text"
                maxLength={10}
                placeholder="9876543210"
                {...register("parentMobile")}
                onChange={(e) => {
                  const digits = e.target.value.replace(/\D/g, "").slice(0, 10);
                  e.target.value = digits;
                  setValue("parentMobile", digits, { shouldValidate: true, shouldDirty: true });
                }}
                className="w-full px-3.5 py-2 text-sm bg-muted/50 border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
              />
              {errors.parentMobile && (
                <p className="text-xs text-rose-500 mt-1">{errors.parentMobile.message}</p>
              )}

              {/* Parent Account Detection UI - New Admission */}
              {!isEditMode && (
                <div className="mt-3">
                  {parentLookupStatus === "idle" && (
                    <div className="p-3 rounded-2xl border border-border bg-muted/30 text-xs text-muted-foreground flex items-center gap-2">
                      <Info className="w-4 h-4" />
                      <span>Enter a valid 10-digit mobile number to automatically check for an existing parent account.</span>
                    </div>
                  )}

                  {parentLookupStatus === "loading" && (
                    <div className="p-3 rounded-2xl border border-border bg-muted/30 text-xs text-muted-foreground flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Checking parent account...</span>
                    </div>
                  )}

                  {parentLookupStatus === "error" && (
                    <div className="p-3 rounded-2xl border border-rose-500/30 bg-rose-500/10 text-xs text-rose-700 dark:text-rose-300 space-y-1">
                      <div className="flex items-center gap-2 font-semibold">
                        <AlertTriangle className="w-4 h-4" />
                        <span>Unable to verify parent account</span>
                      </div>
                      <p>{lookupError || "API or network error occurred. Please retry before submitting."}</p>
                      <p className="text-[11px]">Admission cannot proceed until the parent account status is verified. The system will not assume this is a new parent.</p>
                    </div>
                  )}

                  {parentLookupStatus === "found_configured" && parentLookupResult?.parent && (
                    <div className="p-3.5 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 text-xs space-y-2">
                      <div className="flex items-center gap-2 font-bold text-emerald-700 dark:text-emerald-300">
                        <CheckCircle2 className="w-4 h-4" />
                        <span>EXISTING PARENT ACCOUNT FOUND</span>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-foreground">
                        <div><span className="text-muted-foreground">Parent Name:</span> <span className="font-semibold">{parentLookupResult.parent.parentName || "-"}</span></div>
                        <div><span className="text-muted-foreground">Parent Mobile:</span> <span className="font-semibold">{parentLookupResult.parent.parentMobile}</span></div>
                        <div><span className="text-muted-foreground">Parent Account Status:</span> <span className="font-semibold">{parentLookupResult.parent.isActive ? "Active" : "Inactive"}</span></div>
                        <div><span className="text-muted-foreground">Password Status:</span> <span className="font-semibold">Configured</span></div>
                      </div>
                      <div>
                        <p className="text-muted-foreground font-semibold mb-1">Existing Active Students ({activeStudents.length})</p>
                        {activeStudents.length > 0 ? (
                          <ul className="space-y-0.5">
                            {activeStudents.map((s) => (
                              <li key={s.studentId} className="text-foreground">• {s.name} ({s.studentId}) - {s.class}</li>
                            ))}
                          </ul>
                        ) : (
                          <p className="text-foreground">No active linked students found.</p>
                        )}
                        {archivedStudents.length > 0 && (
                          <p className="text-[11px] text-muted-foreground mt-1">
                            {parentLookupResult.hasArchivedOnly
                              ? "Note: This account currently has archived students only."
                              : `Note: ${archivedStudents.length} archived student(s) also linked.`}
                          </p>
                        )}
                      </div>
                      <div className="pt-1 text-emerald-800 dark:text-emerald-200">
                        This mobile number is already registered with an active parent account. The new student will be linked to the existing parent account.
                      </div>
                      <div className="pt-1">
                        <label className="block text-xs font-semibold mb-1 text-foreground">Parent Login Password</label>
                        <div className="px-3.5 py-2 text-sm bg-muted/60 border border-border rounded-xl text-muted-foreground font-medium">
                          Already Configured (existing credentials will continue to work)
                        </div>
                      </div>
                    </div>
                  )}

                  {parentLookupStatus === "found_no_password" && parentLookupResult?.parent && (
                    <div className="p-3.5 rounded-2xl border border-amber-500/30 bg-amber-500/10 text-xs space-y-2">
                      <div className="flex items-center gap-2 font-bold text-amber-800 dark:text-amber-300">
                        <AlertTriangle className="w-4 h-4" />
                        <span>EXISTING PARENT ACCOUNT – PASSWORD NOT CONFIGURED</span>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-foreground">
                        <div><span className="text-muted-foreground">Parent Name:</span> <span className="font-semibold">{parentLookupResult.parent.parentName || "-"}</span></div>
                        <div><span className="text-muted-foreground">Parent Mobile:</span> <span className="font-semibold">{parentLookupResult.parent.parentMobile}</span></div>
                        <div><span className="text-muted-foreground">Account Status:</span> <span className="font-semibold">{parentLookupResult.parent.isActive ? "Active" : "Inactive"}</span></div>
                        <div><span className="text-muted-foreground">Password Status:</span> <span className="font-semibold">Not Configured</span></div>
                      </div>
                      {activeStudents.length > 0 && (
                        <div>
                          <p className="text-muted-foreground font-semibold mb-1">Existing Active Students</p>
                          <ul className="space-y-0.5 text-foreground">
                            {activeStudents.map((s) => (
                              <li key={s.studentId}>• {s.name} ({s.studentId}) - {s.class}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {parentLookupResult.hasArchivedOnly && (
                        <p className="text-[11px] text-amber-800 dark:text-amber-300">Note: This account currently has archived students only.</p>
                      )}
                      <p className="text-amber-900 dark:text-amber-200">Configure an initial password for this existing parent account. No duplicate account will be created.</p>
                    </div>
                  )}

                  {parentLookupStatus === "new" && (
                    <div className="p-3.5 rounded-2xl border border-blue-500/30 bg-blue-500/10 text-xs space-y-1">
                      <div className="flex items-center gap-2 font-bold text-blue-700 dark:text-blue-300">
                        <Info className="w-4 h-4" />
                        <span>NEW PARENT ACCOUNT</span>
                      </div>
                      <p className="text-blue-900 dark:text-blue-200">No existing parent account found for this mobile number. A new parent account will be created during admission.</p>
                    </div>
                  )}
                </div>
              )}

              {isEditMode && (
                <div className="mt-3 p-3.5 rounded-2xl border border-border bg-muted/20 space-y-3">
                  <div>
                    <h3 className="text-xs font-bold text-foreground">Parent Login Credentials</h3>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      Password changes apply to this parent account and all linked siblings.
                    </p>
                  </div>

                  {parentLookupStatus === "loading" ? (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Finding the linked parent account...</span>
                    </div>
                  ) : parentLookupStatus === "error" ? (
                    <div className="flex items-start gap-2 text-xs text-rose-700 dark:text-rose-300">
                      <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                      <span>{lookupError || "Unable to verify the linked parent account."}</span>
                    </div>
                  ) : !parentLookupResult?.found || !parentLookupResult.parent ? (
                    <div className="text-xs text-muted-foreground space-y-1">
                      <p>No parent login account is registered for this student.</p>
                      <p>Use the existing parent enrollment flow when registering a student with this parent’s mobile number.</p>
                    </div>
                  ) : (
                    <>
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                        <div className="text-xs">
                          <span className="block text-[10px] text-muted-foreground">Registered parent mobile</span>
                          <span className="font-semibold text-foreground">{parentLookupResult.parent.parentMobile}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => setIsParentResetOpen(true)}
                          disabled={parentLookupStatus === "loading" || !isSavedParentMobileUnchanged}
                          className="inline-flex min-h-10 items-center justify-center gap-2 px-4 py-2 text-xs font-semibold text-indigo-700 dark:text-indigo-300 border border-indigo-500/30 bg-indigo-500/10 hover:bg-indigo-500/15 rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <KeyRound className="w-4 h-4" />
                          Change Parent Password
                        </button>
                      </div>
                      {!isSavedParentMobileUnchanged && (
                        <p className="text-[11px] text-amber-700 dark:text-amber-300">
                          Save the parent mobile change first. Password reset applies to the currently linked account.
                        </p>
                      )}
                      {(parentLookupResult.activeStudents || []).length > 1 && (
                        <p className="text-[11px] text-muted-foreground">
                          This account is shared by {parentLookupResult.activeStudents?.length} active students; they will all use the new password.
                        </p>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Alternate Mobile */}
            <div>
              <label className="block text-xs font-semibold mb-1 text-foreground">
                Alternate Mobile (Optional)
              </label>
              <input
                type="text"
                maxLength={10}
                placeholder="Optional 10 digits"
                {...register("alternateMobile")}
                className="w-full px-3.5 py-2 text-sm bg-muted/50 border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
              />
            </div>

            {/* Admission Date */}
            <div>
              <label className="block text-xs font-semibold mb-1 text-foreground">
                Admission Date *
              </label>
              <input
                type="date"
                {...register("admissionDate")}
                className="w-full px-3.5 py-2 text-sm bg-muted/50 border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
              />
              {errors.admissionDate && (
                <p className="text-xs text-rose-500 mt-1">{errors.admissionDate.message}</p>
              )}
            </div>

            {/* Status */}
            <div>
              <label className="block text-xs font-semibold mb-1 text-foreground">Status</label>
              <select
                {...register("status")}
                className="w-full px-3.5 py-2 text-sm bg-muted/50 border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
              >
                <option value="Active">Active</option>
                <option value="Inactive">Archived</option>
              </select>
            </div>
          </div>

          {/* Password fields for new admission scenarios */}
          {!isEditMode && needsPasswordInput && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 rounded-2xl border border-border bg-muted/20">
              <div className="sm:col-span-2">
                <p className="text-xs font-semibold text-foreground">
                  {parentLookupStatus === "new"
                    ? "Set Parent Login Password"
                    : "Configure Initial Parent Login Password"}
                </p>
                <p className="text-[11px] text-muted-foreground mt-0.5">Minimum 8 characters. Password will be sent securely to the backend.</p>
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1 text-foreground">Parent Login Password *</label>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={parentPassword}
                    onChange={(e) => setParentPassword(e.target.value)}
                    placeholder="Enter password"
                    autoComplete="new-password"
                    className="w-full px-3.5 py-2 pr-10 text-sm bg-background border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                  />
                  <button type="button" onClick={() => setShowPassword((v) => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground">
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1 text-foreground">Confirm Password *</label>
                <div className="relative">
                  <input
                    type={showConfirmPassword ? "text" : "password"}
                    value={confirmParentPassword}
                    onChange={(e) => setConfirmParentPassword(e.target.value)}
                    placeholder="Confirm password"
                    autoComplete="new-password"
                    className="w-full px-3.5 py-2 pr-10 text-sm bg-background border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                  />
                  <button type="button" onClick={() => setShowConfirmPassword((v) => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground">
                    {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              {passwordError && (
                <div className="sm:col-span-2 text-xs text-rose-500">{passwordError}</div>
              )}
            </div>
          )}

          {/* Address */}
          <div>
            <label className="block text-xs font-semibold mb-1 text-foreground">
              Address (Optional)
            </label>
            <input
              type="text"
              placeholder="Residential address"
              {...register("address")}
              className="w-full px-3.5 py-2 text-sm bg-muted/50 border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
            />
          </div>

          {/* Remarks */}
          <div>
            <label className="block text-xs font-semibold mb-1 text-foreground">
              Remarks (Optional)
            </label>
            <textarea
              rows={2}
              placeholder="Additional notes..."
              {...register("remarks")}
              className="w-full px-3.5 py-2 text-sm bg-muted/50 border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
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
              disabled={isSubmitting || (!isEditMode && (parentLookupStatus === "loading" || parentLookupStatus === "error" || parentLookupStatus === "idle"))}
              className="inline-flex items-center gap-1.5 px-5 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl shadow-sm transition-all active:scale-95 disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              <span>{isSubmitting ? "Saving..." : studentToEdit ? "Update Student" : "Register Student"}</span>
            </button>
          </div>
          {!isEditMode && parentLookupStatus === "idle" && String(watchedMobile || "").replace(/\D/g, "").length === 10 && (
            <p className="text-[11px] text-amber-600">Parent account verification is pending. Please wait a moment.</p>
          )}
        </form>
      </div>
      {isParentResetOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="parent-password-reset-title"
            className="w-full max-w-md bg-card text-card-foreground border border-border rounded-3xl p-6 shadow-elevated"
          >
            <div className="flex items-start gap-3 mb-5">
              <div className="w-10 h-10 rounded-2xl bg-indigo-600/10 text-indigo-600 flex items-center justify-center shrink-0">
                <KeyRound className="w-5 h-5" />
              </div>
              <div>
                <h2 id="parent-password-reset-title" className="font-bold text-lg">Change Parent Password</h2>
                <p className="text-xs text-muted-foreground mt-1">
                  {parentLookupResult?.parent?.parentMobile} · applies to all linked siblings
                </p>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <label htmlFor="parent-reset-new-password" className="block text-xs font-semibold mb-1">New Password</label>
                <div className="relative">
                  <input
                    id="parent-reset-new-password"
                    type={showResetNewPassword ? "text" : "password"}
                    value={resetNewPassword}
                    onChange={(event) => setResetNewPassword(event.target.value)}
                    autoComplete="new-password"
                    maxLength={200}
                    className="w-full px-3.5 py-2 pr-11 text-sm bg-muted/50 border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                    placeholder="At least 8 characters"
                  />
                  <button
                    type="button"
                    aria-label={showResetNewPassword ? "Hide new password" : "Show new password"}
                    onClick={() => setShowResetNewPassword((visible) => !visible)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-muted-foreground hover:text-foreground"
                  >
                    {showResetNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div>
                <label htmlFor="parent-reset-confirm-password" className="block text-xs font-semibold mb-1">Confirm New Password</label>
                <div className="relative">
                  <input
                    id="parent-reset-confirm-password"
                    type={showResetConfirmPassword ? "text" : "password"}
                    value={resetConfirmPassword}
                    onChange={(event) => setResetConfirmPassword(event.target.value)}
                    autoComplete="new-password"
                    maxLength={200}
                    className="w-full px-3.5 py-2 pr-11 text-sm bg-muted/50 border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                    placeholder="Re-enter the new password"
                  />
                  <button
                    type="button"
                    aria-label={showResetConfirmPassword ? "Hide confirmation password" : "Show confirmation password"}
                    onClick={() => setShowResetConfirmPassword((visible) => !visible)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-muted-foreground hover:text-foreground"
                  >
                    {showResetConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <p className="text-[11px] text-muted-foreground">
                The parent will need to sign in again on their devices after this change.
              </p>
            </div>

            <div className="flex items-center justify-end gap-2 pt-4 mt-5 border-t border-border">
              <button
                type="button"
                onClick={() => {
                  if (resettingParentPassword) return;
                  setIsParentResetOpen(false);
                  setResetNewPassword("");
                  setResetConfirmPassword("");
                  setShowResetNewPassword(false);
                  setShowResetConfirmPassword(false);
                }}
                disabled={resettingParentPassword}
                className="px-4 py-2 text-xs font-semibold text-muted-foreground hover:bg-muted rounded-xl transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleParentPasswordReset}
                disabled={resettingParentPassword || !resetNewPassword || !resetConfirmPassword}
                className="inline-flex min-h-10 items-center gap-2 px-5 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl disabled:opacity-50"
              >
                {resettingParentPassword ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
                {resettingParentPassword ? "Updating..." : "Update Password"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

import { normalizeClass } from "@/lib/class-utils";
import { getParentMaterialDetails, listMaterials, getMaterialFile } from "@/lib/materials";
import { materialDownload, MaterialError } from "@/lib/materials-storage";
import { getDb } from "@/lib/mongodb";
import {
  getAuthenticatedParent, ParentAuthConfigError, parentAccessRestrictedBody, verifyParentStudentAccess,
} from "@/lib/parent-auth";
import { parentJson, parentOptions } from "@/lib/parent-cors";

type Context = { params: Promise<{ path?: string[] }> };

export async function GET(request: Request, context: Context) {
  function json(body: unknown, status = 200) {
    const response = parentJson(request, body, status);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }

  try {
    const auth = await getAuthenticatedParent(request, { requireActiveStudents: true });
    if (!auth.ok) {
      return json(auth.restriction ? parentAccessRestrictedBody(auth.restriction) : {
        success: false, message: auth.error ?? "Authentication required.",
      }, auth.status);
    }
    const params = new URL(request.url).searchParams;
    const studentId = params.get("studentId") ?? "";
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(studentId)) return json({ message: "Select a linked student." }, 400);
    const db = await getDb();
    const access = await verifyParentStudentAccess(db, auth.parent, studentId);
    if (!access.ok) return json(access.failure.body, access.failure.status);
    const classKey = normalizeClass(access.student.class);
    if (!classKey) return json({ message: "This student has no assigned class." }, 404);
    const { path = [] } = await context.params;
    if (!path.length) return json(await listMaterials(db, params, classKey));
    if (path.length === 1) return json(await getParentMaterialDetails(db, path[0], classKey));
    if (path.length === 3 && path[1] === "files") {
      const file = await getMaterialFile(db, path[0], path[2], classKey);
      return json(materialDownload(file, params.get("download") === "1"));
    }
    return json({ message: "Material not found." }, 404);
  } catch (error) {
    if (error instanceof MaterialError) return json({ message: error.message }, error.status);
    if (error instanceof ParentAuthConfigError) return json({ message: "Parent service is temporarily unavailable." }, 503);
    console.error("Parent materials request failed", error instanceof Error ? error.name : "unknown");
    return json({ message: "Unable to load study materials." }, 500);
  }
}

export const OPTIONS = parentOptions;

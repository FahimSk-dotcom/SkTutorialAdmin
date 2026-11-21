import { getAuthenticatedAdmin } from "@/lib/auth";
import {
  createMaterial, deleteMaterial, getMaterialFile, listMaterials, materialClassOptions,
  materialUpdate, newMaterial, updateMaterial,
} from "@/lib/materials";
import { materialDownload, MaterialError } from "@/lib/materials-storage";
import { getDb } from "@/lib/mongodb";

export const maxDuration = 60;
type Context = { params: Promise<{ path?: string[] }> };
const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

async function handle(request: Request, context: Context) {
  try {
    const admin = await getAuthenticatedAdmin();
    if (!admin) return json({ error: "Unauthorized." }, 401);
    const { path = [] } = await context.params;
    const [id, segment, fileId] = path;
    const params = new URL(request.url).searchParams;
    if (["POST", "PATCH", "DELETE"].includes(request.method) &&
      request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
      return json({ error: "Use an application/json request body." }, 415);
    }
    const db = await getDb();
    if (request.method === "GET") {
      if (!path.length) {
        const [page, classes] = await Promise.all([listMaterials(db, params), materialClassOptions(db)]);
        return json({ ...page, classes });
      }
      if (path.length === 3 && segment === "files") {
        return json(materialDownload(await getMaterialFile(db, id, fileId), params.get("download") === "1"));
      }
    }
    if (request.method === "POST" && !path.length) {
      const parsed = newMaterial.safeParse(await request.json().catch(() => null));
      if (!parsed.success) return json({ error: "Enter a title, a subject, at least one class and 1–6 valid files." }, 400);
      return json(await createMaterial(db, parsed.data));
    }
    if (request.method === "PATCH" && path.length === 1) {
      const parsed = materialUpdate.safeParse(await request.json().catch(() => null));
      if (!parsed.success) return json({ error: "Check the material details and selected files." }, 400);
      return json(await updateMaterial(db, id, parsed.data, admin));
    }
    if (request.method === "DELETE" && path.length === 1) {
      const body = await request.json().catch(() => null);
      if (!Number.isInteger(body?.revision)) return json({ error: "Refresh the material before deleting." }, 400);
      return json(await deleteMaterial(db, id, body.revision));
    }
    return json({ error: "Material operation not found." }, 404);
  } catch (error) {
    if (error instanceof MaterialError) return json({ error: error.message }, error.status);
    console.error("Admin materials request failed", error instanceof Error ? error.name : "unknown");
    return json({ error: "The operation failed. Refresh the list to check whether it can be resumed." }, 500);
  }
}

export { handle as GET, handle as POST, handle as PATCH, handle as DELETE };

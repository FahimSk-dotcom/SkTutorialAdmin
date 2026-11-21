import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";

export class MaterialError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export const fileInput = z.object({
  originalName: z.string().trim().min(1).max(150).regex(/^[^/\\\x00-\x1f\x7f]+$/),
  size: z.number().int().positive(),
}).strict();

const contentTypes = {
  pdf: "application/pdf", doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  jpg: "image/jpeg", png: "image/png", webp: "image/webp",
} as const;

export interface ReservedFile {
  id: string;
  originalName: string;
  format: keyof typeof contentTypes;
  size: number;
  publicId: string;
  cloudName: string;
  resourceType: "image" | "raw";
  cleanupAfter: Date;
}

export interface MaterialFile extends ReservedFile {
  assetId: string;
  deliveryType: "authenticated";
}

const responseSchema = z.object({
  asset_id: z.string().min(1), public_id: z.string(), resource_type: z.enum(["raw", "image"]),
  type: z.literal("authenticated"), bytes: z.number().int().positive(), format: z.string().optional(),
});

export function storageConfig() {
  const cloud = process.env.CLOUDINARY_CLOUD_NAME?.trim();
  const key = process.env.CLOUDINARY_API_KEY?.trim();
  const secret = process.env.CLOUDINARY_API_SECRET?.trim();
  if (!cloud || !/^[a-z0-9_-]+$/i.test(cloud) || !key || !secret) {
    throw new MaterialError("Configure CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET on the admin server.", 503);
  }
  const sizeSetting = process.env.MATERIAL_MAX_FILE_SIZE_MB?.trim() ?? "10";
  const limitMb = Number(sizeSetting);
  const limit = limitMb * 1_000_000;
  if (!/^\d+$/.test(sizeSetting) || limitMb < 1 || !Number.isSafeInteger(limit)) {
    throw new MaterialError("Set MATERIAL_MAX_FILE_SIZE_MB to a positive whole number on the admin server.", 503);
  }
  return { cloud: cloud.toLowerCase(), key, secret, limitMb, limit };
}

function validateFileSize(originalName: string, size: number, config: ReturnType<typeof storageConfig>) {
  if (size > config.limit) {
    throw new MaterialError(`“${originalName}” exceeds the ${config.limitMb} MB per-file limit. Choose a smaller file.`, 413);
  }
}

function signed(config: ReturnType<typeof storageConfig>, params: Record<string, string>) {
  const canonical = Object.keys(params).sort().map((key) => `${key}=${params[key]}`).join("&");
  const signature = createHash("sha256").update(canonical + config.secret).digest("hex");
  return { ...params, api_key: config.key, signature };
}

const cloudEndpoint = (cloud: string, path: string) => `https://api.cloudinary.com/v1_1/${cloud}/${path}`;
const MATERIALS_FOLDER = "assignment_notes";

function storageFor(file: ReservedFile) {
  const config = storageConfig();
  if (config.cloud !== file.cloudName) {
    throw new MaterialError("This file belongs to a different Cloudinary environment. Check the server configuration.", 503);
  }
  return config;
}

export function reserveFiles(materialId: string, entries: z.infer<typeof fileInput>[], now: Date) {
  const config = storageConfig();
  const files = entries.map(({ originalName, size }): ReservedFile => {
    const extension = originalName.split(".").at(-1)?.toLowerCase();
    const format = extension === "jpeg" ? "jpg" : extension;
    if (!originalName.includes(".") || !format || !Object.hasOwn(contentTypes, format)) {
      throw new MaterialError("Choose a PDF, DOC, DOCX, JPG, JPEG, PNG, or WEBP file.");
    }
    validateFileSize(originalName, size, config);
    const id = randomUUID();
    const resourceType = format === "doc" || format === "docx" ? "raw" : "image";
    const publicId = `${MATERIALS_FOLDER}/${materialId}-${id}${resourceType === "raw" ? `.${format}` : ""}`;
    return { id, originalName, size, format: format as ReservedFile["format"], publicId,
      resourceType, cloudName: config.cloud, cleanupAfter: new Date(now.getTime() + 12 * 60_000) };
  });
  return files;
}

export function uploadTickets(files: ReservedFile[], startedAt: Date) {
  if (!files.length) return [];
  if (Date.now() >= startedAt.getTime() + 10 * 60_000) {
    throw new MaterialError("The upload window expired. Verify uploaded files or discard the unfinished upload.", 409);
  }
  const timestamp = String(Math.floor(startedAt.getTime() / 1000) - 50 * 60);
  // Cloudinary accepts signatures for an hour. Backdate to give this reservation a ten-minute window.
  return files.map((file) => {
    const config = storageFor(file);
    validateFileSize(file.originalName, file.size, config);
    return {
      id: file.id,
      url: cloudEndpoint(config.cloud, `${file.resourceType}/upload`),
      fields: signed(config, {
        public_id: file.publicId, type: "authenticated", overwrite: "false",
        timestamp, allowed_formats: file.format,
        ...(file.publicId.startsWith(`${MATERIALS_FOLDER}/`) ? { asset_folder: MATERIALS_FOLDER } : {}),
      }),
    };
  });
}

export function materialDownload(file: MaterialFile, download = false) {
  const config = storageFor(file);
  const timestamp = Math.floor(Date.now() / 1000);
  const query = new URLSearchParams(signed(config, {
    asset_id: file.assetId, timestamp: String(timestamp), expires_at: String(timestamp + 90),
    ...(download ? { attachment: "true", target_filename: file.originalName } : {}),
  }));
  return { url: `${cloudEndpoint(config.cloud, "asset/download")}?${query}`, mimeType: contentTypes[file.format] };
}

function zipHasWordDocument(bytes: Buffer) {
  // Check central-directory entry names without decompressing untrusted input.
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65_557); offset--) {
    if (bytes.readUInt32LE(offset) !== 0x06054b50 || offset + 22 + bytes.readUInt16LE(offset + 20) !== bytes.length) continue;
    const entries = bytes.readUInt16LE(offset + 10);
    let cursor = bytes.readUInt32LE(offset + 16);
    let hasDocument = false;
    let hasContentTypes = false;
    for (let index = 0; index < entries && cursor + 46 <= offset; index++) {
      if (bytes.readUInt32LE(cursor) !== 0x02014b50) return false;
      const length = bytes.readUInt16LE(cursor + 28);
      if (cursor + 46 + length > offset) return false;
      const name = bytes.toString("utf8", cursor + 46, cursor + 46 + length);
      hasDocument ||= name === "word/document.xml";
      hasContentTypes ||= name === "[Content_Types].xml";
      cursor += 46 + length + bytes.readUInt16LE(cursor + 30) + bytes.readUInt16LE(cursor + 32);
    }
    return hasDocument && hasContentTypes;
  }
  return false;
}

export function matchesMaterialFormat(bytes: Buffer, format: ReservedFile["format"]) {
  switch (format) {
    case "pdf": return bytes.subarray(0, 5).toString() === "%PDF-";
    case "jpg": return bytes.subarray(0, 3).equals(Buffer.from("ffd8ff", "hex"));
    case "png": return bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"));
    case "webp": return bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP";
    case "doc": return bytes.subarray(0, 8).equals(Buffer.from("d0cf11e0a1b11ae1", "hex")) &&
      bytes.includes(Buffer.from("WordDocument", "utf16le"));
    case "docx": return bytes.subarray(0, 4).equals(Buffer.from("504b0304", "hex")) && zipHasWordDocument(bytes);
  }
}

export async function verifyUploadedFile(file: ReservedFile): Promise<MaterialFile> {
  const config = storageFor(file);
  const metadata = await fetch(cloudEndpoint(config.cloud,
    `resources/${file.resourceType}/authenticated/${encodeURIComponent(file.publicId)}`), {
    headers: { Authorization: `Basic ${Buffer.from(`${config.key}:${config.secret}`).toString("base64")}` },
    cache: "no-store", signal: AbortSignal.timeout(12_000), redirect: "error",
  });
  if (metadata.status === 404) throw new MaterialError(`Upload ${file.originalName} before saving.`, 409);
  if (!metadata.ok) throw new MaterialError("Cloudinary could not verify the uploaded asset. Check its API configuration.", 502);
  const parsed = responseSchema.safeParse(await metadata.json());
  if (parsed.success) validateFileSize(file.originalName, parsed.data.bytes, config);
  if (!parsed.success || parsed.data.public_id !== file.publicId || parsed.data.resource_type !== file.resourceType ||
    parsed.data.bytes !== file.size ||
    (file.resourceType === "image" && parsed.data.format !== file.format)) {
    throw new MaterialError(`Cloudinary reported an unexpected format or size for ${file.originalName}.`);
  }
  const verified: MaterialFile = { ...file, assetId: parsed.data.asset_id, deliveryType: parsed.data.type };
  const response = await fetch(materialDownload(verified).url, { cache: "no-store", signal: AbortSignal.timeout(18_000) });
  if (!response.ok || !response.body) {
    throw new MaterialError(`Cloudinary blocked private delivery of ${file.originalName}. Check account delivery settings.`, 502);
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > file.size) {
      await reader.cancel();
      validateFileSize(file.originalName, size, config);
      break;
    }
    chunks.push(value);
  }
  if (size !== file.size || !matchesMaterialFormat(Buffer.concat(chunks), file.format)) {
    throw new MaterialError(`The file content does not match the selected format or size for ${file.originalName}.`);
  }
  return verified;
}

export async function destroyMaterialFile(file: ReservedFile) {
  const config = storageFor(file);
  const form = new URLSearchParams(signed(config, {
    public_id: file.publicId, type: "authenticated",
    timestamp: String(Math.floor(Date.now() / 1000)), invalidate: "true",
  }));
  const response = await fetch(cloudEndpoint(config.cloud, `${file.resourceType}/destroy`), {
    method: "POST", body: form, signal: AbortSignal.timeout(12_000), redirect: "error",
  });
  const result = response.ok ? (await response.json()).result : null;
  if (result !== "ok" && result !== "not found") {
    throw new MaterialError("Cloudinary cleanup could not be completed. Retry cleanup from the materials list.", 502);
  }
}

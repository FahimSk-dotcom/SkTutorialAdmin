import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  fileInput, matchesMaterialFormat, materialDownload, reserveFiles, uploadTickets, verifyUploadedFile,
} from "../src/lib/materials-storage.ts";

const id = "bc651f65-2870-4847-9d1e-821f2183486e";

function configureStorage(t) {
  const env = {
    CLOUDINARY_CLOUD_NAME: "demo", CLOUDINARY_API_KEY: "test-key", CLOUDINARY_API_SECRET: "test-secret",
    MATERIAL_MAX_FILE_SIZE_MB: "10",
  };
  for (const [key, value] of Object.entries(env)) {
    const previous = process.env[key];
    process.env[key] = value;
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
  }
}

test("upload tickets use an authenticated generated ID, declared format and bounded lifetime", (t) => {
  configureStorage(t);
  const start = new Date();
  const [word, jpeg] = reserveFiles(id, [
    { originalName: "Chapter notes.docx", size: 512 },
    { originalName: "Photo.JPEG", size: 1024 },
  ], start);
  assert.equal(word.resourceType, "raw");
  assert.match(word.publicId, new RegExp(`^assignment_notes/${id}-[a-f0-9-]+\\.docx$`));
  assert.equal(jpeg.resourceType, "image");
  assert.equal(jpeg.format, "jpg");
  assert.equal(word.originalName, "Chapter notes.docx");
  assert.equal(word.cleanupAfter.getTime() - start.getTime(), 720_000);
  assert.equal(fileInput.safeParse({ originalName: "../photo.jpg", size: 1024 }).success, false);
  assert.equal(reserveFiles(id, [{ originalName: "limit.pdf", size: 10_000_000 }], start)[0].size, 10_000_000);
  assert.throws(() => reserveFiles(id, [{ originalName: "over.pdf", size: 10_000_001 }], start), /over.pdf.*10 MB per-file limit/);
  assert.throws(() => reserveFiles(id, [{ originalName: "script.js", size: 64 }], start), /Choose a PDF/);

  const [ticket] = uploadTickets([word], start);
  const { signature, api_key: key, ...params } = ticket.fields;
  const canonical = Object.entries(params).sort(([a], [b]) => a.localeCompare(b)).map(([name, value]) => `${name}=${value}`).join("&");
  assert.equal(key, "test-key");
  assert.equal(ticket.url, "https://api.cloudinary.com/v1_1/demo/raw/upload");
  assert.equal(params.type, "authenticated");
  assert.equal(params.asset_folder, "assignment_notes");
  assert.equal(params.overwrite, "false");
  assert.equal(signature, createHash("sha256").update(canonical + "test-secret").digest("hex"));
  assert.throws(() => uploadTickets([word], new Date(start.getTime() - 600_000)), /expired/);

  const download = new URL(materialDownload({ ...word, assetId: "asset-id", deliveryType: "authenticated" }).url);
  assert.equal(download.pathname, "/v1_1/demo/asset/download");
  assert.equal(download.searchParams.get("asset_id"), "asset-id");
  assert.equal(Number(download.searchParams.get("expires_at")) - Number(download.searchParams.get("timestamp")), 90);
  assert.equal(download.href.includes("test-secret"), false);
});

test("rejects an oversized Cloudinary asset even if the reservation declared a smaller file", async (t) => {
  configureStorage(t);
  const [file] = reserveFiles(id, [{ originalName: "sample.pdf", size: 1000 }], new Date());
  const fetch = t.mock.method(globalThis, "fetch", async () => Response.json({
    asset_id: "asset-id", public_id: file.publicId, resource_type: "image",
    type: "authenticated", format: "pdf", bytes: 10_000_001,
  }));
  await assert.rejects(verifyUploadedFile(file), { status: 413, message: /sample.pdf.*10 MB per-file limit/ });
  assert.equal(fetch.mock.callCount(), 1);
});

test("verifies a private file at exactly 10 MB", async (t) => {
  configureStorage(t);
  const [file] = reserveFiles(id, [{ originalName: "limit.pdf", size: 10_000_000 }], new Date());
  const content = Buffer.alloc(file.size);
  content.write("%PDF-");
  t.mock.method(globalThis, "fetch", async (url) => url.includes("/resources/")
    ? Response.json({
      asset_id: "asset-id", public_id: file.publicId, resource_type: "image",
      type: "authenticated", format: "pdf", bytes: file.size,
    })
    : new Response(content));
  const verified = await verifyUploadedFile(file);
  assert.equal(verified.size, 10_000_000);
});

test("validates document and image signatures, and rejects an arbitrary ZIP as DOCX", () => {
  assert.equal(matchesMaterialFormat(Buffer.from("%PDF-1.7"), "pdf"), true);
  assert.equal(matchesMaterialFormat(Buffer.from("89504e470d0a1a0a", "hex"), "png"), true);
  assert.equal(matchesMaterialFormat(Buffer.from("ffd8ff", "hex"), "jpg"), true);
  assert.equal(matchesMaterialFormat(Buffer.from("RIFF0000WEBP"), "webp"), true);
  assert.equal(matchesMaterialFormat(Buffer.from("<html>"), "pdf"), false);
  assert.equal(matchesMaterialFormat(Buffer.from("504b0304", "hex"), "docx"), false);
  assert.equal(matchesMaterialFormat(Buffer.from("d0cf11e0a1b11ae1", "hex"), "doc"), false);
});

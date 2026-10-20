import "server-only";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createSupabaseFileStore, type FileStore } from "@goinstall/integrations";

export const PROJECT_BUCKET = "project-files";
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic"];

const g = globalThis as unknown as { goinstallFiles?: FileStore };

/** Local-disk store for development: files under .data/uploads, served as data URLs. */
function diskStore(root: string): FileStore {
  const resolve = (p: string) => {
    const full = path.resolve(root, p);
    if (!full.startsWith(path.resolve(root) + path.sep)) throw new Error("Bad path");
    return full;
  };
  const types: Record<string, string> = { ".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".heic": "image/heic", ".pdf": "application/pdf" };
  return {
    name: "disk",
    async put(p, bytes) {
      const full = resolve(p);
      await mkdir(path.dirname(full), { recursive: true });
      await writeFile(full, bytes, { flag: "wx" });
    },
    async signedUrl(p) {
      const bytes = await readFile(resolve(p));
      return `data:${types[path.extname(p)] ?? "application/octet-stream"};base64,${bytes.toString("base64")}`;
    },
    async remove(p) {
      await rm(resolve(p), { force: true });
    },
  };
}

/**
 * Supabase Storage when the service key is configured (staging and
 * production); local disk otherwise.
 */
export function fileStore(): FileStore {
  if (g.goinstallFiles) return g.goinstallFiles;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  g.goinstallFiles =
    url && serviceKey && process.env.FILE_STORE !== "disk"
      ? createSupabaseFileStore({ url, serviceKey, bucket: PROJECT_BUCKET })
      : diskStore(process.env.FILE_STORE_DIR ?? path.join(process.cwd(), ".data", "uploads"));
  return g.goinstallFiles;
}

export function extensionFor(contentType: string) {
  return { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic", "application/pdf": "pdf" }[contentType] ?? "bin";
}

/** Signed URLs for a set of stored paths; failures become null rather than breaking the page. */
export async function signedUrls(paths: string[], expiresIn = 3600): Promise<Map<string, string | null>> {
  const store = fileStore();
  const entries = await Promise.all(paths.map(async (p) => [p, await store.signedUrl(p, expiresIn).catch(() => null)] as const));
  return new Map(entries);
}

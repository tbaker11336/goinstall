/**
 * Private file storage for photos, signatures and PDFs. Files are only ever
 * served through short-lived signed URLs made server-side.
 */

export interface FileStore {
  readonly name: string;
  put(path: string, bytes: Uint8Array, contentType: string): Promise<void>;
  /** A URL the browser can use to view the file for `expiresIn` seconds. */
  signedUrl(path: string, expiresIn?: number): Promise<string>;
  /** The file's bytes, server-side (e.g. to merge certificates into a handover pack). */
  get(path: string): Promise<Uint8Array>;
  remove(path: string): Promise<void>;
}

export interface SupabaseStorageOptions {
  /** https://<ref>.supabase.co */
  url: string;
  /** Service role or secret key: server-side only. */
  serviceKey: string;
  bucket: string;
  fetch?: typeof fetch;
}

function encodePath(path: string) {
  return path.split("/").map(encodeURIComponent).join("/");
}

/** Supabase Storage over its REST API, so no extra client library is needed. */
export function createSupabaseFileStore({ url, serviceKey, bucket, fetch: fetchImpl = fetch }: SupabaseStorageOptions): FileStore {
  const base = `${url.replace(/\/$/, "")}/storage/v1`;
  const headers = { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey };
  async function check(res: Response, action: string) {
    if (res.ok) return;
    const body = await res.text().catch(() => "");
    throw new Error(`Storage ${action} failed (${res.status}): ${body.slice(0, 200)}`);
  }
  return {
    name: "supabase",
    async put(path, bytes, contentType) {
      const res = await fetchImpl(`${base}/object/${bucket}/${encodePath(path)}`, {
        method: "POST",
        headers: { ...headers, "Content-Type": contentType, "x-upsert": "false", "cache-control": "max-age=31536000" },
        body: new Blob([bytes as Uint8Array<ArrayBuffer>], { type: contentType }),
      });
      await check(res, "upload");
    },
    async signedUrl(path, expiresIn = 3600) {
      const res = await fetchImpl(`${base}/object/sign/${bucket}/${encodePath(path)}`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ expiresIn }),
      });
      await check(res, "sign");
      const { signedURL } = (await res.json()) as { signedURL: string };
      return `${base}${signedURL}`;
    },
    async get(path) {
      const res = await fetchImpl(`${base}/object/${bucket}/${encodePath(path)}`, { headers });
      await check(res, "download");
      return new Uint8Array(await res.arrayBuffer());
    },
    async remove(path) {
      const res = await fetchImpl(`${base}/object/${bucket}/${encodePath(path)}`, { method: "DELETE", headers });
      if (res.status !== 404) await check(res, "delete");
    },
  };
}

/**
 * In-memory store for tests. Signed URLs are data: URLs, so pages render
 * without a storage server.
 */
export function createMemoryFileStore(): FileStore & { files: Map<string, { bytes: Uint8Array; contentType: string }> } {
  const files = new Map<string, { bytes: Uint8Array; contentType: string }>();
  return {
    name: "memory",
    files,
    async put(path, bytes, contentType) {
      if (files.has(path)) throw new Error(`File exists: ${path}`);
      files.set(path, { bytes, contentType });
    },
    async signedUrl(path) {
      const f = files.get(path);
      if (!f) throw new Error(`No such file: ${path}`);
      return `data:${f.contentType};base64,${Buffer.from(f.bytes).toString("base64")}`;
    },
    async get(path) {
      const f = files.get(path);
      if (!f) throw new Error(`No such file: ${path}`);
      return f.bytes;
    },
    async remove(path) {
      files.delete(path);
    },
  };
}

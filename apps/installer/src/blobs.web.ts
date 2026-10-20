/** Web build: captures are kept in IndexedDB (localStorage is too small for photos). */
export interface LocalBlob {
  id: string;
  uri: string;
  contentType: string;
}

const DB = "goinstall-captures";
function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore("blobs");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const r = fn(db.transaction("blobs", mode).objectStore("blobs"));
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
const urls = new Map<string, string>();

export async function saveBlob(id: string, source: { uri: string; base64?: string | null }, contentType: string): Promise<LocalBlob> {
  const blob = source.base64 ? new Blob([Uint8Array.from(atob(source.base64), (c) => c.charCodeAt(0))], { type: contentType }) : await (await fetch(source.uri)).blob();
  await tx("readwrite", (s) => s.put(blob, id));
  const uri = URL.createObjectURL(blob);
  urls.set(id, uri);
  return { id, uri, contentType };
}

export async function blobUri(id: string, _contentType?: string): Promise<string | null> {
  if (urls.has(id)) return urls.get(id)!;
  const b = (await tx("readonly", (s) => s.get(id))) as Blob | undefined;
  if (!b) return null;
  const uri = URL.createObjectURL(b);
  urls.set(id, uri);
  return uri;
}

export async function formPart(id: string, _contentType?: string): Promise<Blob | null> {
  return ((await tx("readonly", (s) => s.get(id))) as Blob | undefined) ?? null;
}

export async function removeBlob(id: string, _contentType?: string) {
  await tx("readwrite", (s) => s.delete(id));
}

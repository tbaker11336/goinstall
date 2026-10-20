import { Directory, File, Paths } from "expo-file-system";

/**
 * Photos and signatures are kept on the phone until they've uploaded, so a
 * job can be worked with no signal. Native: the app's document directory.
 */
const dir = () => {
  const d = new Directory(Paths.document, "captures");
  if (!d.exists) d.create({ intermediates: true });
  return d;
};

export interface LocalBlob {
  id: string;
  /** What the app shows (file:// URI, or an object URL on web). */
  uri: string;
  contentType: string;
}

export async function saveBlob(id: string, source: { uri: string; base64?: string | null }, contentType: string): Promise<LocalBlob> {
  const ext = contentType === "image/png" ? "png" : "jpg";
  const dest = new File(dir(), `${id}.${ext}`);
  if (source.base64) dest.write(Uint8Array.from(atob(source.base64), (c) => c.charCodeAt(0)));
  else await new File(source.uri).copy(dest);
  return { id, uri: dest.uri, contentType };
}

export async function blobUri(id: string, contentType: string): Promise<string | null> {
  const f = new File(dir(), `${id}.${contentType === "image/png" ? "png" : "jpg"}`);
  return f.exists ? f.uri : null;
}

/** A FormData part for upload (React Native reads the file from its URI). */
export async function formPart(id: string, contentType: string): Promise<Blob | { uri: string; name: string; type: string } | null> {
  const uri = await blobUri(id, contentType);
  return uri ? { uri, name: `${id}.${contentType === "image/png" ? "png" : "jpg"}`, type: contentType } : null;
}

export async function removeBlob(id: string, contentType: string) {
  const f = new File(dir(), `${id}.${contentType === "image/png" ? "png" : "jpg"}`);
  if (f.exists) f.delete();
}

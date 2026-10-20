import { z } from "zod";
import { asUser } from "@/lib/auth";
import { AERIAL_SIZE_PX, AERIAL_ZOOM, googleMaps } from "@/lib/site";

/**
 * Satellite image of a project's site, fetched server-side so the Google key
 * never reaches the browser. Only staff who can see the project get it.
 */
export async function GET(_: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  if (!z.uuid().safeParse(projectId).success) return new Response("Not found", { status: 404 });
  const maps = googleMaps();
  if (!maps) return new Response("Maps not configured", { status: 404 });
  const project = await asUser((tx) => tx.selectFrom("projects").select(["lat", "lng"]).where("id", "=", projectId).executeTakeFirst());
  if (!project || project.lat == null || project.lng == null) return new Response("No site position", { status: 404 });
  const res = await fetch(maps.staticMapUrl({ lat: project.lat, lng: project.lng }, { zoom: AERIAL_ZOOM, size: AERIAL_SIZE_PX }));
  if (!res.ok) return new Response("Aerial image unavailable", { status: 502 });
  return new Response(res.body, {
    headers: { "Content-Type": res.headers.get("Content-Type") ?? "image/png", "Cache-Control": "private, max-age=86400" },
  });
}

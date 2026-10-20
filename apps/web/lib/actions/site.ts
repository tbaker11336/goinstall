"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { asUser } from "@/lib/auth";
import { aerialWidthM, googleMaps, roofData, segmentsFromInsights, type DesignSegment } from "@/lib/site";

const querySchema = z.string().trim().min(2, "Enter a postcode or address").max(120);

/**
 * Postcode / address search on the design map: moves the site centre there
 * and loads Google's roof data for it. The site address itself is unchanged.
 */
export async function relocateSiteAction(
  projectId: string,
  query: string,
): Promise<{ error?: string; position?: { lat: number; lng: number }; aerialWidthM?: number; roofStatus?: string; segments?: DesignSegment[] }> {
  if (!z.uuid().safeParse(projectId).success) return { error: "Project not found" };
  const q = querySchema.safeParse(query);
  if (!q.success) return { error: q.error.issues[0]!.message };
  const maps = googleMaps();
  if (!maps) return { error: "Search needs the Google Maps key (GOOGLE_MAPS_API_KEY)." };
  const at = await maps.geocode(q.data).catch(() => undefined);
  if (at === undefined) return { error: "The map search isn't working just now. Try again shortly." };
  if (!at) return { error: `Nothing found for “${q.data}”.` };
  return asUser(async (tx) => {
    const updated = await tx.updateTable("projects").set({ lat: at.lat, lng: at.lng }).where("id", "=", projectId).returning("id").executeTakeFirst();
    if (!updated) return { error: "Project not found" };
    // Roof data belongs to the old position: fetch it again for the new one.
    await tx.deleteFrom("roof_data_cache").where("project_id", "=", projectId).execute();
    const roof = await roofData(tx, projectId, at);
    revalidatePath(`/projects/${projectId}/design`);
    return { position: at, aerialWidthM: aerialWidthM(at.lat), roofStatus: roof.status, segments: roof.insights ? segmentsFromInsights(roof.insights, at) : [] };
  });
}

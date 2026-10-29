"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { AddressSuggestion } from "@goinstall/integrations";
import { asUser, requireSession } from "@/lib/auth";
import { aerialWidthM, googleMaps, roofData, segmentsFromInsights, type DesignSegment } from "@/lib/site";

const querySchema = z.string().trim().min(2, "Enter a postcode or address").max(120);
const placeSchema = z.object({ placeId: z.string().min(1).max(300), sessionToken: z.string().min(8).max(64).optional() });
const googleError = (e: unknown) => (e instanceof Error ? e.message.slice(0, 200) : "unknown error");

/** Address suggestions for the design map's search box (UK only). */
export async function suggestAddressesAction(input: string, sessionToken: string): Promise<{ error?: string; suggestions?: AddressSuggestion[] }> {
  await requireSession();
  const q = z.string().trim().min(3).max(120).safeParse(input);
  if (!q.success || !z.string().min(8).max(64).safeParse(sessionToken).success) return { suggestions: [] };
  const maps = googleMaps();
  if (!maps) return { suggestions: [] };
  try {
    return { suggestions: (await maps.autocomplete(q.data, sessionToken)).slice(0, 6) };
  } catch (e) {
    return { error: `Google refused the address suggestions: ${googleError(e)}` };
  }
}

/**
 * Postcode / address search on the design map: moves the site centre there
 * and loads Google's roof data for it. The site address itself is unchanged.
 */
export async function relocateSiteAction(
  projectId: string,
  query: string,
  /** A suggestion picked from the dropdown: its exact location, no geocoding. */
  place?: { placeId: string; sessionToken?: string },
): Promise<{ error?: string; position?: { lat: number; lng: number }; aerialWidthM?: number; roofStatus?: string; segments?: DesignSegment[] }> {
  if (!z.uuid().safeParse(projectId).success) return { error: "Project not found" };
  const q = querySchema.safeParse(query);
  if (!q.success) return { error: q.error.issues[0]!.message };
  const picked = place ? placeSchema.safeParse(place) : null;
  if (picked && !picked.success) return { error: "Choose the address again." };
  const maps = googleMaps();
  if (!maps) return { error: "Search needs the Google Maps key (GOOGLE_MAPS_API_KEY)." };
  let at: { lat: number; lng: number } | null;
  try {
    at = picked ? ((await maps.placeLocation(picked.data.placeId, picked.data.sessionToken))?.at ?? null) : await maps.geocode(q.data);
  } catch (e) {
    return { error: `Google refused the search: ${googleError(e)}` };
  }
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

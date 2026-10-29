"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { AddressParts, AddressSuggestion } from "@goinstall/integrations";
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

/** The chosen suggestion's address fields and location, for filling in a form. */
export async function addressDetailsAction(placeId: string, sessionToken: string): Promise<{ error?: string; parts?: AddressParts; at?: { lat: number; lng: number } }> {
  await requireSession();
  const p = placeSchema.safeParse({ placeId, sessionToken });
  if (!p.success) return { error: "Choose the address again." };
  const maps = googleMaps();
  if (!maps) return { error: "Address lookup needs the Google Maps key." };
  try {
    const place = await maps.placeLocation(p.data.placeId, p.data.sessionToken);
    return place ? { parts: place.parts, at: place.at } : { error: "Google couldn't find that address. Type it in instead." };
  } catch (e) {
    return { error: `Google refused the address lookup: ${googleError(e)}` };
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
  /** EV designs don't need roof data: skip the (billed) Solar API call; solar fetches it when next opened. */
  opts: { roof?: boolean } = {},
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
    revalidatePath(`/projects/${projectId}/design`);
    if (opts.roof === false) return { position: at, aerialWidthM: aerialWidthM(at.lat) };
    const roof = await roofData(tx, projectId, at);
    return { position: at, aerialWidthM: aerialWidthM(at.lat), roofStatus: roof.status, segments: roof.insights ? segmentsFromInsights(roof.insights, at) : [] };
  });
}

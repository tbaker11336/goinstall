/**
 * The Supabase project address, with anything pasted after it dropped
 * (Supabase's dashboard shows it as …supabase.co/rest/v1/, and the sign-in
 * service rejects that).
 */
export function supabaseOrigin(raw: string): string {
  try {
    return new URL(raw.trim()).origin;
  } catch {
    return raw.trim();
  }
}

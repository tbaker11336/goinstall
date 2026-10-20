/**
 * Where the console API lives, and Supabase for sign-in. Set these in
 * EAS / .env as EXPO_PUBLIC_* (public by design: the anon key is not a secret).
 */
export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000").replace(/\/$/, "");
export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "";
/** Local development: sign in as a seeded user without a password (the API refuses this in production). */
export const DEV_SIGN_IN = process.env.EXPO_PUBLIC_DEV_SIGN_IN === "true";

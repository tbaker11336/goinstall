// Build the installer app's web version into public/app, so the console
// serves it at /app on the same domain (no CORS, same sign-in project).
// Runs before `next build`. Native iOS/Android builds come from EAS instead.
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import path from "node:path";

const out = path.resolve(import.meta.dirname, "../public/app");
if (process.env.SKIP_INSTALLER_WEB === "1") {
  console.log("Skipping the installer web build (SKIP_INSTALLER_WEB=1).");
  process.exit(0);
}
rmSync(out, { recursive: true, force: true });
execFileSync("pnpm", ["--filter", "@goinstall/installer", "exec", "expo", "export", "--platform", "web", "--output-dir", out], {
  stdio: "inherit",
  env: {
    ...process.env,
    EXPO_BASE_URL: "/app",
    // Same origin as the console.
    EXPO_PUBLIC_API_URL: "",
    // The console's public Supabase settings (the anon key is public by design).
    EXPO_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    EXPO_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
    EXPO_PUBLIC_DEV_SIGN_IN: "false",
  },
});
console.log(`Installer app (web) built into ${out}`);

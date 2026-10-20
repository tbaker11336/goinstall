import { defineConfig, devices } from "@playwright/test";

const port = 3100;
const pgAdmin = process.env.PG_ADMIN_URL ?? "postgres://postgres:postgres@localhost:5432/postgres";
const e2eDb = pgAdmin.replace(/\/[^/]*$/, "/goinstall_e2e");
// Emails are recorded here instead of sent (see lib/email.ts); tests read survey links from it.
export const OUTBOX = `${process.cwd()}/.data/e2e-outbox.jsonl`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  // The dev server compiles routes on first use, which can take a few seconds.
  expect: { timeout: 15_000 },
  use: {
    baseURL: `http://localhost:${port}`,
    trace: "retain-on-failure",
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // Fresh database with demo data, then the app with dev sign-in.
    command: `mkdir -p .data && rm -f ${OUTBOX} && rm -rf .data/e2e-uploads && DATABASE_URL=${pgAdmin} pnpm --filter @goinstall/db reset-dev goinstall_e2e && pnpm exec next dev --port ${port}`,
    url: `http://localhost:${port}/login`,
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      DATABASE_URL: e2eDb,
      DEV_AUTH: "true",
      DEV_AUTH_SECRET: "e2e-only-secret-not-for-production",
      NEXT_PUBLIC_SITE_URL: `http://localhost:${port}`,
      EMAIL_OUTBOX_FILE: OUTBOX,
      RESEND_API_KEY: "",
      FILE_STORE: "disk",
      FILE_STORE_DIR: `${process.cwd()}/.data/e2e-uploads`,
    },
  },
});

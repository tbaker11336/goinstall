# GoInstall installer app

Expo (SDK 57) app for iOS and Android: My jobs, job details, site survey,
install checklist, customer sign-off. It works offline: everything captured is
saved on the phone and synced to the console's `/api/app/*` routes when there's
signal (files first, then changes in order; last write wins by capture time,
overwritten values kept in history).

## Settings (EAS or `.env`)

| Variable | |
| --- | --- |
| `EXPO_PUBLIC_API_URL` | Console URL, e.g. `https://goinstall-staging.vercel.app` |
| `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Sign-in (public values) |
| `EXPO_PUBLIC_DEV_SIGN_IN` | `true` only for local development |

## Run

- `pnpm --filter @goinstall/installer start` (Expo Go or a dev build)
- `pnpm --filter @goinstall/installer build:web` (used by the e2e tests in `apps/web`)

Serial scanning uses the camera on phones; the web build takes typed serials.
Voice notes use the phone keyboard's dictation.

## Test builds on a phone (EAS)

`eas.json` has a `preview` build pointing at staging. The Supabase anon key
(public by design) is an EAS environment variable,
`EXPO_PUBLIC_SUPABASE_ANON_KEY`, in the `preview` environment.

- Android: `npx eas-cli build --profile preview --platform android` gives an
  APK download link; open it on the phone to install.
- iPhone: needs an Apple Developer account. `npx eas-cli build --profile
  testflight --platform ios --auto-submit` sends it to TestFlight.

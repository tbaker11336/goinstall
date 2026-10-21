"use client";

import { Check, X } from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { checkGoogleAction } from "@/lib/actions/design-rules";
import type { GoogleCheck as Result } from "@/lib/google-check";

/** Hints for Google's usual refusals, matched on its own message. */
function hint(detail: string) {
  if (/referer|referrer/i.test(detail)) return "The server key has a website restriction. Server keys need no application restriction (or an IP restriction): make a separate key for the browser map.";
  if (/not activated|has not been used|disabled|SERVICE_DISABLED|not authorized to use this API/i.test(detail)) return "Enable this API for the key's Google Cloud project, and allow it under the key's API restrictions.";
  if (/billing/i.test(detail)) return "Turn on billing for the Google Cloud project.";
  if (/invalid|API key not valid/i.test(detail)) return "The key in GOOGLE_MAPS_API_KEY isn't valid: check it was copied in full, then redeploy.";
  return null;
}

export function GoogleCheck() {
  const [result, setResult] = useState<Result | { error: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col gap-3">
      <Button type="button" variant="outline" className="w-fit" disabled={pending} onClick={() => start(async () => setResult(await checkGoogleAction()))}>
        {pending ? "Checking…" : "Check Google connection"}
      </Button>
      {result && "error" in result && <p role="alert" className="text-sm text-red-800">{result.error}</p>}
      {result && "key" in result && (
        <ul className="flex flex-col gap-2 text-sm" aria-label="Google connection" role="status">
          {result.key === "missing" ? (
            <li className="flex gap-2 text-red-800">
              <X className="size-4 shrink-0" aria-hidden /> GOOGLE_MAPS_API_KEY isn&apos;t set on the server. Add it in Vercel, then redeploy.
            </li>
          ) : (
            result.results.map((r) => (
              <li key={r.api} className="flex gap-2">
                {r.ok ? <Check className="size-4 shrink-0 text-success" aria-label="Working" /> : <X className="size-4 shrink-0 text-red-700" aria-label="Failing" />}
                <span>
                  <span className="font-semibold">{r.api}</span>: {r.detail}
                  {!r.ok && hint(r.detail) && <span className="block text-ink-3">{hint(r.detail)}</span>}
                </span>
              </li>
            ))
          )}
          <li className="flex gap-2">
            {result.browserKey === "set" ? <Check className="size-4 shrink-0 text-success" aria-label="Set" /> : <X className="size-4 shrink-0 text-warning" aria-label="Not set" />}
            <span>
              <span className="font-semibold">Browser key for the live map</span>:{" "}
              {result.browserKey === "set" ? "set" : "not set (NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY). The designer uses the saved aerial image until it is."}
            </span>
          </li>
        </ul>
      )}
    </div>
  );
}

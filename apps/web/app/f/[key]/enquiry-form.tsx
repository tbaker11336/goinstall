"use client";

import { FIELD_LABELS, OPTIONAL_FIELDS, type EnquiryFormConfig } from "@goinstall/core";
import { useActionState, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";
import { submitEnquiryFormAction, type EnquiryFormState } from "./actions";

const PRODUCT_LABEL = { solar: "Solar panels", battery: "Battery", ev: "EV charger" } as const;

/** Tells the page embedding this form how tall it is (see /embed/enquiry.js). */
function useReportHeight(key: string) {
  useEffect(() => {
    if (window.parent === window) return;
    const send = () => window.parent.postMessage({ type: "goinstall:height", key, height: document.documentElement.scrollHeight }, "*");
    const ro = new ResizeObserver(send);
    ro.observe(document.body);
    send();
    return () => ro.disconnect();
  }, [key]);
}

export function EnquiryForm({ formKey, config, preview }: { formKey: string; config: EnquiryFormConfig; preview: boolean }) {
  const [state, action, pending] = useActionState<EnquiryFormState, FormData>(submitEnquiryFormAction.bind(null, formKey), {});
  const [renderedAt] = useState(() => Date.now());
  const top = useRef<HTMLDivElement>(null);
  useReportHeight(formKey);
  useEffect(() => {
    if (state.ok || state.error) top.current?.focus();
  }, [state]);
  const err = (k: string) => state.errors?.[k];

  if (state.ok) {
    return (
      <div ref={top} tabIndex={-1} role="status" className="rounded-[14px] border bg-card p-6 text-center">
        <p className="text-lg font-bold">{config.thankYou}</p>
      </div>
    );
  }
  const field = (name: string, label: string, opts: { required: boolean; type?: string; autoComplete?: string; multiline?: boolean }) => (
    <div className="grid gap-1.5">
      <Label htmlFor={`gi-${name}`}>
        {label}
        {!opts.required && <span className="font-normal text-muted-foreground"> (optional)</span>}
      </Label>
      {opts.multiline ? (
        <Textarea id={`gi-${name}`} name={name} rows={3} required={opts.required} aria-invalid={Boolean(err(name))} aria-describedby={err(name) ? `gi-${name}-err` : undefined} />
      ) : (
        <Input id={`gi-${name}`} name={name} type={opts.type ?? "text"} autoComplete={opts.autoComplete} required={opts.required} aria-invalid={Boolean(err(name))} aria-describedby={err(name) ? `gi-${name}-err` : undefined} />
      )}
      {err(name) && (
        <p id={`gi-${name}-err`} className="text-xs text-destructive">
          {err(name)}
        </p>
      )}
    </div>
  );
  return (
    <form action={action} className="flex flex-col gap-4 rounded-[14px] border bg-card p-6" noValidate={false}>
      <div ref={top} tabIndex={-1}>
        <h1 className="text-xl font-bold tracking-[-0.01em]">{config.heading}</h1>
        {config.intro && <p className="mt-1 text-sm text-ink-3">{config.intro}</p>}
      </div>
      {state.error && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-900">
          {state.error}
        </p>
      )}
      <input type="hidden" name="_t" value={renderedAt} />
      {/* Honeypot: hidden from people and screen readers. */}
      <div aria-hidden className="absolute -left-[9999px]">
        <label>
          Website <input type="text" name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      {field("name", "Your name", { required: true, autoComplete: "name" })}
      {field("email", "Email", { required: true, type: "email", autoComplete: "email" })}
      {OPTIONAL_FIELDS.filter((k) => config.fields[k] !== "hidden").map((k) => (
        <div key={k}>
          {field(k, FIELD_LABELS[k], {
            required: config.fields[k] === "required",
            type: k === "phone" ? "tel" : "text",
            autoComplete: k === "phone" ? "tel" : k === "postcode" ? "postal-code" : k === "address" ? "street-address" : undefined,
            multiline: k === "message",
          })}
        </div>
      ))}
      {config.products.length > 0 && (
        <fieldset className="grid gap-2" aria-describedby={err("products") ? "gi-products-err" : undefined}>
          <legend className="mb-1 text-[13px] font-semibold text-ink-2">I&apos;m interested in</legend>
          {config.products.map((p) => (
            <label key={p} className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="products" value={p} className="size-4 accent-[var(--primary)]" /> {PRODUCT_LABEL[p]}
            </label>
          ))}
          {err("products") && (
            <p id="gi-products-err" className="text-xs text-destructive">
              {err("products")}
            </p>
          )}
        </fieldset>
      )}
      <Button type="submit" size="lg" disabled={pending || preview} title={preview ? "Preview: sending is turned off" : undefined}>
        {pending ? "Sending…" : config.buttonText}
      </Button>
      {preview && <p className="text-center text-xs text-muted-foreground">Preview: sending is turned off here.</p>}
    </form>
  );
}

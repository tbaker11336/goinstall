"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { FormMessage, SubmitButton, type FormState } from "@/components/forms";
import { Field, Input } from "@/components/ui/input";
import { uploadLogoAction } from "@/lib/actions/settings";

/** Choose a logo and see it straight away, before uploading. */
export function LogoUpload({ replacing }: { replacing: boolean }) {
  const [state, action] = useActionState(uploadLogoAction, {} as FormState);
  const [preview, setPreview] = useState<string | null>(null);
  const form = useRef<HTMLFormElement>(null);
  // Once saved, the page shows the uploaded logo, so clear the picker and its preview.
  useEffect(() => {
    if (state.message) {
      form.current?.reset();
      setPreview(null);
    }
  }, [state]);
  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);
  return (
    <form ref={form} action={action} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <Field label={replacing ? "Replace the logo" : "Upload a logo"} htmlFor="logo" hint="PNG or JPEG, up to 2 MB. A wide logo on a white or clear background works best.">
          <Input
            id="logo"
            name="logo"
            type="file"
            accept="image/png,image/jpeg"
            required
            className="w-72 py-1.5"
            aria-describedby="logo-hint"
            onChange={(e) => {
              const f = e.target.files?.[0];
              setPreview(f && f.type.startsWith("image/") ? URL.createObjectURL(f) : null);
            }}
          />
        </Field>
        <SubmitButton pendingText="Uploading…">Upload logo</SubmitButton>
      </div>
      {preview && (
        <figure className="flex flex-col gap-1.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview} alt="Preview of the logo you chose" className="h-20 max-w-[280px] rounded-md border bg-white object-contain p-2" />
          <figcaption className="text-xs text-ink-3">Preview: click Upload logo to use it.</figcaption>
        </figure>
      )}
      <FormMessage state={state} />
    </form>
  );
}

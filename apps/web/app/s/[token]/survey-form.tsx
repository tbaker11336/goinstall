"use client";

import { Camera, Check, ChevronLeft, Loader2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { startTransition, useActionState, useEffect, useRef, useState, useTransition } from "react";
import { cn } from "@/lib/utils";
import { removeSurveyPhotoAction, saveStepAction, submitSurveyAction, uploadSurveyPhotoAction, type SurveyActionResult } from "./actions";

export interface FormQuestion {
  key: string;
  label: string;
  help: string | null;
  type: "text" | "long_text" | "number" | "select" | "yes_no";
  options: string[];
  required: boolean;
}

export interface FormSection {
  section: string;
  questions: FormQuestion[];
}

export interface FormCategory {
  key: string;
  label: string;
  help: string | null;
  required: boolean;
  photos: { id: string; url: string | null; mine: boolean }[];
}

const MAX_EDGE = 1600;

/** Shrink phone photos before upload: faster on mobile data and well under the size limit. */
async function resizeImage(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
    if (blob) return blob;
  } catch {
    // Some formats (HEIC outside Safari) can't be decoded; send the original.
  }
  return file;
}

function Question({ q, value, error }: { q: FormQuestion; value: string | null; error?: string }) {
  const id = `f_${q.key}`;
  const describedBy = [q.help ? `${id}-help` : null, error ? `${id}-error` : null].filter(Boolean).join(" ") || undefined;
  const label = (
    <>
      {q.label}
      {q.required && <span className="text-warning-text"> *</span>}
      {q.required && <span className="sr-only"> (required)</span>}
    </>
  );
  const input = "w-full rounded-[10px] border border-input bg-card px-3.5 text-base text-foreground aria-invalid:border-destructive";
  const choices = q.type === "yes_no" ? ["Yes", "No"] : q.options;

  if (q.type === "select" || q.type === "yes_no") {
    return (
      <fieldset className="flex flex-col gap-2" aria-describedby={describedBy} aria-invalid={error ? true : undefined}>
        <legend className="mb-1 text-[15px] font-semibold">{label}</legend>
        {q.help && <p id={`${id}-help`} className="-mt-1 text-sm text-ink-3">{q.help}</p>}
        <div className={cn("grid gap-2", q.type === "yes_no" && "grid-cols-2")}>
          {choices.map((opt) => (
            <label key={opt} className="flex min-h-12 cursor-pointer items-center gap-3 rounded-[10px] border border-input bg-card px-3.5 text-[15px] has-checked:border-primary has-checked:bg-accent-tint has-checked:font-semibold">
              <input type="radio" name={id} value={opt} defaultChecked={value === opt} className="size-[18px] accent-[var(--primary)]" />
              {opt}
            </label>
          ))}
        </div>
        {error && <p id={`${id}-error`} className="text-sm font-medium text-destructive">{error}</p>}
      </fieldset>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[15px] font-semibold">
        {label}
      </label>
      {q.help && <p id={`${id}-help`} className="text-sm text-ink-3">{q.help}</p>}
      {q.type === "long_text" ? (
        <textarea id={id} name={id} defaultValue={value ?? ""} rows={3} aria-describedby={describedBy} aria-invalid={error ? true : undefined} className={cn(input, "py-3")} />
      ) : (
        <input
          id={id}
          name={id}
          defaultValue={value ?? ""}
          inputMode={q.type === "number" ? "decimal" : undefined}
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
          className={cn(input, "h-12")}
        />
      )}
      {error && <p id={`${id}-error`} className="text-sm font-medium text-destructive">{error}</p>}
    </div>
  );
}

function PhotoTile({ token, category }: { token: string; category: FormCategory }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const has = category.photos.length > 0;

  function upload(files: FileList | null) {
    if (!files?.length) return;
    setError(null);
    startTransition(async () => {
      for (const file of Array.from(files)) {
        const blob = await resizeImage(file);
        const form = new FormData();
        form.set("category", category.key);
        form.set("photo", new File([blob], file.name.replace(/\.\w+$/, "") + (blob.type === "image/jpeg" ? ".jpg" : ""), { type: blob.type || file.type }));
        const result = await uploadSurveyPhotoAction(token, form);
        if (result.error) {
          setError(result.error);
          break;
        }
      }
      if (input.current) input.current.value = "";
      router.refresh();
    });
  }

  return (
    <li className={cn("flex flex-col gap-3 rounded-xl border bg-card p-4", !has && category.required && "border-dashed border-warning-border bg-warning-tint")}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold">
            {category.label}
            {!category.required && <span className="font-normal text-ink-3"> (optional)</span>}
          </p>
          {category.help && <p className="text-sm text-ink-3">{category.help}</p>}
        </div>
        {has && (
          <span className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-success-text">
            <Check className="size-4" aria-hidden /> Added
          </span>
        )}
      </div>
      {has && (
        <ul className="grid grid-cols-3 gap-2">
          {category.photos.map((p) => (
            <li key={p.id} className="relative aspect-square overflow-hidden rounded-lg bg-muted">
              {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URLs */}
              {p.url && <img src={p.url} alt={`${category.label} photo`} className="size-full object-cover" />}
              {p.mine && (
                <button
                  type="button"
                  aria-label={`Remove ${category.label} photo`}
                  disabled={busy}
                  onClick={() =>
                    startTransition(async () => {
                      await removeSurveyPhotoAction(token, p.id);
                      router.refresh();
                    })
                  }
                  className="absolute top-1 right-1 inline-flex size-7 items-center justify-center rounded-full bg-black/60 text-white"
                >
                  <X className="size-4" aria-hidden />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <label className={cn("inline-flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-[10px] border border-input bg-card px-4 text-[15px] font-semibold text-ink-2", busy && "opacity-60")}>
        {busy ? <Loader2 className="size-5 animate-spin" aria-hidden /> : <Camera className="size-5" aria-hidden />}
        {busy ? "Uploading…" : has ? "Add another photo" : "Take or choose a photo"}
        <input ref={input} type="file" accept="image/*" capture="environment" multiple className="sr-only" disabled={busy} onChange={(e) => upload(e.target.files)} />
      </label>
      {error && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {error}
        </p>
      )}
    </li>
  );
}

export function SurveyForm({
  token,
  sections,
  categories,
  values,
  completed,
}: {
  token: string;
  sections: FormSection[];
  categories: FormCategory[];
  values: Record<string, string | null>;
  completed: boolean;
}) {
  const steps = [...sections.map((s) => s.section), ...(categories.length ? ["Photos"] : [])];
  const [step, setStep] = useState(0);
  const [editing, setEditing] = useState(!completed);
  const isLast = step === steps.length - 1;
  const [saveState, save, saving] = useActionState<SurveyActionResult, FormData>(saveStepAction.bind(null, token), {});
  const [submitState, submit, submitting] = useActionState<SurveyActionResult, FormData>(submitSurveyAction.bind(null, token), {});
  const heading = useRef<HTMLHeadingElement>(null);
  const advanced = useRef(false);
  const state = isLast ? submitState : saveState;

  // Move on once a step has saved without errors.
  useEffect(() => {
    if (advanced.current && saveState.ok && !saving) {
      advanced.current = false;
      setStep((s) => Math.min(s + 1, steps.length - 1));
    }
  }, [saveState, saving, steps.length]);
  useEffect(() => {
    heading.current?.focus();
    window.scrollTo({ top: 0 });
  }, [step]);
  useEffect(() => {
    if (submitState.ok) setEditing(false);
  }, [submitState]);
  // Jump back to the first step with a missing answer.
  useEffect(() => {
    const keys = Object.keys(submitState.fieldErrors ?? {});
    if (!keys.length) return;
    const i = sections.findIndex((s) => s.questions.some((q) => keys.includes(q.key)));
    if (i >= 0) setStep(i);
  }, [submitState, sections]);

  if (!editing) {
    return (
      <section className="flex flex-col items-center gap-4 rounded-2xl border bg-card px-6 py-10 text-center" aria-live="polite">
        <span className="inline-flex size-14 items-center justify-center rounded-full bg-success-tint text-success-text">
          <Check className="size-7" strokeWidth={2.5} aria-hidden />
        </span>
        <h2 className="text-xl font-bold">Thank you, that&apos;s everything</h2>
        <p className="max-w-sm text-ink-3">Your answers and photos are with the team. We&apos;ll be in touch about the next step.</p>
        <button type="button" onClick={() => { setEditing(true); setStep(0); }} className="text-sm font-semibold text-primary underline-offset-4 hover:underline">
          Change an answer or add photos
        </button>
      </section>
    );
  }

  const errors = { ...(saveState.fieldErrors ?? {}), ...(submitState.fieldErrors ?? {}) };
  const section = sections[step];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2" aria-hidden>
        <div className="flex justify-between text-[13px] font-semibold text-ink-3">
          <span>
            Step {step + 1} of {steps.length}
          </span>
          <span>{steps[step]}</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-divider">
          <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${((step + 1) / steps.length) * 100}%` }} />
        </div>
      </div>

      <form
        // Submitted by hand rather than through the form's action prop: React
        // resets a form after its action runs, which would blank the answers
        // on the other (hidden) steps before the final submit.
        onSubmit={(e) => {
          e.preventDefault();
          const data = new FormData(e.currentTarget);
          if (!isLast) advanced.current = true;
          startTransition(() => (isLast ? submit : save)(data));
        }}
        className="flex flex-col gap-6 rounded-2xl border bg-card p-5"
      >
        <h2 ref={heading} tabIndex={-1} className="text-xl font-bold outline-none">
          {steps[step]}
          <span className="sr-only">, step {step + 1} of {steps.length}</span>
        </h2>
        {/* Every section's inputs stay mounted (hidden) so the final submit carries all answers. */}
        {sections.map((s, i) => (
          <div key={s.section} hidden={i !== step} className="flex flex-col gap-6">
            {s.questions.map((q) => (
              <Question key={q.key} q={q} value={values[q.key] ?? null} error={errors[q.key]} />
            ))}
          </div>
        ))}
        {!section && (
          <>
            <p className="-mt-3 text-ink-3">Photos help us design your system without an extra visit. Add what you can; you can come back to this link later.</p>
            <ul className="flex flex-col gap-3">
              {categories.map((c) => (
                <PhotoTile key={c.key} token={token} category={c} />
              ))}
            </ul>
          </>
        )}
        {state.error && (
          <p role="alert" className="rounded-[10px] bg-red-50 px-3.5 py-3 text-sm font-medium text-red-800">
            {state.error}
          </p>
        )}
        <div className="flex gap-3">
          {step > 0 && (
            <button type="button" onClick={() => setStep(step - 1)} className="inline-flex min-h-[52px] items-center gap-1 rounded-[14px] border border-input bg-card px-4 font-semibold text-ink-2">
              <ChevronLeft className="size-5" aria-hidden /> Back
            </button>
          )}
          <button
            type="submit"
            disabled={saving || submitting}
            className="inline-flex min-h-[52px] flex-1 items-center justify-center gap-2 rounded-[14px] bg-primary px-4 text-base font-bold text-white hover:bg-primary-hover disabled:opacity-60"
          >
            {(saving || submitting) && <Loader2 className="size-5 animate-spin" aria-hidden />}
            {isLast ? "Send to the team" : "Save and continue"}
          </button>
        </div>
      </form>
      <p className="text-center text-[13px] text-muted-foreground">Your answers save at each step, so you can close this page and carry on later.</p>
    </div>
  );
}

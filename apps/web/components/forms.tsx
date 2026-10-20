"use client";

import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import { Button, type ButtonProps } from "@/components/ui/button";

export interface FormState {
  error?: string;
  message?: string;
}

type Action = (state: FormState, form: FormData) => Promise<FormState>;

/** A form bound to a server action that returns { error | message }. */
export function ActionForm({
  action,
  children,
  className,
  resetOnSuccess = false,
}: {
  action: Action;
  children: React.ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
}) {
  const [state, formAction] = useActionState(action, {});
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (resetOnSuccess && state.message) ref.current?.reset();
  }, [state, resetOnSuccess]);
  return (
    <form ref={ref} action={formAction} className={className}>
      {children}
      <FormMessage state={state} />
    </form>
  );
}

export function FormMessage({ state }: { state: FormState }) {
  if (state.error)
    return (
      <p role="alert" className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-900">
        {state.error}
      </p>
    );
  if (state.message)
    return (
      <p role="status" className="mt-3 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
        {state.message}
      </p>
    );
  return null;
}

export function SubmitButton({ children, pendingText, ...props }: ButtonProps & { pendingText?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} aria-disabled={pending} {...props}>
      {pending ? (pendingText ?? "Saving…") : children}
    </Button>
  );
}

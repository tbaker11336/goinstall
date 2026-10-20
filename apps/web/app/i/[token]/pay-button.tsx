"use client";

import { useState, useTransition } from "react";
import { FormMessage, type FormState } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { payInvoiceByCardAction } from "./actions";

export function PayInvoiceButton({ token, label }: { token: string; label: string }) {
  const [state, setState] = useState<FormState>({});
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col">
      <Button
        size="lg"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await payInvoiceByCardAction(token);
            if (r?.error) setState({ error: r.error });
          })
        }
      >
        {pending ? "Opening secure payment…" : label}
      </Button>
      <FormMessage state={state} />
    </div>
  );
}

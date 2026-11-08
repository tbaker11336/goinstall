"use client";

import { useState, useTransition } from "react";
import { FormMessage, type FormState } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { checkXeroPaymentsAction, disconnectXeroAction, syncAllToXeroAction } from "@/lib/actions/xero";

function Run({ label, pendingLabel, action, variant = "outline", confirm }: { label: string; pendingLabel: string; action: () => Promise<FormState>; variant?: "outline" | "ghost" | "default"; confirm?: string }) {
  const [pending, start] = useTransition();
  const [state, setState] = useState<FormState>({});
  return (
    <div className="flex flex-col gap-2">
      <Button type="button" variant={variant} disabled={pending} onClick={() => (!confirm || window.confirm(confirm)) && start(async () => setState(await action()))}>
        {pending ? pendingLabel : label}
      </Button>
      <FormMessage state={state} />
    </div>
  );
}

export function XeroActions() {
  return (
    <div className="flex flex-wrap items-start gap-3">
      <Run label="Send invoices to Xero now" pendingLabel="Sending…" action={syncAllToXeroAction} />
      <Run label="Check Xero for payments" pendingLabel="Checking…" action={checkXeroPaymentsAction} />
      <Run label="Disconnect Xero" pendingLabel="Disconnecting…" variant="ghost" action={disconnectXeroAction} confirm="Disconnect Xero? New invoices won't be sent to it." />
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";
import { FormMessage, type FormState } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { cancelBookingAction, confirmAndNotifyAction, markCustomerConfirmedAction } from "@/lib/actions/bookings";

function useRun() {
  const [pending, start] = useTransition();
  const [state, setState] = useState<FormState>({});
  return { pending, state, run: (fn: () => Promise<FormState>) => start(async () => setState(await fn())) };
}

export function ConfirmNotifyButton({ projectId, done }: { projectId: string; done: boolean }) {
  const { pending, state, run } = useRun();
  return (
    <div className="flex flex-col items-end">
      <Button disabled={pending} onClick={() => run(() => confirmAndNotifyAction(projectId))}>
        {pending ? "Confirming…" : done ? "Send dates again" : "Confirm and notify customer"}
      </Button>
      <FormMessage state={state} />
    </div>
  );
}

export function CustomerConfirmedToggle({ projectId, confirmed }: { projectId: string; confirmed: boolean }) {
  const { pending, run } = useRun();
  return (
    <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => markCustomerConfirmedAction(projectId, !confirmed))}>
      {confirmed ? "Undo" : "Mark confirmed"}
    </Button>
  );
}

export function CancelBookingButton({ bookingId }: { bookingId: string }) {
  const { pending, state, run } = useRun();
  return (
    <>
      <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => run(() => cancelBookingAction(bookingId))}>
        Cancel booking
      </Button>
      <FormMessage state={state} />
    </>
  );
}

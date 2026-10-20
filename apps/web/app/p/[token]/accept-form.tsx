"use client";

import { useRef, useState, useTransition } from "react";
import { FormMessage, type FormState } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { acceptProposalAction, payDepositByCardAction } from "./actions";

/** Drawn signature (pointer). Optional: the typed name is the keyboard alternative. */
function SignaturePad({ onChange }: { onChange: (dataUrl: string | null) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const inked = useRef(false);
  const [empty, setEmpty] = useState(true);
  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * e.currentTarget.width, ((e.clientY - r.top) / r.height) * e.currentTarget.height] as const;
  };
  return (
    <div className="flex flex-col gap-1.5">
      <span id="sig-label" className="text-[13px] font-semibold text-ink-2">
        Signature (optional: draw with your finger or mouse)
      </span>
      <canvas
        ref={ref}
        width={560}
        height={160}
        aria-labelledby="sig-label"
        role="img"
        className="h-32 w-full touch-none rounded-md border border-input bg-card"
        onPointerDown={(e) => {
          const ctx = e.currentTarget.getContext("2d")!;
          ctx.lineWidth = 2.5;
          ctx.lineCap = "round";
          ctx.strokeStyle = "#101828";
          ctx.beginPath();
          ctx.moveTo(...pos(e));
          drawing.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return;
          const ctx = e.currentTarget.getContext("2d")!;
          ctx.lineTo(...pos(e));
          ctx.stroke();
          inked.current = true;
          setEmpty(false);
        }}
        onPointerUp={(e) => {
          drawing.current = false;
          if (inked.current) onChange(e.currentTarget.toDataURL("image/png"));
        }}
      />
      {!empty && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="self-start"
          onClick={() => {
            const c = ref.current!;
            c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
            inked.current = false;
            setEmpty(true);
            onChange(null);
          }}
        >
          Clear signature
        </Button>
      )}
    </div>
  );
}

export function AcceptForm({ token, customerName, hasTerms }: { token: string; customerName: string; hasTerms: boolean }) {
  const [name, setName] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [signature, setSignature] = useState<string | null>(null);
  const [state, setState] = useState<FormState>({});
  const [pending, start] = useTransition();
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await acceptProposalAction(token, { name, agreed: agreed as true, signature });
          setState(r.error ? { error: r.error } : {});
        });
      }}
    >
      <div className="grid gap-1.5">
        <Label htmlFor="accept-name">Your full name</Label>
        <Input id="accept-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" placeholder={customerName} required />
      </div>
      <SignaturePad onChange={setSignature} />
      <label className="flex items-start gap-2.5 text-sm">
        <input type="checkbox" className="mt-0.5 size-4 accent-[var(--primary)]" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} required />
        <span>I accept this proposal{hasTerms ? " and its terms and conditions" : ""}. Typing my name counts as my signature.</span>
      </label>
      <Button type="submit" size="lg" disabled={pending}>
        {pending ? "Accepting…" : "Accept and sign"}
      </Button>
      <FormMessage state={state} />
    </form>
  );
}

export function PayByCardButton({ token, label }: { token: string; label: string }) {
  const [state, setState] = useState<FormState>({});
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col">
      <Button
        size="lg"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await payDepositByCardAction(token);
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

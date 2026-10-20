"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

/** Read-only code or link with a copy button. */
export function CopyField({ id, label, value, multiline }: { id: string; label: string; value: string; multiline?: boolean }) {
  const [copied, setCopied] = useState(false);
  const cls = "w-full min-w-0 rounded-md border border-input bg-surface-subtle px-3 py-2 font-mono text-[13px]";
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[13px] font-semibold text-ink-2">
        {label}
      </label>
      <div className="flex items-start gap-2">
        {multiline ? <textarea id={id} readOnly value={value} rows={3} className={cls} onFocus={(e) => e.currentTarget.select()} /> : <input id={id} readOnly value={value} className={`${cls} h-10`} onFocus={(e) => e.currentTarget.select()} />}
        <Button
          type="button"
          variant="outline"
          onClick={() =>
            navigator.clipboard?.writeText(value).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            })
          }
        >
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
    </div>
  );
}

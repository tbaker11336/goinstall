"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export function SettingsNav({ sections }: { sections: { href: string; label: string }[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Settings sections" className="flex w-[210px] shrink-0 flex-col gap-0.5 max-md:w-full max-md:flex-row max-md:overflow-x-auto">
      {sections.map((s) => {
        const active = pathname.startsWith(s.href);
        return (
          <Link
            key={s.href}
            href={s.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-md px-3 py-[9px] text-sm font-medium whitespace-nowrap text-ink-3 hover:bg-card hover:text-foreground",
              active && "bg-card font-semibold text-foreground shadow-[inset_2px_0_0_var(--primary)]",
            )}
          >
            {s.label}
          </Link>
        );
      })}
    </nav>
  );
}

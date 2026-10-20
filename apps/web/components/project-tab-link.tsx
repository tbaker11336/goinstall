"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export function ProjectTabLink({ href, exact, children }: { href: string; exact?: boolean; children: React.ReactNode }) {
  const pathname = usePathname();
  const active = exact ? pathname === href : pathname.startsWith(href);
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "-mb-px mr-6 inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 px-0.5 py-3 text-sm font-medium text-ink-3 hover:text-foreground",
        active ? "border-primary font-semibold text-foreground" : "border-transparent",
      )}
    >
      {children}
    </Link>
  );
}

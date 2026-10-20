"use client";

import { CalendarDays, FileText, Folder, LayoutGrid, SlidersHorizontal, Users } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Avatar } from "@/components/domain";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutGrid },
  { href: "/contacts", label: "Contacts", icon: Users },
  { href: "/projects", label: "Projects", icon: Folder },
  { href: "/proposals", label: "Proposals", icon: FileText },
  { href: "/schedule", label: "Schedule", icon: CalendarDays },
];

export function Logo({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <rect width="32" height="32" rx="8" fill="#0B7A62" />
      <circle cx="16" cy="17" r="5" fill="none" stroke="#FFFFFF" strokeWidth="2" />
      <path d="M16 6.5v3M7.5 17h3M21.5 17h3M10 11l2 2M22 11l-2 2" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function NavLink({ href, label, icon: Icon, rail }: (typeof NAV)[number] & { rail: boolean }) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      aria-label={rail ? label : undefined}
      title={rail ? label : undefined}
      className={cn(
        "flex items-center gap-3 rounded-md text-sm font-medium text-ink-3 transition-colors hover:bg-muted hover:text-foreground",
        rail ? "size-11 justify-center rounded-[10px]" : "min-h-10 px-3",
        active && "bg-accent-tint font-semibold text-accent-strong hover:bg-accent-tint hover:text-accent-strong",
      )}
    >
      <Icon className="size-5 shrink-0" strokeWidth={1.75} aria-hidden />
      {!rail && label}
    </Link>
  );
}

const ROLE_LABELS = { admin: "Admin", office: "Office", installer: "Installer", subcontractor: "Subcontractor" } as const;

export function Sidebar({
  companyName,
  userName,
  role,
  signOut,
}: {
  companyName: string;
  userName: string;
  role: keyof typeof ROLE_LABELS;
  signOut: () => Promise<void>;
}) {
  // Project pages use a 72 px icon rail so the design tools get the width.
  const rail = /^\/projects\/[^/]+/.test(usePathname());
  return (
    <aside
      className={cn(
        "flex shrink-0 flex-col gap-1 border-r bg-card max-md:w-full max-md:flex-row max-md:items-center max-md:border-r-0 max-md:border-b max-md:px-3 max-md:py-2",
        rail ? "w-[72px] items-center px-3.5 py-4" : "w-[248px] px-3.5 py-5",
      )}
    >
      <div className={cn("flex items-center gap-2.5", rail ? "mb-4 md:justify-center" : "px-2 pt-1 pb-6 max-md:p-0")}>
        <Logo size={rail ? 36 : 32} />
        {!rail && (
          <div className="flex min-w-0 flex-col max-md:hidden">
            <span className="text-base font-bold tracking-[-0.01em]">GoInstall</span>
            <span className="truncate text-xs text-muted-foreground" title={companyName}>
              {companyName}
            </span>
          </div>
        )}
      </div>
      <nav aria-label="Main" className="max-md:flex-1 max-md:overflow-x-auto">
        <ul className={cn("flex flex-col gap-1 max-md:flex-row", rail && "items-center")}>
          {NAV.map((item) => (
            <li key={item.href}>
              <NavLink {...item} rail={rail} />
            </li>
          ))}
        </ul>
      </nav>
      <div className="flex-1 max-md:hidden" />
      {role === "admin" && (
        <div className="max-md:hidden">
          <NavLink href="/settings" label="Settings" icon={SlidersHorizontal} rail={rail} />
        </div>
      )}
      {rail ? (
        <form action={signOut} className="mt-2 max-md:hidden">
          <button type="submit" className="rounded-full" title={`${userName} · Sign out`} aria-label={`Sign out ${userName}`}>
            <Avatar name={userName} size="md" />
          </button>
        </form>
      ) : (
        <div className="mt-2 flex items-center gap-2.5 border-t border-divider px-2 pt-3.5 max-md:hidden">
          <Avatar name={userName} size="md" />
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-sm font-semibold">{userName}</span>
            <span className="text-[12.5px] text-muted-foreground">{ROLE_LABELS[role]}</span>
          </div>
          <form action={signOut}>
            <button type="submit" className="text-[12.5px] font-medium text-ink-3 underline-offset-4 hover:text-foreground hover:underline">
              Sign out
            </button>
          </form>
        </div>
      )}
    </aside>
  );
}

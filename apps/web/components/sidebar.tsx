"use client";

import { CalendarDays, FileText, FolderKanban, LayoutDashboard, Settings, Users } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/contacts", label: "Contacts", icon: Users },
  { href: "/projects", label: "Projects", icon: FolderKanban },
  { href: "/proposals", label: "Proposals", icon: FileText },
  { href: "/schedule", label: "Schedule", icon: CalendarDays },
];

function NavLink({ href, label, icon: Icon }: (typeof NAV)[number]) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-sidebar-active hover:text-white",
        active && "bg-sidebar-active text-white",
      )}
    >
      <Icon className="size-4" aria-hidden />
      {label}
    </Link>
  );
}

export function Sidebar({ companyName, userName, isAdmin, signOut }: { companyName: string; userName: string; isAdmin: boolean; signOut: () => Promise<void> }) {
  return (
    <aside className="flex w-56 shrink-0 flex-col bg-sidebar text-sidebar-foreground max-md:w-full">
      <div className="px-4 py-4">
        <p className="text-base font-semibold text-white">
          Go<span className="text-teal-300">Install</span>
        </p>
        <p className="truncate text-xs" title={companyName}>
          {companyName}
        </p>
      </div>
      <nav aria-label="Main" className="flex-1 px-2 max-md:flex max-md:overflow-x-auto max-md:pb-2">
        <ul className="grid gap-1 max-md:flex">
          {NAV.map((item) => (
            <li key={item.href}>
              <NavLink {...item} />
            </li>
          ))}
        </ul>
      </nav>
      <div className="border-t border-white/10 p-2 max-md:hidden">
        {isAdmin && <NavLink href="/settings" label="Settings" icon={Settings} />}
        <div className="mt-2 flex items-center justify-between gap-2 px-3 py-2 text-xs">
          <span className="truncate">{userName}</span>
          <form action={signOut}>
            <button type="submit" className="underline-offset-4 hover:text-white hover:underline">
              Sign out
            </button>
          </form>
        </div>
      </div>
    </aside>
  );
}

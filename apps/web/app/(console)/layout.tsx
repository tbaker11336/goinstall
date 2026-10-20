import { Sidebar } from "@/components/sidebar";
import { requireSession } from "@/lib/auth";
import { signOutAction } from "../(auth)/actions";

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  return (
    <div className="flex min-h-dvh max-md:flex-col">
      <Sidebar companyName={session.companyName} userName={session.fullName} isAdmin={session.role === "admin"} signOut={signOutAction} />
      <main className="min-w-0 flex-1 p-6 max-md:p-4">{children}</main>
    </div>
  );
}

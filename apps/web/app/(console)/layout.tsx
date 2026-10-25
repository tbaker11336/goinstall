import { Sidebar } from "@/components/sidebar";
import { asUser, requireSession } from "@/lib/auth";
import { signOutAction } from "../(auth)/actions";

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const unread = await asUser(async (tx) => Number((await tx.selectFrom("notifications").select((eb) => eb.fn.countAll<string>().as("n")).where("user_id", "=", session.userId).where("read_at", "is", null).executeTakeFirstOrThrow()).n));
  return (
    <div className="flex min-h-dvh max-md:flex-col">
      <Sidebar companyName={session.companyName} userName={session.fullName} role={session.role} signOut={signOutAction} unread={unread} />
      <main className="min-w-0 flex-1 px-8 pt-7 pb-10 max-lg:px-6 max-md:p-4 has-[[data-project-page]]:p-0">{children}</main>
    </div>
  );
}

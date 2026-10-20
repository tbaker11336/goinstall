import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-[60dvh] flex-col items-center justify-center gap-3 p-6 text-center">
      <h1 className="text-xl font-semibold">Page not found</h1>
      <p className="text-sm text-muted-foreground">It may have been deleted, or it belongs to a different company account.</p>
      <Link href="/dashboard" className="text-sm text-primary hover:underline">
        Back to the dashboard
      </Link>
    </main>
  );
}

import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { signOutAction } from "../actions";

export const metadata = { title: "Use the installer app" };

export default function NoAccessPage() {
  return (
    <Card>
      <CardContent className="grid gap-4 p-6">
        <h1 className="text-lg font-semibold">Use the installer app</h1>
        <p className="text-sm text-muted-foreground">
          Your account is set up for field work. Sign in to the GoInstall installer app on your phone to see your jobs.
        </p>
        <a href="/app" className={buttonVariants({ className: "w-full" })}>
          Open the installer app
        </a>
        <form action={signOutAction}>
          <Button type="submit" variant="outline" className="w-full">
            Sign out
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

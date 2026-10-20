import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "GoInstall", template: "%s · GoInstall" },
  description: "Solar, battery and EV charger installation, from enquiry to handover.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB">
      <body>{children}</body>
    </html>
  );
}

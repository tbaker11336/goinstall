import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "GoInstall", template: "%s · GoInstall" },
  description: "Solar, battery and EV charger installation, from enquiry to handover.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font -- loaded at runtime so builds don't depend on Google Fonts */}
        <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />
      </head>
      <body>{children}</body>
    </html>
  );
}

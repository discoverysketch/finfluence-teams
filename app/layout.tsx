import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FinFluency Teams",
  description: "Finance fluency + territory intelligence for sales teams.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

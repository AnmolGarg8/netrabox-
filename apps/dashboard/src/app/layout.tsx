import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "NetraBox — Flight Recorder & Dispute Tribunal",
  description: "Flight recorder and autonomous dispute tribunal for AI-agent purchases with PayPal",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-950 text-slate-100 antialiased">{children}</body>
    </html>
  );
}

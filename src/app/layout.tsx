import type { Metadata } from "next";
import Image from "next/image";
import "./globals.css";

export const metadata: Metadata = {
  title: "Month End Close Cockpit",
  description: "Interactive month-end checklist and close cockpit",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        <header className="border-b border-white/10 bg-[color:var(--jam-navy)]">
          <div className="jam-container flex items-center justify-start py-3">
            <Image
              src="/jamieson-logo.png"
              alt="Jamieson"
              width={180}
              height={40}
              priority
            />
          </div>
        </header>
        <main className="jam-container py-10">{children}</main>
      </body>
    </html>
  );
}

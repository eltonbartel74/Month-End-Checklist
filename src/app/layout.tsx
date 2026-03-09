import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
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
          <div className="jam-container flex items-center justify-center py-3">
            <Link href="/" aria-label="Home">
              <Image
                src="/jamieson-logo.png"
                alt="Jamieson"
                width={180}
                height={40}
                priority
              />
            </Link>
          </div>
        </header>
        <main className="jam-container py-10">{children}</main>
      </body>
    </html>
  );
}

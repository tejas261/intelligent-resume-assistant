import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Resume Assistant",
  description: "AI-powered resume analysis and candidate evaluation",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased" suppressHydrationWarning>
      <body className="h-full overflow-hidden flex flex-col bg-(--color-background) text-(--color-foreground)">{children}</body>
    </html>
  );
}

import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Evolve Academy | Superhairpieces",
  description:
    "Professional hair replacement training by Superhairpieces. Access your Evolve Academy courses.",
  icons: {
    // SVG first so the mark stays crisp at any size and can flip to white on
    // dark browser chrome; the PNG covers clients that ignore SVG favicons.
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/favicon-32.png", type: "image/png", sizes: "32x32" },
      { url: "/icon-192.png", type: "image/png", sizes: "192x192" },
    ],
    apple: "/apple-touch-icon.png",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}

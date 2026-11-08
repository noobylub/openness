import type { Metadata } from "next";
import "@fontsource/dm-sans/400.css";
import "@fontsource/dm-sans/500.css";
import "@fontsource/dm-sans/600.css";
import "@fontsource/space-grotesk/500.css";
import "@fontsource/space-grotesk/600.css";
import { StudioHeader } from "@/components/StudioHeader";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Larasati | A different direction",
    template: "%s | Larasati",
  },
  description: "A creative workspace for language model steering.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#workspace">
          Skip to workspace
        </a>
        <StudioHeader />
        <div id="workspace">{children}</div>
      </body>
    </html>
  );
}

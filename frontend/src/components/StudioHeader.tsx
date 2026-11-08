"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AudioLines, FlaskConical, MessageCircle } from "lucide-react";

export function StudioHeader() {
  const path = usePathname();
  return (
    <header className="studio-header">
      <Link href="/" className="brand" aria-label="Larasati home">
        <span className="brand-mark">
          <AudioLines size={22} strokeWidth={1.5} />
        </span>
        larasati<span className="brand-period">.</span>
      </Link>
      <nav aria-label="Main navigation">
        <Link
          href="/"
          className={path === "/" ? "current" : ""}
          aria-current={path === "/" ? "page" : undefined}
        >
          <MessageCircle size={16} strokeWidth={1.5} />
          Conversation
        </Link>
        <Link
          href="/extract"
          className={path === "/extract" ? "current" : ""}
          aria-current={path === "/extract" ? "page" : undefined}
        >
          <FlaskConical size={16} strokeWidth={1.5} />
          Extraction
        </Link>
      </nav>
      <span className="header-caption">
        LANGUAGE, IN A NEW DIRECTION
        <span className="caption-dot" />
      </span>
    </header>
  );
}

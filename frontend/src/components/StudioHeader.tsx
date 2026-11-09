"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowUpRight,
  AudioLines,
  ChevronDown,
  FlaskConical,
  MessageCircle,
} from "lucide-react";

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
      <details className="source-menu">
        <summary>
          Source
          <ChevronDown size={14} />
        </summary>
        <div className="source-menu-items">
          <a
            href="https://github.com/noobylub/openness/tree/master"
            target="_blank"
            rel="noreferrer"
          >
            Frontend
            <ArrowUpRight size={14} />
          </a>
          <a
            href="https://github.com/noobylub/touch-grass/blob/main/README.md"
            target="_blank"
            rel="noreferrer"
          >
            Backend
            <ArrowUpRight size={14} />
          </a>
        </div>
      </details>
    </header>
  );
}

"use client";

import { type ReactNode, useEffect, useState } from "react";
import { ArrowUp } from "lucide-react";

export interface LayoutProps {
  children: ReactNode;
}

/**
 * 全域 Layout 與無障礙（a11y）
 * 提供 Skip anchor、主要內容容器、回到頂部與 Lightbox portal
 */
export function Layout({ children }: LayoutProps) {
  const [showTopBtn, setShowTopBtn] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setShowTopBtn(window.scrollY > 300);
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div className="relative min-h-screen flex flex-col">
      {/* a11y Skip Anchor */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-white focus:shadow-md"
      >
        跳至主要內容
      </a>

      {/* Main Content */}
      <main id="main-content" className="flex-1 w-full">
        {children}
      </main>

      {/* Back to top button */}
      {showTopBtn && (
        <button
          type="button"
          onClick={scrollToTop}
          className="fixed bottom-6 right-6 z-40 grid h-10 w-10 place-items-center rounded-full bg-primary text-white shadow-md transition-colors hover:bg-primary-hover focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
          aria-label="回到頂部"
        >
          <ArrowUp size={18} />
        </button>
      )}

      {/* Lightbox portal target */}
      <div id="lightbox-portal" />
    </div>
  );
}

export default Layout;

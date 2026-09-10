"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { nav, site } from "@/lib/site";

export default function Header() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    let last = -1;
    const onScroll = () => {
      const y = window.scrollY;
      if (y === last) return;
      last = y;
      setScrolled(y > 8);
    };
    onScroll();
    document.addEventListener("scroll", onScroll, { passive: true });
    return () => document.removeEventListener("scroll", onScroll);
  }, []);

  // Close the mobile menu whenever the route changes.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <header className={`site-header${scrolled ? " scrolled" : ""}`}>
      <div className="tricolour-rule" />
      <nav className="nav">
        <Link href="/" className="brand" aria-label={`${site.name} home`}>
          <Image
            src="/logo.jpeg"
            alt=""
            width={46}
            height={46}
            priority
          />
          <span>
            Next Level
            <br />
            <small>FAMILY RESTAURANT</small>
          </span>
        </Link>

        <ul className={`nav-links${open ? " open" : ""}`} id="navLinks">
          {nav.map((item) => {
            const active =
              item.href === "/"
                ? pathname === "/"
                : pathname.startsWith(item.href);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                >
                  {item.label}
                </Link>
              </li>
            );
          })}
          <li className="nav-book">
            <Link href="/contact#reserve" className="nav-cta">
              Book a Table
            </Link>
          </li>
          <li className="nav-preorder">
            <Link href="/menu" className="nav-order">
              Pre-Order
              <span className="nav-order-tag">50% advance</span>
            </Link>
          </li>
        </ul>

        <button
          className={`nav-toggle${open ? " open" : ""}`}
          aria-label="Toggle menu"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <span />
          <span />
          <span />
        </button>
      </nav>
    </header>
  );
}

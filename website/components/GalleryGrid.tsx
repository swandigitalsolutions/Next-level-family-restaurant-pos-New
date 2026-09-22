"use client";

import Image from "next/image";
import { useCallback, useEffect, useState } from "react";
import { galleryImages } from "@/lib/images";

export default function GalleryGrid() {
  const [index, setIndex] = useState<number | null>(null);
  const open = index !== null;

  const show = useCallback(
    (i: number) => setIndex((i + galleryImages.length) % galleryImages.length),
    []
  );
  const close = useCallback(() => setIndex(null), []);

  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if (e.key === "ArrowRight") setIndex((v) => (v! + 1) % galleryImages.length);
      if (e.key === "ArrowLeft")
        setIndex((v) => (v! - 1 + galleryImages.length) % galleryImages.length);
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  const current = open ? galleryImages[index!] : null;

  return (
    <>
      <div className="gallery-grid">
        {galleryImages.map((p, i) => (
          <button
            key={p.src}
            className={p.span}
            aria-label={`View photo ${i + 1}: ${p.alt}`}
            onClick={() => show(i)}
          >
            <Image
              src={p.src}
              alt={p.alt}
              fill
              sizes="(max-width: 860px) 50vw, 25vw"
              style={{ objectFit: "cover" }}
            />
          </button>
        ))}
      </div>

      <div
        className={`lightbox${open ? " open" : ""}`}
        onClick={(e) => {
          if (e.target === e.currentTarget) close();
        }}
      >
        <button className="close" aria-label="Close" onClick={close}>
          &#10005;
        </button>
        <button
          className="nav prev"
          aria-label="Previous image"
          onClick={() => setIndex((v) => (v! - 1 + galleryImages.length) % galleryImages.length)}
        >
          &#8249;
        </button>
        {current && (
          <figure className="lightbox-figure">
            {/* Plain img: the lightbox shows the full-size photo and
                sizing is driven by max-height, not layout. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={current.src} alt={current.alt} />
            <figcaption className="lightbox-cap">{current.alt}</figcaption>
          </figure>
        )}
        <button
          className="nav next"
          aria-label="Next image"
          onClick={() => setIndex((v) => (v! + 1) % galleryImages.length)}
        >
          &#8250;
        </button>
      </div>
    </>
  );
}

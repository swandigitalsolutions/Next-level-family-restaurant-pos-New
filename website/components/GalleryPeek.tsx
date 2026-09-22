import Image from "next/image";
import Link from "next/link";
import { galleryImages } from "@/lib/images";

export default function GalleryPeek() {
  return (
    <div className="peek">
      {galleryImages.slice(0, 6).map((p) => (
        <Link key={p.src} href="/gallery" aria-label={`Gallery: ${p.alt}`}>
          <Image
            src={p.src}
            alt={p.alt}
            fill
            sizes="(max-width: 780px) 33vw, 180px"
            style={{ objectFit: "cover" }}
          />
        </Link>
      ))}
    </div>
  );
}

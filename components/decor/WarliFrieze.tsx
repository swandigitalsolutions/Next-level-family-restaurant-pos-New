/* Hand-drawn Warli-style frieze — a row of tarpa dancers holding
   hands, with a tree and sun. Tiles horizontally. Used as a section
   divider and accent throughout the site, echoing the painted walls
   of the real dhaba. Decorative only. */

export default function WarliFrieze({
  className = "",
  tone = "ink",
  height = 46,
}: {
  className?: string;
  tone?: "ink" | "cream" | "cardinal" | "marigold";
  height?: number;
}) {
  const color =
    tone === "cream"
      ? "var(--cream)"
      : tone === "cardinal"
      ? "var(--cardinal)"
      : tone === "marigold"
      ? "var(--marigold)"
      : "var(--ink)";

  return (
    <div
      className={`warli-frieze ${className}`}
      style={{ height, color }}
      aria-hidden="true"
    >
      <svg
        width="100%"
        height={height}
        viewBox="0 0 240 46"
        preserveAspectRatio="xMidYMid meet"
        role="presentation"
      >
        <defs>
          <pattern
            id="warli-dancers"
            x="0"
            y="0"
            width="120"
            height="46"
            patternUnits="userSpaceOnUse"
          >
            <g
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              {/* ground line */}
              <path d="M0 40 H120" strokeWidth="1" opacity="0.5" />

              {/* sun */}
              <circle cx="16" cy="9" r="3.4" />
              <path d="M16 2.5v-2M16 17.5v-2M9 9h-2M25 9h2M11 4l-1.4-1.4M22.4 15.4 21 14M21 4l1.4-1.4M9.6 15.4 11 14" />

              {/* tree */}
              <path d="M60 40V16" />
              <path d="M60 24c-4-3-6-8-6-8M60 24c4-3 6-8 6-8M60 30c-5-3-8-9-8-9M60 30c5-3 8-9 8-9" />

              {/* four dancers holding hands (two triangles = torso) */}
              {[6, 34, 78, 106].map((x, i) => (
                <g key={i} transform={`translate(${x} 0)`}>
                  <circle cx="0" cy="14" r="2.6" fill="currentColor" stroke="none" />
                  {/* torso: hourglass of two triangles */}
                  <path d="M0 17 L-4 25 L4 25 Z" fill="currentColor" stroke="none" />
                  <path d="M0 33 L-4 25 L4 25 Z" fill="currentColor" stroke="none" />
                  {/* legs */}
                  <path d="M0 33 L-4 40 M0 33 L4 40" />
                  {/* arms reaching to neighbours */}
                  <path d="M0 21 L-11 17 M0 21 L11 17" />
                </g>
              ))}
            </g>
          </pattern>
        </defs>
        <rect width="240" height="46" fill="url(#warli-dancers)" />
      </svg>
    </div>
  );
}

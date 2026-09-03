/* A marigold string (toran) — the flower garland strung across
   doorways at Indian homes and restaurants. Decorative divider. */

export default function Garland({ className = "" }: { className?: string }) {
  const flowers = Array.from({ length: 28 });
  return (
    <div className={`garland ${className}`} aria-hidden="true">
      <svg
        width="100%"
        height="34"
        viewBox="0 0 560 34"
        preserveAspectRatio="none"
        role="presentation"
      >
        {/* the swag string */}
        <path
          d="M0 4 Q280 40 560 4"
          fill="none"
          stroke="var(--basil)"
          strokeWidth="1.5"
        />
        {flowers.map((_, i) => {
          const t = i / (flowers.length - 1);
          const x = t * 560;
          // parabola matching the string
          const y = 4 + 36 * (4 * t * (1 - t)) * 0.5;
          const r = 4 + (i % 3);
          const marigold = i % 2 === 0;
          return (
            <g key={i} transform={`translate(${x} ${y + 6})`}>
              <line x1="0" y1="-6" x2="0" y2="0" stroke="var(--basil)" strokeWidth="1" />
              <circle
                r={r}
                fill={marigold ? "var(--marigold)" : "var(--cardinal)"}
              />
              <circle r={r * 0.45} fill={marigold ? "var(--cardinal-deep)" : "var(--sunflower)"} />
            </g>
          );
        })}
      </svg>
    </div>
  );
}

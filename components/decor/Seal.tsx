/* A round "ink stamp" seal — like a hand-carved rubber stamp pressed
   on paper. Used for trust marks ("Family run since…", "Pure ghee").  */

export default function Seal({
  top,
  big,
  bottom,
  className = "",
}: {
  top: string;
  big: string;
  bottom: string;
  className?: string;
}) {
  return (
    <div className={`seal ${className}`} aria-hidden="false">
      <svg viewBox="0 0 120 120" width="112" height="112" role="img" aria-label={`${top} ${big} ${bottom}`}>
        <defs>
          <path id="seal-top" d="M60 60 m-42 0 a42 42 0 0 1 84 0" fill="none" />
          <path id="seal-bottom" d="M60 60 m-44 0 a44 44 0 0 0 88 0" fill="none" />
        </defs>
        <circle cx="60" cy="60" r="54" fill="none" stroke="currentColor" strokeWidth="2" />
        <circle cx="60" cy="60" r="47" fill="none" stroke="currentColor" strokeWidth="1" strokeDasharray="2 3" />
        <text fontSize="10" fontWeight="700" letterSpacing="2" fill="currentColor">
          <textPath href="#seal-top" startOffset="50%" textAnchor="middle">
            {top.toUpperCase()}
          </textPath>
        </text>
        <text fontSize="10" fontWeight="700" letterSpacing="2" fill="currentColor">
          <textPath href="#seal-bottom" startOffset="50%" textAnchor="middle">
            {bottom.toUpperCase()}
          </textPath>
        </text>
        <text
          x="60"
          y="60"
          textAnchor="middle"
          dominantBaseline="central"
          fontFamily="var(--font-display)"
          fontSize="17"
          fontStyle="italic"
          fontWeight="600"
          fill="currentColor"
        >
          {big}
        </text>
      </svg>
    </div>
  );
}

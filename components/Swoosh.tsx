/* The ribbon swoosh — echoes the banner under the wordmark on the
   restaurant's logo board. Decorative only. */
export default function Swoosh({ className = "" }: { className?: string }) {
  return (
    <svg
      className={`swoosh ${className}`}
      viewBox="0 0 150 14"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M2 8c20-10 40 10 60 0s40-10 60 0"
        strokeWidth="4"
        strokeLinecap="round"
      />
    </svg>
  );
}

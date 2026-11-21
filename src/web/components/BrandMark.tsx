export type BrandMarkProps = {
  size?: number;
  className?: string;
  label?: string;
};

export function BrandWordmark() {
  const e =
    "M20 7c4.8 0 7.8 3.2 7.8 8v1.5H16.3c.6 2 2.3 3.1 4.6 3.1 1.6 0 3.1-.6 4.3-1.6l2.1 2.8a10 10 0 0 1-6.6 2.3c-5.4 0-9-3.3-9-8.1 0-4.6 3.4-8 8.3-8Zm-3.7 6.4h7.3c-.4-1.9-1.7-3-3.6-3s-3.2 1.1-3.7 3Z";
  const t =
    "M30.8 7.5v-3l4.4-2.2v5.2h5v3.6h-5v6.2c0 1.3.7 2 2 2 .9 0 1.7-.3 2.4-.8l1.2 3.2a7.6 7.6 0 0 1-4.2 1.4c-3.8 0-5.8-1.9-5.8-5.5v-6.5h-2V7.5Z";
  return (
    <svg
      className="brand-wordmark"
      viewBox="0 0 99 28"
      role="img"
      aria-label="jetyet"
      focusable="false"
    >
      <g transform="matrix(1 0 -.20 1 5.6 0)" fill="currentColor">
        <path d="M5.8 2.1h4.5v3.7H5.8Zm0 5.4h4.5v13.1c0 4.3-2.5 6.8-6.6 6.8H1v-3.8h2.4c1.6 0 2.4-1 2.4-2.9Z" />
        <path fillRule="evenodd" d={e} />
        <path d={t} />
        <path d="M41.5 7.5h4.7l3.7 9.8 4.2-9.8h4.5L52 22.9c-1.3 3-3 4.5-6.2 4.5h-2v-3.7h1.5c1.2 0 2-.7 2.5-2Z" />
        <path fillRule="evenodd" d={e} transform="translate(47)" />
        <path d={t} transform="translate(47)" />
        <path className="brand-wordmark-accent" d="M90 17.7h5.4v5H90Z" />
      </g>
    </svg>
  );
}

/**
 * Approved Jetyet rocket brand mark in the brand accent (`--accent`).
 */
export function BrandMark({
  size = 20,
  className = "",
  label,
}: BrandMarkProps) {
  const labeled = Boolean(label);
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="var(--accent, #b074d1)"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={["brand-mark", className].filter(Boolean).join(" ")}
      role={labeled ? "img" : undefined}
      aria-label={labeled ? label : undefined}
      aria-hidden={labeled ? undefined : "true"}
      focusable="false"
    >
      {labeled && <title>{label}</title>}
      <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
      <path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
      <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" />
      <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
    </svg>
  );
}

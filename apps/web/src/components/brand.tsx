import Link from "next/link";

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/" className="brand" aria-label="DoNext home">
      <span className="brand-mark" aria-hidden="true">
        <span />
      </span>
      {!compact && <span>DoNext</span>}
    </Link>
  );
}

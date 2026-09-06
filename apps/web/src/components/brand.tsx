import Link from "next/link";

export function Brand({ compact = false, href = "/today" }: { compact?: boolean; href?: string }) {
  return (
    <Link href={href} className="brand" aria-label="DoNext home">
      <span className="brand-mark" aria-hidden="true">
        <span />
      </span>
      {!compact && <span>DoNext</span>}
    </Link>
  );
}

import Link from "next/link";
import { cn } from "@/lib/utils";

export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden className={cn("size-8 shrink-0", className)}>
      <rect width="64" height="64" rx="14" fill="#1f3a5f" />
      <rect x="10" y="20" width="44" height="18" rx="4" fill="#142a47" />
      <rect x="14" y="23" width="8" height="12" rx="2" fill="#2b4a74" />
      <rect x="24" y="23" width="8" height="12" rx="2" fill="#2b4a74" />
      <rect x="34" y="23" width="8" height="12" rx="2" fill="#2b4a74" />
      <rect x="44" y="23" width="7" height="12" rx="2" fill="#8d2a22" />
      <path d="M33 42l-7 12h6l-2 8 9-13h-6l3-7z" fill="#f2b705" />
    </svg>
  );
}

export function Brand({ href = "/", inverted }: { href?: string; inverted?: boolean }) {
  return (
    <Link href={href} className={cn("flex items-center gap-2.5 font-display text-lg font-bold leading-none", inverted && "text-white")}>
      <BrandMark className={inverted ? "rounded-[9px] ring-2 ring-white/70" : undefined} />
      <span>Електрооблік</span>
    </Link>
  );
}

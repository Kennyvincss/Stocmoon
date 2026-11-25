import { cn } from "@/lib/utils";

/** StocMoon mark: a half-lit disc — one side up, one side down. */
export function Logo({ className, withText = true }: { className?: string; withText?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2 font-semibold tracking-tight", className)}>
      <svg viewBox="0 0 32 32" className="h-7 w-7" aria-hidden>
        <circle cx="16" cy="16" r="14" fill="currentColor" opacity="0.18" />
        <path d="M16 2a14 14 0 0 1 0 28z" fill="currentColor" />
        <path d="M9 18l3-4 3 3" stroke="var(--up)" strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {withText && <span className="text-lg">StocMoon</span>}
    </span>
  );
}

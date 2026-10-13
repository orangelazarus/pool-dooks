import { cn } from "@/lib/utils";

/**
 * The Pool Dooks mark: a swimmer heading straight for a poop.
 *
 * Every major emoji font draws the swimmer facing left, so it is mirrored to
 * swim rightwards, into the poop that follows it.
 */
export function Logo({ className }: { className?: string }) {
  return (
    <span role="img" aria-label="Pool Dooks" className={cn("inline-flex items-center leading-none select-none", className)}>
      <span aria-hidden className="inline-block -scale-x-100">🏊</span>
      <span aria-hidden className="-ml-[0.12em]">💩</span>
    </span>
  );
}

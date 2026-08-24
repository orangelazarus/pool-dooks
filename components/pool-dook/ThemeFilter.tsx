"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";

const THEME_LABELS: Record<string, string> = {
  everyday_life: "Everyday Life",
  entertainment: "Entertainment",
  sports: "Sports",
  sci_fi: "Sci-Fi",
  fantasy: "Fantasy",
  food: "Food",
  travel: "Travel",
  custom: "Custom",
};

interface ThemeFilterProps {
  themes: readonly string[];
  active?: string;
}

export function ThemeFilter({ themes, active }: ThemeFilterProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const buildHref = (theme?: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (theme) params.set("theme", theme);
    else params.delete("theme");
    return `${pathname}?${params.toString()}`;
  };

  return (
    <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none -mx-4 px-4">
      <Link
        href={buildHref()}
        className={cn(
          "shrink-0 px-3 py-1.5 rounded-full text-sm font-medium transition-colors border",
          !active
            ? "bg-foreground text-background border-foreground"
            : "bg-background text-muted-foreground border-border hover:bg-muted"
        )}
      >
        All
      </Link>
      {themes.map((theme) => (
        <Link
          key={theme}
          href={buildHref(theme)}
          className={cn(
            "shrink-0 px-3 py-1.5 rounded-full text-sm font-medium transition-colors border",
            active === theme
              ? "bg-foreground text-background border-foreground"
              : "bg-background text-muted-foreground border-border hover:bg-muted"
          )}
        >
          {THEME_LABELS[theme] ?? theme}
        </Link>
      ))}
    </div>
  );
}

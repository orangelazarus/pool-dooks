import { Badge } from "@/components/ui/badge";

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

const THEME_COLORS: Record<string, string> = {
  everyday_life: "bg-green-100 text-green-800 hover:bg-green-100",
  entertainment: "bg-pink-100 text-pink-800 hover:bg-pink-100",
  sports: "bg-orange-100 text-orange-800 hover:bg-orange-100",
  sci_fi: "bg-blue-100 text-blue-800 hover:bg-blue-100",
  fantasy: "bg-purple-100 text-purple-800 hover:bg-purple-100",
  food: "bg-yellow-100 text-yellow-800 hover:bg-yellow-100",
  travel: "bg-teal-100 text-teal-800 hover:bg-teal-100",
  custom: "bg-gray-100 text-gray-800 hover:bg-gray-100",
};

export function ThemeBadge({ theme }: { theme: string }) {
  return (
    <Badge
      variant="secondary"
      className={`text-xs ${THEME_COLORS[theme] ?? THEME_COLORS.custom}`}
    >
      {THEME_LABELS[theme] ?? theme}
    </Badge>
  );
}

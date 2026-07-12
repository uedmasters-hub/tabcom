import { RefreshCw } from "lucide-react";
import { useState } from "react";
import { cn } from "../../lib/cn";
import { generateCommunityNameSuggestions } from "../../lib/community-name-suggestions";

interface NameCloudProps {
  onSelect: (name: string) => void;
  selected?: string;
  className?: string;
}

// Word-cloud aesthetic: a handful of size/weight tiers so the cloud
// has visual variety instead of every chip being identical — cycled
// through by index rather than randomized, so the layout doesn't
// jitter between renders of the SAME suggestion set.
const SIZE_TIERS = [
  "text-base font-bold",
  "text-sm font-semibold",
  "text-xs font-medium",
];

/**
 * Tap-to-select community name suggestions, word-cloud style. Chips
 * regenerate on demand (no input needed to get a fresh batch) — this
 * is meant to be a fast, no-typing shortcut, not a search.
 */
export default function NameCloud({ onSelect, selected, className }: NameCloudProps) {
  const [suggestions, setSuggestions] = useState(() => generateCommunityNameSuggestions());

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-2 px-2 py-1">
        {suggestions.map((suggestion, i) => {
          const isSelected = suggestion === selected;
          return (
            <button
              key={suggestion}
              type="button"
              onClick={() => onSelect(suggestion)}
              className={cn(
                "rounded-full px-3 py-1 transition",
                SIZE_TIERS[i % SIZE_TIERS.length],
                isSelected
                  ? "bg-slate-900 text-white"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
              )}
            >
              {suggestion}
            </button>
          );
        })}
      </div>

      <button
        type="button"
        onClick={() => setSuggestions(generateCommunityNameSuggestions())}
        className="mx-auto flex items-center gap-1 text-xs font-medium text-slate-400 transition hover:text-slate-600"
      >
        <RefreshCw size={12} />
        Shuffle suggestions
      </button>
    </div>
  );
}

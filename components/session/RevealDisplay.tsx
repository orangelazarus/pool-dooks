"use client";
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Badge } from "@/components/ui/badge";
import { TOKEN_COLORS } from "@/components/editor/BlankNode";

interface AnswerMeta {
  tokenId: string;
  label: string;
  type: string;
  value: string;
  player: string;
}

interface RevealDisplayProps {
  title: string;
  theme: string;
  resultText: string;
  answersWithMeta: AnswerMeta[];
}

export function RevealDisplay({ title, resultText, answersWithMeta }: RevealDisplayProps) {
  const [visibleCount, setVisibleCount] = useState(0);

  // Animate the story appearing word by word
  const words = resultText.split(/(\s+)/);

  useEffect(() => {
    if (visibleCount >= answersWithMeta.length) return;
    const t = setTimeout(() => setVisibleCount((v) => v + 1), 300);
    return () => clearTimeout(t);
  }, [visibleCount, answersWithMeta.length]);

  // Parse resultText to highlight the filled blanks
  const parts = resultText.split(/(\*\*[^*]+\*\*)/g);

  return (
    <div className="space-y-8">
      <div className="text-center">
        <h2 className="text-2xl font-bold mb-2">{title}</h2>
        <Badge variant="secondary">The full story!</Badge>
      </div>

      {/* Story with highlighted blanks */}
      <div className="border rounded-xl p-6 bg-card text-base leading-relaxed">
        {parts.map((part, i) => {
          if (part.startsWith("**") && part.endsWith("**")) {
            const value = part.slice(2, -2);
            return (
              <motion.span
                key={i}
                initial={{ opacity: 0, y: -4, scale: 0.9 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                className="inline-block mx-0.5 px-2 py-0.5 bg-yellow-200 text-yellow-900 rounded font-bold border border-yellow-300"
              >
                {value}
              </motion.span>
            );
          }
          return <span key={i}>{part}</span>;
        })}
      </div>

      {/* Answer attribution */}
      {answersWithMeta.length > 0 && (
        <div>
          <h3 className="font-semibold mb-3 text-sm text-muted-foreground uppercase tracking-wide">
            Who filled what
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {answersWithMeta.map((a, i) => (
              <motion.div
                key={`${a.tokenId}-${i}`}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                className="flex items-center gap-2 p-2.5 border rounded-lg bg-muted/30"
              >
                <span
                  className={`px-2 py-0.5 rounded-full text-xs font-medium border shrink-0 ${
                    TOKEN_COLORS[a.type] ?? TOKEN_COLORS.custom
                  }`}
                >
                  {a.label}
                </span>
                <span className="font-medium text-sm flex-1 truncate">&ldquo;{a.value}&rdquo;</span>
                <span className="text-xs text-muted-foreground shrink-0">@{a.player}</span>
              </motion.div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

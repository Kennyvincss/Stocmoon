"use client";

import { useState } from "react";
import { Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { publicEnv } from "@/lib/public-env";

/** Shares a link to the market page (its OG image is the generated share card). */
export function ShareButton({ marketId, side, text, className }: { marketId: number; side?: string; text?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const url = `${publicEnv.appUrl}/m/${marketId}${side ? `?side=${encodeURIComponent(side)}` : ""}`;
  const message = text ?? (side ? `I'm calling ${side} on StocMoon market #${marketId}` : `StocMoon market #${marketId}`);

  async function share() {
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ title: "StocMoon", text: message, url });
        return;
      } catch {
        /* fall back to copy */
      }
    }
    await navigator.clipboard.writeText(`${message} ${url}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  return (
    <Button variant="subtle" size="sm" onClick={share} className={className}>
      <Share2 className="h-4 w-4" /> {copied ? "Link copied" : "Share"}
    </Button>
  );
}

export function shareToXUrl(text: string, url: string) {
  return `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
}

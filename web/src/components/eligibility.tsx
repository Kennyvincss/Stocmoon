"use client";

import { useState } from "react";
import { useAccount, useSignMessage } from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import { ELIGIBILITY_MESSAGE } from "@stocmoon/core";
import { useEligibility } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/common";
import Link from "next/link";

const LOCAL_KEY = (a: string) => `stocmoon-attested-${a.toLowerCase()}`;

/**
 * Trading access: jurisdiction (server geo check) + signed self-attestation + (optional) onchain allowlist.
 * Exits (sell, redeem, withdraw) are never gated.
 */
export function useTradingAccess() {
  const { address } = useAccount();
  const q = useEligibility(address);
  const localAttested = typeof window !== "undefined" && address ? localStorage.getItem(LOCAL_KEY(address)) === "1" : false;
  const e = q.data;
  const attested = Boolean(e?.attested || localAttested);
  const onchainOk = !e?.eligibilityRequired || e.onchainEligible === true;
  return {
    loading: q.isLoading,
    blocked: e?.blocked ?? false,
    reason: e?.reason ?? null,
    attested,
    onchainOk,
    canTrade: Boolean(address && e && !e.blocked && attested && onchainOk),
    eligibility: e,
  };
}

export function EligibilityGate({ compact = false }: { compact?: boolean }) {
  const { address } = useAccount();
  const access = useTradingAccess();
  const { signMessageAsync } = useSignMessage();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!address || access.loading || access.canTrade) return null;
  if (access.blocked) {
    return <Notice tone="down">{access.reason} You can still browse markets. <Link href="/legal/terms" className="underline">Why?</Link></Notice>;
  }
  if (access.attested && !access.onchainOk) {
    return <Notice>Your eligibility is being registered onchain. This can take a few seconds…</Notice>;
  }

  async function attest() {
    if (!address) return;
    setBusy(true);
    setError(null);
    try {
      const nonce = crypto.randomUUID();
      const issuedAt = new Date().toISOString();
      const country = access.eligibility?.country ?? "unknown";
      const signature = await signMessageAsync({ message: ELIGIBILITY_MESSAGE(address, country, nonce, issuedAt) });
      const r = await fetch("/api/eligibility", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ address, signature, nonce, issuedAt }),
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error ?? "Attestation failed");
      localStorage.setItem(LOCAL_KEY(address), "1");
      await qc.invalidateQueries({ queryKey: ["eligibility"] });
    } catch (e) {
      setError((e as Error).message.includes("rejected") ? "Signature rejected" : (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2 rounded-xl bg-surface-2 p-3">
      <div className="flex items-start gap-2 text-sm">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
        <span className="text-muted">
          {compact ? "Confirm eligibility to trade." : "Before your first trade, confirm you're eligible (not a US person, 18+, accept the Terms). It's a free signature, not a transaction."}
        </span>
      </div>
      <Button onClick={attest} disabled={busy} size="sm" className="w-full">{busy ? "Waiting for signature…" : "Confirm eligibility"}</Button>
      {error && <div className="text-xs text-down">{error}</div>}
    </div>
  );
}

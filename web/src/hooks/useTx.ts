"use client";

import { useCallback, useState } from "react";
import { useConfig } from "wagmi";
import { simulateContract, waitForTransactionReceipt, writeContract } from "wagmi/actions";
import { BaseError, ContractFunctionRevertedError, type Abi, type Hash } from "viem";
import { useQueryClient } from "@tanstack/react-query";

export type TxStatus = "idle" | "simulating" | "signing" | "pending" | "success" | "error";

export interface TxState {
  status: TxStatus;
  hash?: Hash;
  error?: string;
}

function describe(e: unknown): string {
  if (e instanceof BaseError) {
    const revert = e.walk((x) => x instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null;
    if (revert?.data?.errorName) return `Reverted: ${revert.data.errorName}`;
    if (/User rejected|denied/i.test(e.shortMessage)) return "Transaction rejected in wallet";
    return e.shortMessage;
  }
  return (e as Error)?.message ?? "Unknown error";
}

/**
 * Simulate -> sign -> wait for receipt. Success is reported ONLY after the receipt confirms `status: success`.
 */
export function useTx() {
  const config = useConfig();
  const qc = useQueryClient();
  const [state, setState] = useState<TxState>({ status: "idle" });

  const send = useCallback(
    async (req: { address: `0x${string}`; abi: Abi; functionName: string; args?: readonly unknown[] }) => {
      try {
        setState({ status: "simulating" });
        const sim = await simulateContract(config, req as never);
        setState({ status: "signing" });
        const hash = await writeContract(config, sim.request as never);
        setState({ status: "pending", hash });
        const receipt = await waitForTransactionReceipt(config, { hash, confirmations: 1 });
        if (receipt.status !== "success") {
          setState({ status: "error", hash, error: "Transaction reverted onchain" });
          return null;
        }
        setState({ status: "success", hash });
        await qc.invalidateQueries();
        return receipt;
      } catch (e) {
        setState((s) => ({ status: "error", hash: s.hash, error: describe(e) }));
        return null;
      }
    },
    [config, qc],
  );

  const reset = useCallback(() => setState({ status: "idle" }), []);
  return { ...state, send, reset, busy: ["simulating", "signing", "pending"].includes(state.status) };
}

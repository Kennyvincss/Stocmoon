import { encodeEventTopics, parseEventLogs, type AbiEvent, type Address, type Log } from "viem";
import { getContractLogs } from "@stocmoon/core";
import { publicEnv } from "../public-env";
import { chainClient } from "./chain";
import { serverEnv } from "./env";

/**
 * Decoded events of one type emitted by the markets contract since deployment (explorer API first — public RPCs cap
 * eth_getLogs to tiny ranges). `args` filters indexed parameters.
 */
export async function marketEvents<const E extends AbiEvent>(event: E, args?: Record<string, unknown>) {
  if (!publicEnv.markets) return [];
  const client = chainClient();
  const topics = (encodeEventTopics as (p: unknown) => (`0x${string}` | null)[])({ abi: [event], eventName: event.name, args });
  const logs = await getContractLogs({
    client, chainId: publicEnv.chainId, address: publicEnv.markets as Address,
    fromBlock: serverEnv.deployBlock, toBlock: await client.getBlockNumber(), topics, logsApi: process.env.LOGS_API_URL,
  });
  return parseEventLogs({ abi: [event], logs: logs as Log[] });
}

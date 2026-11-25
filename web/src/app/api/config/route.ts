import { protocolConfig } from "@/lib/server/markets";
import { json } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return json(await protocolConfig(), { maxAge: 30 });
  } catch (e) {
    return json({ configured: false, error: (e as Error).message.slice(0, 200) }, { status: 502 });
  }
}

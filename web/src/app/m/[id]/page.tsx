import type { Metadata } from "next";
import { MarketDetail } from "./market-detail";

export async function generateMetadata({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ side?: string }> }): Promise<Metadata> {
  const { id } = await params;
  const { side } = await searchParams;
  const img = `/api/og/market/${encodeURIComponent(id)}${side ? `?side=${encodeURIComponent(side)}` : ""}`;
  return {
    title: `Market #${id}`,
    openGraph: { images: [img] },
    twitter: { card: "summary_large_image", images: [img] },
  };
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <MarketDetail id={Number(id)} />;
}

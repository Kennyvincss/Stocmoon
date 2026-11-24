export function LegalPage({ title, updated, children }: { title: string; updated: string; children: React.ReactNode }) {
  return (
    <article className="mx-auto max-w-3xl space-y-5 leading-relaxed text-muted [&_h2]:mt-8 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-text [&_li]:ml-5 [&_li]:list-disc">
      <h1 className="text-3xl font-semibold tracking-tight text-text">{title}</h1>
      <p className="text-xs">Last updated {updated}. Draft for a hackathon testnet deployment — not reviewed by counsel. Real-money operation requires legal and compliance review.</p>
      {children}
    </article>
  );
}

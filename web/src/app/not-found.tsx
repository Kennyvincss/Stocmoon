import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex flex-col items-center gap-3 py-24 text-center">
      <div className="text-5xl font-semibold">404</div>
      <p className="text-muted">This page drifted out of orbit.</p>
      <Link href="/markets" className="text-sm underline">Browse markets</Link>
    </div>
  );
}

import { BarChart3, Briefcase, CalendarClock, Home, Swords, Trophy } from "lucide-react";

export const NAV = [
  { href: "/", label: "Home", icon: Home },
  { href: "/markets", label: "Markets", icon: BarChart3 },
  { href: "/battles", label: "Battles", icon: Swords },
  { href: "/earnings", label: "Earnings", icon: CalendarClock },
  { href: "/leaderboard", label: "Leaderboard", icon: Trophy },
  { href: "/portfolio", label: "Portfolio", icon: Briefcase },
] as const;

export const isActive = (pathname: string, href: string) =>
  href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`) || (href === "/markets" && pathname.startsWith("/stocks"));

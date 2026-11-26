"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { IconChart, IconDumbbell, IconHistory, IconHome, IconShield } from "./icons";

const ITEMS = [
  { href: "/", label: "Inicio", icon: IconHome },
  { href: "/ejercicios", label: "Ejercicios", icon: IconDumbbell },
  { href: "/historial", label: "Historial", icon: IconHistory },
  { href: "/progreso", label: "Progreso", icon: IconChart },
];

export function MainNav({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();
  const items = isAdmin ? [...ITEMS, { href: "/admin", label: "Administración", icon: IconShield }] : ITEMS;
  const isCurrent = (href: string) =>
    href === "/" ? pathname === "/" || pathname.startsWith("/entrenar") || pathname.startsWith("/sesiones") : pathname.startsWith(href);
  return (
    <nav className="bottom-nav" aria-label="Navegación principal">
      {items.map(({ href, label, icon: Icon }) => (
        <Link key={href} href={href} aria-current={isCurrent(href) ? "page" : undefined}>
          <Icon />
          <span>{label === "Administración" ? <><span className="admin-short">Admin</span><span className="admin-long">Administración</span></> : label}</span>
        </Link>
      ))}
    </nav>
  );
}

"use client";

import { useSyncExternalStore } from "react";

const KEY = "sistema-gym:progreso-lista";

/** Guarda la búsqueda y el grupo de la lista («?q=…&grupo=…») para volver a ella. */
export function saveProgressListQuery(search: string) {
  try {
    sessionStorage.setItem(KEY, search);
  } catch {}
}

function read(): string {
  try {
    return sessionStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}

/** Enlace de regreso a la lista conservando la búsqueda y el grupo. */
export function useProgressListHref(): string {
  const search = useSyncExternalStore(
    () => () => {},
    read,
    () => "",
  );
  return `/progreso${search}`;
}

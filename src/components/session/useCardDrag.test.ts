import { describe, expect, it } from "vitest";
import { dropIndex, shiftFor } from "./useCardDrag";

// Tres tarjetas: 0–100, 112–312 (expandida) y 324–404.
const cards = [
  { key: "press", top: 0, height: 100 },
  { key: "peck", top: 112, height: 200 },
  { key: "remo", top: 324, height: 80 },
];

describe("reordenar por arrastre", () => {
  it("índice final según el centro de la tarjeta arrastrada", () => {
    // Peck (centro 212) sube por encima del centro de Press (50) → primera.
    expect(dropIndex(cards, 1, 40)).toBe(0);
    expect(dropIndex(cards, 1, 212)).toBe(1); // sin mover
    // Press baja más allá del centro de Remo (364) → última.
    expect(dropIndex(cards, 0, 380)).toBe(2);
    expect(dropIndex(cards, 0, 250)).toBe(1);
  });

  it("las demás tarjetas se desplazan para abrir el hueco", () => {
    // Peck (de 1 a 0): Press baja el alto de Peck + separación.
    expect([0, 1, 2].map((i) => shiftFor(i, 1, 0, 212))).toEqual([212, 0, 0]);
    // Press (de 0 a 2): Peck y Remo suben.
    expect([0, 1, 2].map((i) => shiftFor(i, 0, 2, 112))).toEqual([0, -112, -112]);
    // Sin cambio de posición: nadie se mueve.
    expect([0, 1, 2].map((i) => shiftFor(i, 1, 1, 212))).toEqual([0, 0, 0]);
  });
});

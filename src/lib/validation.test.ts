import { describe, expect, it } from "vitest";
import { isUuid, normalizeSearch, parseReps, parseWeight, validatePassword } from "./validation";

describe("parseWeight", () => {
  it("acepta coma o punto decimal", () => {
    expect(parseWeight("42,5")).toEqual({ ok: true, value: 42.5 });
    expect(parseWeight("47.25")).toEqual({ ok: true, value: 47.25 });
    expect(parseWeight(" 40 ")).toEqual({ ok: true, value: 40 });
  });
  it("vacío = peso corporal", () => {
    expect(parseWeight("")).toEqual({ ok: true, value: null });
  });
  it("rechaza más de dos decimales, negativos y texto", () => {
    expect(parseWeight("40.125").ok).toBe(false);
    expect(parseWeight("-5").ok).toBe(false);
    expect(parseWeight("abc").ok).toBe(false);
    expect(parseWeight("2001").ok).toBe(false);
  });
  it("no pierde precisión", () => {
    expect(parseWeight("0,1")).toEqual({ ok: true, value: 0.1 });
    expect(parseWeight("102.55")).toEqual({ ok: true, value: 102.55 });
  });
});

describe("parseReps", () => {
  it("valida enteros positivos", () => {
    expect(parseReps("12")).toEqual({ ok: true, value: 12 });
    expect(parseReps("").ok).toBe(false);
    expect(parseReps("0").ok).toBe(false);
    expect(parseReps("2.5").ok).toBe(false);
  });
});

describe("utilidades", () => {
  it("valida contraseñas", () => {
    expect(validatePassword("corta")).not.toBeNull();
    expect(validatePassword("suficiente1")).toBeNull();
  });
  it("normaliza búsquedas sin acentos", () => {
    expect(normalizeSearch("  Elevación LATERAL ")).toBe("elevacion lateral");
  });
  it("reconoce UUID", () => {
    expect(isUuid("50000000-0000-4000-8000-000000000001")).toBe(true);
    expect(isUuid("1; drop table")).toBe(false);
  });
});

import { expect, test, type Page } from "@playwright/test";

/** Equipo del ejercicio: variantes con el mismo nombre (375 px). */

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "";
const SHOTS = process.env.E2E_SCREENSHOT_DIR;
test.skip(!ADMIN_EMAIL || !ADMIN_PASSWORD, "Define E2E_ADMIN_EMAIL y E2E_ADMIN_PASSWORD para ejecutar el flujo.");

const run = Date.now().toString(36);
const PRESS = "Press de banca plano";

function isoDaysAgo(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Correo electrónico").fill(email);
  await page.getByLabel("Contraseña").fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

async function shot(page: Page, name: string) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, `scroll horizontal en ${name}`).toBeLessThanOrEqual(0);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

const saved = (page: Page) => expect(page.getByRole("status").filter({ hasText: /^Guardado$/ })).toBeVisible({ timeout: 15_000 });

test("Equipo: variantes de Press de banca plano, Progreso separado e historial conservado (375 px)", async ({ browser }) => {
  const user = { email: `lu.${run}@example.com`, temp: "Temporal753", final: "LuSegura951" };
  const adminCtx = await browser.newContext();
  const admin = await adminCtx.newPage();
  await login(admin, ADMIN_EMAIL, ADMIN_PASSWORD);
  await admin.goto("/admin");
  const form = admin.getByRole("form", { name: "Crear cuenta" });
  await form.getByLabel("Correo").fill(user.email);
  await form.getByLabel("Contraseña inicial").fill(user.temp);
  await form.getByRole("button", { name: "Crear cuenta" }).click();
  await expect(form.getByText(`Cuenta creada para ${user.email}`)).toBeVisible();
  await adminCtx.close();

  const context = await browser.newContext({ viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const page = await context.newPage();
  page.on("dialog", (d) => d.accept());
  await login(page, user.email, user.temp);
  await page.getByLabel("Nueva contraseña", { exact: true }).fill(user.final);
  await page.getByLabel("Repite la nueva contraseña").fill(user.final);
  await page.getByRole("button", { name: "Guardar contraseña" }).click();
  await expect(page).toHaveURL(/\/$/);

  // Ejercicio «anterior» sin equipo, con historial (60 kg hace una semana).
  await page.goto("/ejercicios");
  const nuevo = async (equipo: string | null) => {
    await page.locator(".catalog-head").getByRole("button", { name: "Nuevo ejercicio" }).click();
    const sheet = page.getByRole("dialog", { name: "Nuevo ejercicio" });
    await sheet.getByLabel("Nombre del ejercicio").fill(PRESS);
    await sheet.getByLabel("Grupo muscular").selectOption({ label: "Pecho" });
    await expect(sheet.getByLabel("Equipo")).toHaveValue("");
    if (equipo) await sheet.getByLabel("Equipo").selectOption({ label: equipo });
    await sheet.getByRole("button", { name: "Crear ejercicio" }).click();
    return sheet;
  };
  await expect((await nuevo(null))).toBeHidden();
  const filas = page.locator(".catalog-list li");
  await expect(filas).toHaveCount(1);
  await expect(filas.first()).toContainText(PRESS);
  await expect(filas.first().locator(".ex-equipment")).toHaveCount(0); // sin indicar: solo el nombre

  await page.goto("/entrenar");
  await page.getByLabel("Fecha del entrenamiento").fill(isoDaysAgo(7));
  await page.getByRole("button", { name: "Agregar ejercicio", exact: true }).click();
  let picker = page.getByRole("dialog");
  await picker.getByRole("listitem").filter({ hasText: PRESS }).getByRole("button").click();
  const card = page.getByRole("region", { name: PRESS });
  await card.getByLabel(`Repeticiones por serie de ${PRESS}`).fill("8");
  await card.getByLabel(`Peso por serie de ${PRESS}`, { exact: false }).fill("60");
  await card.getByRole("button", { name: "Agregar 3 series" }).click();
  await saved(page);
  const sesionAnterior = page.url();
  await page.getByRole("button", { name: "Finalizar sesión" }).click();
  await expect(page).toHaveURL(/\/historial/);

  // Asignar «Barra» al ejercicio anterior: conserva nombre, ID e historial.
  await page.goto("/ejercicios");
  await filas.first().getByRole("button").click();
  let sheet = page.getByRole("dialog", { name: "Editar ejercicio" });
  await expect(sheet.getByLabel("Nombre del ejercicio")).toHaveValue(PRESS);
  await sheet.getByLabel("Equipo").selectOption({ label: "Barra" });
  await sheet.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(sheet).toBeHidden();
  await expect(filas.first().locator(".ex-equipment")).toHaveText("Barra");

  // Variante con mancuernas: mismo nombre, otro equipo. La misma combinación no se repite.
  await expect((await nuevo("Mancuernas"))).toBeHidden();
  sheet = await nuevo("Mancuernas");
  await expect(sheet.getByText("Ya tienes un ejercicio activo con ese nombre y ese equipo.").first()).toBeVisible();
  await sheet.getByRole("button", { name: "Cancelar" }).click();
  await expect(filas).toHaveCount(2);
  await expect(filas.locator("strong")).toHaveText([PRESS, PRESS]);
  await expect(filas.locator(".ex-equipment")).toHaveText(["Barra", "Mancuernas"]);
  await page.getByLabel("Buscar ejercicio", { exact: false }).first().fill("mancuernas");
  await expect(filas).toHaveCount(1);
  await shot(page, "e1-catalogo-variantes");

  // Selector de la sesión: nombre como título y equipo como subtítulo; busca por equipo.
  await page.goto("/entrenar");
  await page.getByRole("button", { name: "Agregar ejercicio", exact: true }).click();
  picker = page.getByRole("dialog");
  const opciones = picker.getByRole("list", { name: "Tus ejercicios" }).getByRole("listitem");
  await expect(opciones.locator("strong")).toHaveText([PRESS, PRESS]);
  await expect(opciones.locator(".ex-equipment")).toHaveText(["Barra", "Mancuernas"]);
  await shot(page, "e2-selector-variantes");
  await picker.getByLabel("Buscar ejercicio").fill("press manc");
  await expect(opciones).toHaveCount(1);
  await opciones.getByRole("button", { name: `${PRESS} · Mancuernas` }).click();
  await expect(picker).toBeHidden();
  const tarjeta = page.getByRole("region", { name: PRESS });
  await expect(tarjeta.locator(".ex-subtitle")).toHaveText("Mancuernas");
  // La variante con mancuernas no tiene historial propio: no muestra los 60 kg de la barra.
  await expand(page);
  await expect(tarjeta.getByText("Primer registro")).toBeVisible();
  await tarjeta.getByLabel(`Repeticiones por serie de ${PRESS}`).fill("10");
  await tarjeta.getByLabel(`Peso por serie de ${PRESS}`, { exact: false }).fill("22");
  await tarjeta.getByRole("button", { name: "Agregar 3 series" }).click();
  await saved(page);

  // «Cambiar ejercicio»: conserva el filtro por grupo y busca también por equipo.
  await page.getByRole("button", { name: `Cambiar ejercicio ${PRESS}` }).click();
  picker = page.getByRole("dialog", { name: "Cambiar ejercicio" });
  await expect(picker.locator(".swap-current .ex-equipment")).toHaveText("Mancuernas");
  await expect(picker.getByRole("button", { name: "Pecho", exact: true })).toHaveAttribute("aria-pressed", "true");
  const cambio = picker.getByRole("list", { name: "Ejercicios de Pecho" }).getByRole("listitem");
  await expect(cambio.locator(".ex-equipment")).toHaveText(["Barra"]);
  await picker.getByLabel("Buscar ejercicio").fill("barra");
  await expect(cambio).toHaveCount(1);
  await picker.getByLabel("Buscar ejercicio").fill("polea");
  await expect(cambio).toHaveCount(0);
  await shot(page, "e3-cambiar-por-equipo");
  await picker.getByRole("button", { name: "Cerrar" }).click();
  await page.getByRole("button", { name: "Finalizar sesión" }).click();
  await expect(page).toHaveURL(/\/historial/);

  // Progreso: cada variante con su equipo y su peso por separado.
  await page.goto("/progreso");
  const prog = page.locator(".progress-row");
  await expect(prog).toHaveCount(2);
  const barra = prog.filter({ has: page.locator(".ex-equipment", { hasText: "Barra" }) });
  const manc = prog.filter({ has: page.locator(".ex-equipment", { hasText: "Mancuernas" }) });
  await expect(barra.locator(".progress-best")).toContainText("60 kg");
  await expect(manc.locator(".progress-best")).toContainText("22 kg");
  await shot(page, "e4-progreso-variantes");
  await barra.click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(PRESS);
  await expect(page.locator(".ex-subtitle")).toHaveText("Barra");
  await expect(page.locator("main")).toContainText("60 kg");
  await expect(page.locator("main")).not.toContainText("22 kg");

  // El historial anterior sigue bajo el mismo ejercicio (ahora con equipo «Barra»).
  await page.goto(sesionAnterior);
  await expect(page.getByRole("region", { name: PRESS }).locator(".ex-subtitle")).toHaveText("Barra");
  await expect(page.getByRole("region", { name: PRESS }).locator(".ex-summary")).toContainText("3 series · Mejor serie: 60 kg × 8");
  await context.close();

  async function expand(p: Page) {
    const toggle = p.getByRole("button", { name: `Expandir ${PRESS}` });
    if (await toggle.count()) await toggle.click();
  }
});

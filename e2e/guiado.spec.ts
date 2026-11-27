import { expect, test, type Page } from "@playwright/test";

/**
 * Cambio de ejercicio, entrenamiento guiado y series alternadas (375 px).
 * Requiere la app corriendo contra Supabase con las migraciones aplicadas y un
 * administrador (E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD).
 */

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "";
const SHOTS = process.env.E2E_SCREENSHOT_DIR;

test.skip(!ADMIN_EMAIL || !ADMIN_PASSWORD, "Define E2E_ADMIN_EMAIL y E2E_ADMIN_PASSWORD para ejecutar el flujo.");

const run = Date.now().toString(36);
const BARRA = "Press inclinado con barra";
const MANC = "Press inclinado con mancuernas";
const POLEAS = "Poleas cruzadas";
const REMO = "Remo con barra";
const CURL = "Curl con mancuernas";

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

async function createInCatalog(page: Page, name: string, group: string) {
  await page.locator(".catalog-head").getByRole("button", { name: "Nuevo ejercicio" }).click();
  const sheet = page.getByRole("dialog", { name: "Nuevo ejercicio" });
  await sheet.getByLabel("Nombre").fill(name);
  await sheet.getByLabel("Grupo muscular").selectOption({ label: group });
  await sheet.getByRole("button", { name: "Crear ejercicio" }).click();
  await expect(sheet).toBeHidden();
}

/** El botón está a la vista y nada lo tapa (ni la navegación inferior). */
async function reachable(page: Page, name: string) {
  const button = page.getByRole("button", { name, exact: true });
  await expect(button).toBeInViewport({ ratio: 1 });
  const box = (await button.boundingBox())!;
  const top = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest("button")?.textContent ?? "", {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
  });
  expect(top).toContain(name);
}

test("Cambiar ejercicio, entrenamiento guiado y series alternadas (375 px)", async ({ browser }) => {
  const user = { email: `kami.${run}@example.com`, temp: "Temporal852", final: "KamiSegura963" };
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

  // Catálogo y rutina «Pecho guiado»: Press inclinado con barra 4 × 10, Poleas 3 × 12, Curl 3 × 10.
  await page.goto("/ejercicios");
  for (const [name, group] of [[BARRA, "Pecho"], [MANC, "Pecho"], [POLEAS, "Pecho"], [REMO, "Espalda"], [CURL, "Bíceps"]]) {
    await createInCatalog(page, name, group);
  }
  await page.goto("/rutinas/nueva");
  await page.getByLabel("Nombre").fill("Pecho guiado");
  for (const [name, sets, reps] of [[BARRA, "4", "10"], [POLEAS, "3", "12"], [CURL, "3", "10"]]) {
    await page.getByRole("button", { name: "Agregar ejercicio", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Buscar ejercicio").fill(name);
    await dialog.getByRole("listitem").filter({ hasText: name }).first().getByRole("button").click();
    await expect(dialog).toBeHidden();
    await page.getByLabel(`Series objetivo de ${name}`).fill(sets);
    await page.getByLabel(`Repeticiones mínimas de ${name}`).fill(reps);
  }
  await page.getByRole("button", { name: "Guardar rutina" }).click();
  await expect(page).toHaveURL(/\/rutinas\?guardada=/);

  // --- 1. Cambiar Press inclinado con barra por mancuernas desde el filtro Pecho -------
  await page.getByRole("button", { name: "Usar rutina Pecho guiado" }).click();
  await expect(page).toHaveURL(/\/sesiones\//);
  const sessionUrl = page.url();
  await expect(page.getByRole("button", { name: "Iniciar entrenamiento" })).toBeVisible();
  await page.getByRole("button", { name: `Cambiar ejercicio ${BARRA}` }).click();
  let picker = page.getByRole("dialog", { name: "Cambiar ejercicio" });
  await expect(picker.getByText(`Ejercicio actual ${BARRA}`)).toBeVisible();
  await expect(picker.getByRole("button", { name: "Pecho", exact: true })).toHaveAttribute("aria-pressed", "true");
  const opciones = picker.getByRole("list", { name: "Ejercicios de Pecho" }).getByRole("listitem");
  // Excluye el actual, los que ya están en la sesión y otros grupos.
  await expect(opciones).toHaveText([MANC]);
  await shot(page, "g1-cambiar-selector");
  await opciones.filter({ hasText: MANC }).getByRole("button").click();
  let confirmar = page.getByRole("dialog", { name: "Cambiar ejercicio" });
  await expect(confirmar.getByText("Solo en esta sesión")).toBeVisible();
  await expect(confirmar.getByRole("status")).toContainText(`«${MANC}» ocupará el lugar de «${BARRA}»`);
  await expect(confirmar.getByText("Última vez: primer registro")).toBeVisible();
  await expect(confirmar.getByRole("checkbox", { name: /Aplicar la meta de/ })).toBeChecked();
  await expect(confirmar.getByLabel(`Series de ${MANC}`)).toHaveValue("4");
  await expect(confirmar.getByLabel(`Repeticiones mínimas de ${MANC}`)).toHaveValue("10");
  await shot(page, "g2-cambiar-confirmar");
  await confirmar.getByRole("button", { name: "Cambiar ejercicio" }).click();
  await expect(confirmar).toBeHidden();
  const tarjetas = page.locator(".exercise-card");
  await expect(tarjetas.locator("h3")).toHaveText([MANC, POLEAS, CURL]);
  await expect(page.getByRole("region", { name: MANC })).toContainText("Meta: 4 × 10");
  await expect(page.getByRole("region", { name: MANC })).toContainText("0 de 4 series");
  await saved(page);
  // La rutina guardada no cambia.
  await page.goto("/rutinas");
  const rutina = page.getByRole("listitem", { name: "Pecho guiado" });
  await expect(rutina).toContainText(BARRA);
  await expect(rutina).not.toContainText(MANC);
  await page.goto(sessionUrl);

  // --- 3. Alternar press y poleas (4 y 3 series), con una serie por bloques ----------
  await page.getByRole("button", { name: `Acciones de ${MANC}` }).click();
  await page.getByRole("menuitem", { name: "Alternar con otro ejercicio" }).click();
  const alternar = page.getByRole("dialog", { name: "Alternar con otro ejercicio" });
  await alternar.getByRole("radio", { name: POLEAS }).click();
  await expect(alternar.getByLabel(`Series de ${MANC}`)).toHaveValue("4");
  await expect(alternar.getByLabel(`Series de ${POLEAS}`)).toHaveValue("3");
  await alternar.getByRole("button", { name: "Alternar series" }).click();
  await expect(alternar).toBeHidden();
  await expect(page.getByRole("region", { name: MANC })).toContainText(`Series alternadas · con ${POLEAS}`);
  await expect(page.getByRole("region", { name: POLEAS })).toContainText(`Series alternadas · con ${MANC}`);
  await shot(page, "g3-lista-alternadas");

  await page.getByRole("button", { name: "Iniciar entrenamiento" }).click();
  const tarjeta = page.locator(".guided-card");
  const titulo = tarjeta.getByRole("heading", { level: 2 });
  const hechas = tarjeta.locator(".guided-set");
  await expect(page.getByText("1 de 2 ejercicios")).toBeVisible();
  await expect(titulo).toHaveText(MANC);
  await expect(tarjeta.locator(".guided-round")).toContainText("Vuelta 1 de 4");
  await expect(tarjeta.locator(".guided-set-current")).toContainText(`Vuelta 1 · ${MANC}`);
  await expect(tarjeta.getByText(`Sigue: ${POLEAS} · vuelta 1`)).toBeVisible();
  await tarjeta.getByLabel(`Peso serie 1 de ${MANC}`, { exact: false }).fill("20");
  await tarjeta.getByLabel(`Repeticiones serie 1 de ${MANC}`).fill("10");
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/g4-vista.png` });
  await shot(page, "g4-guiado-vuelta1");
  await reachable(page, "Guardar y seguir");
  // Doble toque: una sola serie y un solo turno.
  await tarjeta.getByRole("button", { name: "Guardar y seguir" }).dblclick();
  await expect(titulo).toHaveText(POLEAS);
  await expect(hechas).toHaveCount(1);
  await expect(tarjeta.locator(".guided-round")).toContainText("Vuelta 1 de 4");
  await expect(tarjeta.getByText(`Sigue: ${MANC} · vuelta 2`)).toBeVisible();

  // Poleas: serie por bloques (12 reps a 15 kg → sostener 5 s), capturada en el mismo turno.
  const bloques = async (title: string) => {
    const sheet = page.getByRole("dialog", { name: title });
    await expect(sheet).toBeVisible();
    return sheet;
  };
  await tarjeta.getByRole("button", { name: "Serie por bloques" }).click();
  await tarjeta.getByRole("button", { name: "Capturar bloques" }).click();
  let sheet = await bloques("Serie 1");
  await sheet.getByRole("button", { name: "Reps + sostén" }).click();
  await sheet.getByLabel("Repeticiones del paso 1").fill("12");
  await sheet.getByLabel("Peso del paso 1", { exact: false }).fill("15");
  await sheet.getByRole("button", { name: /^Paso 2/ }).click();
  await sheet.getByLabel("Segundos del paso 2").fill("5");
  await sheet.getByRole("button", { name: "Guardar y seguir" }).click();
  await expect(sheet).toBeHidden();
  await expect(titulo).toHaveText(MANC);
  await expect(tarjeta.locator(".guided-round")).toContainText("Vuelta 2 de 4");
  await expect(hechas).toHaveCount(2);
  await expect(hechas.nth(1)).toContainText("12 reps a 15 kg → sostener 5 s");

  // Press 2 (parte de la serie anterior) y recarga a mitad de la segunda vuelta.
  await expect(tarjeta.getByLabel(`Peso serie 2 de ${MANC}`, { exact: false })).toHaveValue("20");
  await tarjeta.getByLabel(`Repeticiones serie 2 de ${MANC}`).fill("8");
  await tarjeta.getByRole("button", { name: "Guardar y seguir" }).click();
  await expect(titulo).toHaveText(POLEAS);
  await saved(page);
  await page.reload();
  await expect(titulo).toHaveText(POLEAS);
  await expect(tarjeta.locator(".guided-round")).toContainText("Vuelta 2 de 4");
  await expect(hechas).toHaveCount(3);
  await tarjeta.getByRole("button", { name: "Capturar bloques" }).click();
  sheet = await bloques("Serie 2");
  await expect(sheet.locator(".step-text")).toHaveText(["1 · 12 reps a 15 kg", "2 · Sostener 5 s"]);
  await sheet.getByRole("button", { name: "Guardar y seguir" }).click();
  await expect(titulo).toHaveText(MANC);
  await expect(tarjeta.locator(".guided-round")).toContainText("Vuelta 3 de 4");

  // Corregir una serie guardada: no se duplica ni avanza el turno.
  await tarjeta.getByRole("button", { name: `Corregir Vuelta 1 · ${MANC}, serie 1 de ${MANC}` }).click();
  await expect(tarjeta.getByLabel(`Repeticiones serie 1 de ${MANC}`)).toHaveValue("10");
  await tarjeta.getByLabel(`Repeticiones serie 1 de ${MANC}`).fill("11");
  await tarjeta.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(hechas).toHaveCount(4);
  await expect(hechas.first()).toContainText("20 kg × 11");
  await expect(titulo).toHaveText(MANC);
  await expect(tarjeta.locator(".guided-round")).toContainText("Vuelta 3 de 4");

  // Vueltas 3 y 4: en la cuarta solo queda el press (4 series frente a 3).
  await tarjeta.getByRole("button", { name: "Guardar y seguir" }).click();
  await expect(titulo).toHaveText(POLEAS);
  await tarjeta.getByRole("button", { name: "Capturar bloques" }).click();
  sheet = await bloques("Serie 3");
  await sheet.getByRole("button", { name: "Guardar y seguir" }).click();
  await expect(titulo).toHaveText(MANC);
  await expect(tarjeta.locator(".guided-round")).toContainText("Vuelta 4 de 4");
  await expect(tarjeta.getByText("Es el último turno.")).toBeVisible();
  await tarjeta.getByRole("button", { name: "Guardar y seguir" }).click();
  await expect(tarjeta.getByText("Registraste todas las vueltas.")).toBeVisible();
  await expect(hechas).toHaveCount(7);
  await tarjeta.getByRole("button", { name: "Finalizar series alternadas" }).click();

  // --- 4. Curl con menos series que la meta, volver a la lista y finalizar a mano ------
  await expect(page.getByText("2 de 2 ejercicios")).toBeVisible();
  await expect(titulo).toHaveText(CURL);
  await expect(tarjeta.locator(".guided-set-current")).toContainText("Serie 1 de 3");
  await tarjeta.getByLabel(`Peso serie 1 de ${CURL}`, { exact: false }).fill("12");
  await tarjeta.getByLabel(`Repeticiones serie 1 de ${CURL}`).fill("10");
  await tarjeta.getByRole("button", { name: "Registrar serie" }).click();
  await expect(tarjeta.locator(".guided-progress")).toHaveText("1 de 3 series");
  await tarjeta.getByRole("button", { name: "Finalizar ejercicio" }).click();
  await expect(tarjeta.getByText("Completado")).toBeVisible();
  await shot(page, "g5-guiado-completado");
  // Anterior / Siguiente.
  await page.getByRole("button", { name: "Anterior" }).click();
  await expect(page.getByText("1 de 2 ejercicios")).toBeVisible();
  await page.getByRole("button", { name: "Siguiente" }).click();
  await expect(titulo).toHaveText(CURL);

  await page.getByRole("button", { name: "Ver lista" }).click();
  await expect(page.getByRole("button", { name: "Continuar entrenamiento" })).toBeVisible();
  const curl = page.getByRole("region", { name: CURL });
  await expect(curl).toHaveAttribute("data-done", "true");
  await expect(curl).toContainText("Completado");
  await expect(page.getByRole("region", { name: MANC })).toHaveAttribute("data-done", "true");
  // Reabrir y volver a finalizar desde el menú ⋯ de la lista.
  await page.getByRole("button", { name: `Acciones de ${CURL}` }).click();
  await page.getByRole("menuitem", { name: "Reabrir ejercicio" }).click();
  await expect(curl).not.toHaveAttribute("data-done", "true");
  await expect(curl).toContainText("1 de 3 series");
  await page.getByRole("button", { name: "Finalizar sesión" }).click();
  const resumen = page.getByRole("dialog", { name: "¿Finalizar con ejercicios pendientes?" });
  await expect(resumen.getByRole("listitem")).toHaveText([`${CURL} · 1 de 3 series`]);
  await resumen.getByRole("button", { name: "Seguir entrenando" }).click();
  await page.getByRole("button", { name: `Acciones de ${CURL}` }).click();
  await page.getByRole("menuitem", { name: "Finalizar ejercicio" }).click();
  await shot(page, "g6-lista-completados");
  await page.getByRole("button", { name: "Finalizar sesión" }).click();
  await expect(page).toHaveURL(/\/historial/);

  // --- 5. Guardar la pareja como rutina y cargarla de nuevo -------------------------
  await page.goto(sessionUrl);
  await page.getByRole("button", { name: "Acciones de la sesión" }).click();
  await page.getByRole("menuitem", { name: "Guardar como rutina" }).click();
  await expect(page).toHaveURL(/\/rutinas\/nueva\?desde=/);
  await expect(page.getByRole("status")).toContainText("Las series alternadas se conservan como pareja.");
  const filas = page.getByRole("list", { name: "Ejercicios de la rutina" }).locator(":scope > li");
  await expect(filas.locator(".routine-ex-title strong")).toHaveText([MANC, POLEAS, CURL]);
  await expect(filas.nth(0)).toContainText(`Series alternadas · con ${POLEAS}`);
  await expect(page.getByLabel(`Series objetivo de ${MANC}`)).toHaveValue("4");
  await expect(page.getByLabel(`Series objetivo de ${POLEAS}`)).toHaveValue("3");
  await expect(page.getByLabel(`Repeticiones mínimas de ${POLEAS}`)).toHaveValue("12");
  await page.getByLabel("Nombre").fill("Pecho alternado");
  await page.getByRole("button", { name: "Guardar rutina" }).click();
  await expect(page).toHaveURL(/\/rutinas\?guardada=/);
  await expect(page.getByRole("listitem", { name: "Pecho alternado" })).toContainText("⇄ alternada");
  await page.getByRole("button", { name: "Usar rutina Pecho alternado" }).click();
  await expect(page).toHaveURL(/\/sesiones\//);
  const second = page.url();
  await expect(page.getByRole("region", { name: MANC })).toContainText(`Series alternadas · con ${POLEAS}`);
  await expect(page.getByRole("region", { name: MANC })).toContainText("0 de 4 series");
  await expect(page.getByRole("region", { name: POLEAS })).toContainText("0 de 3 series");
  await page.getByRole("button", { name: "Iniciar entrenamiento" }).click();
  await expect(tarjeta.locator(".guided-round")).toContainText("Vuelta 1 de 4");
  await expect(hechas).toHaveCount(0);

  // --- 2. Cambiar un ejercicio después de registrar una serie -----------------------
  await tarjeta.getByLabel(`Peso serie 1 de ${MANC}`, { exact: false }).fill("22");
  await tarjeta.getByLabel(`Repeticiones serie 1 de ${MANC}`).fill("10");
  await tarjeta.getByRole("button", { name: "Guardar y seguir" }).click();
  await expect(titulo).toHaveText(POLEAS);
  await page.getByRole("button", { name: "Ver lista" }).click();
  await page.getByRole("button", { name: `Cambiar ejercicio ${MANC}` }).click();
  picker = page.getByRole("dialog", { name: "Cambiar ejercicio" });
  await picker.getByRole("listitem").filter({ hasText: BARRA }).getByRole("button").click();
  confirmar = page.getByRole("dialog", { name: "Cambiar ejercicio" });
  await expect(confirmar.getByRole("status")).toContainText(`«${MANC}» conserva su serie registrada y queda completado`);
  await expect(confirmar.getByRole("status")).toContainText(`solo en los turnos pendientes de «${MANC}» con «${POLEAS}»`);
  await expect(confirmar.getByLabel(`Series de ${BARRA}`)).toHaveValue("3");
  await confirmar.getByRole("button", { name: "Cambiar ejercicio" }).click();
  await expect(tarjetas.locator("h3")).toHaveText([MANC, BARRA, POLEAS, CURL]);
  await expect(page.getByRole("region", { name: MANC })).toHaveAttribute("data-done", "true");
  await expect(page.getByRole("region", { name: BARRA })).toContainText("0 de 3 series");
  await expect(page.getByRole("region", { name: BARRA })).toContainText(`Series alternadas · con ${POLEAS}`);
  await page.getByRole("button", { name: "Continuar entrenamiento" }).click();
  await expect(titulo).toHaveText(POLEAS);
  // La sesión anterior es del mismo día: «Última vez» no la usa y la captura es simple.
  await tarjeta.getByLabel(`Peso serie 1 de ${POLEAS}`, { exact: false }).fill("15");
  await tarjeta.getByLabel(`Repeticiones serie 1 de ${POLEAS}`).fill("12");
  await tarjeta.getByRole("button", { name: "Guardar y seguir" }).click();
  // El sustituto toma el turno pendiente del original.
  await expect(titulo).toHaveText(BARRA);
  await expect(tarjeta.locator(".guided-round")).toContainText("Vuelta 2 de 4");
  await tarjeta.getByLabel(`Peso serie 1 de ${BARRA}`, { exact: false }).fill("30");
  await tarjeta.getByLabel(`Repeticiones serie 1 de ${BARRA}`).fill("8");
  await tarjeta.getByRole("button", { name: "Guardar y seguir" }).click();
  await expect(titulo).toHaveText(POLEAS);

  // Teclado abierto (área visible de ~400 px): la captura y su acción siguen al alcance.
  await page.setViewportSize({ width: 375, height: 400 });
  await tarjeta.getByLabel(`Repeticiones serie 2 de ${POLEAS}`).focus();
  await reachable(page, "Guardar y seguir");
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/g7-375-teclado.png` });
  await page.setViewportSize({ width: 375, height: 667 });

  await saved(page);
  await page.getByRole("button", { name: "Ver lista" }).click();
  await page.getByRole("button", { name: "Finalizar sesión" }).click();
  const pendientes = page.getByRole("dialog", { name: "¿Finalizar con ejercicios pendientes?" });
  await expect(pendientes.getByRole("listitem")).toHaveText([`${BARRA} · 1 de 3 series`, `${POLEAS} · 1 de 3 series`, `${CURL} · 0 de 3 series`]);
  await pendientes.getByRole("button", { name: "Finalizar sesión" }).click();
  await expect(page).toHaveURL(/\/historial/);

  // El historial conserva cada serie bajo el ejercicio correcto.
  await page.goto(second);
  for (const [name, text] of [[MANC, "1 serie · Mejor serie: 22 kg × 10"], [BARRA, "1 serie · Mejor serie: 30 kg × 8"]]) {
    await expect(page.getByRole("region", { name }).locator(".ex-summary")).toContainText(text);
  }
  await page.goto("/rutinas");
  await expect(page.getByRole("listitem", { name: "Pecho alternado" })).toContainText(MANC);
  await expect(page.getByRole("listitem", { name: "Pecho alternado" })).not.toContainText(BARRA);
  await context.close();
});

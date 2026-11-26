import { expect, test, type Browser, type Page } from "@playwright/test";

/**
 * Flujo completo del MVP con un ancho de pantalla móvil.
 * Requiere la app corriendo (E2E_BASE_URL) contra un proyecto Supabase con las
 * migraciones aplicadas y un administrador creado (E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD).
 */

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "";
const SHOTS = process.env.E2E_SCREENSHOT_DIR;

test.skip(!ADMIN_EMAIL || !ADMIN_PASSWORD, "Define E2E_ADMIN_EMAIL y E2E_ADMIN_PASSWORD para ejecutar el flujo.");
test.describe.configure({ mode: "serial" });

const run = Date.now().toString(36);
const userA = { email: `ana.${run}@example.com`, temp: "Temporal123", final: "AnaSegura456" };
const userB = { email: `beto.${run}@example.com`, temp: "Temporal789", final: "BetoSegura456" };

function isoDaysAgo(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function shot(page: Page, name: string) {
  // Diseño móvil: ninguna pantalla debe tener scroll horizontal.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, `scroll horizontal en ${name}`).toBeLessThanOrEqual(0);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

async function newPage(browser: Browser) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const page = await context.newPage();
  page.on("dialog", (d) => d.accept());
  return page;
}

async function login(page: Page, email: string, password: string, expectOk = true) {
  await page.goto("/login");
  await page.getByLabel("Correo electrónico").fill(email);
  await page.getByLabel("Contraseña").fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
  if (expectOk) await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

async function setSet(page: Page, exercise: string, n: number, weight: string, reps: string) {
  await page.getByLabel(`Peso serie ${n} de ${exercise}`, { exact: false }).fill(weight);
  await page.getByLabel(`Repeticiones serie ${n} de ${exercise}`).fill(reps);
}

/**
 * Agrega un ejercicio desde el modal. Con `create`, lo crea con «+ Crear ejercicio»:
 * el texto del buscador queda como nombre y se elige el grupo si no viene precargado.
 */
async function addExercise(page: Page, name: string, opts: { create?: boolean; muscle?: string; chip?: string } = {}) {
  await page.getByRole("button", { name: "Agregar ejercicio", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Agregar ejercicio" })).toBeVisible();
  if (opts.chip) await dialog.getByRole("button", { name: opts.chip, exact: true }).click();
  await dialog.getByLabel("Buscar ejercicio").fill(name);
  if (opts.create) {
    await dialog.locator(".picker-foot").getByRole("button", { name: "Crear ejercicio" }).click();
    await expect(dialog.getByLabel("Nombre del ejercicio")).toHaveValue(name);
    if (opts.muscle) await dialog.getByLabel("Grupo muscular").selectOption({ label: opts.muscle });
    await dialog.getByRole("button", { name: "Crear y agregar a la sesión" }).click();
  } else {
    await dialog.getByRole("listitem").filter({ hasText: name }).first().getByRole("button").click();
  }
  await expect(dialog).toBeHidden();
}

/** Fila del catálogo en la pestaña «Ejercicios». */
const catalogRow = (page: Page, name: string) => page.locator(".catalog-list li").filter({ hasText: name });

/** Abre el panel «Nuevo ejercicio» desde el encabezado fijo. */
async function openNewExercise(page: Page) {
  await page.locator(".catalog-head").getByRole("button", { name: "Nuevo ejercicio" }).click();
  const sheet = page.getByRole("dialog", { name: "Nuevo ejercicio" });
  await expect(sheet).toBeVisible();
  return sheet;
}

/** Crea un ejercicio desde el panel de la pestaña «Ejercicios». */
async function createInCatalog(page: Page, name: string, group: string) {
  const sheet = await openNewExercise(page);
  await sheet.getByLabel("Nombre").fill(name);
  await sheet.getByLabel("Grupo muscular").selectOption({ label: group });
  await sheet.getByRole("button", { name: "Crear ejercicio" }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByRole("status").filter({ hasText: `«${name}» creado` })).toBeVisible();
}

/** Expande un ejercicio colapsado del editor (si ya está abierto, no hace nada). */
async function expand(page: Page, exercise: string) {
  await expect(page.getByRole("button", { name: new RegExp(`^(Expandir|Colapsar) ${exercise}$`) })).toBeVisible();
  const toggle = page.getByRole("button", { name: `Expandir ${exercise}` });
  if (await toggle.count()) await toggle.click();
  await expect(page.getByRole("button", { name: `Colapsar ${exercise}` })).toBeVisible();
}

const saved = (page: Page) => expect(page.getByRole("status").filter({ hasText: /^Guardado$/ })).toBeVisible({ timeout: 15_000 });

let sessionA1 = "";
let pressId = "";

test("administrador crea dos cuentas", async ({ browser }) => {
  const page = await newPage(browser);
  await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  await expect(page.getByRole("link", { name: /Admin/ })).toBeVisible();
  await page.getByRole("link", { name: /Admin/ }).click();
  await expect(page).toHaveURL(/\/admin$/);

  for (const u of [userA, userB]) {
    const form = page.getByRole("form", { name: "Crear cuenta" });
    await form.getByLabel("Correo").fill(u.email);
    await form.getByLabel("Contraseña inicial").fill(u.temp);
    await form.getByRole("button", { name: "Crear cuenta" }).click();
    await expect(form.getByText(`Cuenta creada para ${u.email}`)).toBeVisible();
    await expect(form.getByTestId("temp-password")).toHaveText(u.temp);
  }
  await expect(page.getByTestId("account").filter({ hasText: userA.email }).getByText("Contraseña temporal", { exact: true })).toBeVisible();
  await shot(page, "01-admin");
  await page.context().close();
});

test("cuenta A: contraseña temporal obligatoria", async ({ browser }) => {
  const page = await newPage(browser);
  await login(page, userA.email, userA.temp);
  await expect(page).toHaveURL(/\/cambiar-clave$/);
  // Las rutas privadas siguen bloqueadas hasta cambiarla.
  await page.goto("/ejercicios");
  await expect(page).toHaveURL(/\/cambiar-clave$/);
  // Repetir la temporal no se acepta.
  await page.getByLabel("Nueva contraseña", { exact: true }).fill(userA.temp);
  await page.getByLabel("Repite la nueva contraseña").fill(userA.temp);
  await page.getByRole("button", { name: "Guardar contraseña" }).click();
  await expect(page.locator(".alert[role=alert]")).toContainText("distinta");
  await shot(page, "02-cambiar-clave");
  await page.getByLabel("Nueva contraseña", { exact: true }).fill(userA.final);
  await page.getByLabel("Repite la nueva contraseña").fill(userA.final);
  await page.getByRole("button", { name: "Guardar contraseña" }).click();
  await expect(page).toHaveURL(/\/$/);
  // La administración no aparece para un usuario.
  await expect(page.getByRole("link", { name: /Admin/ })).toHaveCount(0);
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/$/);
  await page.context().close();

  // La temporal ya no sirve.
  const again = await newPage(browser);
  await login(again, userA.email, userA.temp, false);
  await expect(again.locator(".alert[role=alert]")).toContainText("incorrectos");
  await again.context().close();
});

test("cuenta A: registra Press de banca y peso corporal, con fallo y reintento", async ({ browser }) => {
  const page = await newPage(browser);
  await login(page, userA.email, userA.final);
  await expect(page).toHaveURL(/\/$/);
  await shot(page, "03-inicio-vacio");

  await page.getByRole("link", { name: "Registrar entrenamiento" }).click();
  await page.getByLabel("Fecha del entrenamiento").fill(isoDaysAgo(7));

  await addExercise(page, "Press de banca", { create: true, muscle: "Pecho" });
  const press = page.getByRole("region", { name: "Press de banca" });
  await expect(press.getByText("Primer registro")).toBeVisible();
  await expect(press.getByRole("button", { name: "Copiar última sesión" })).toHaveCount(0);
  await shot(page, "04a-captura-rapida");

  // 3 × 10 a 40 kg en una sola acción (3 es la cantidad inicial).
  await expect(press.getByLabel("Cantidad de series de Press de banca")).toHaveValue("3");
  await press.getByLabel("Repeticiones por serie de Press de banca").fill("10");
  await press.getByLabel("Peso por serie de Press de banca", { exact: false }).fill("40");
  await press.getByRole("button", { name: "Agregar 3 series" }).click();
  await expect(press.getByLabel(/^Peso serie \d+ de Press de banca/)).toHaveCount(3);

  // Cambiar solo la tercera serie a 8 reps.
  await page.getByLabel("Repeticiones serie 3 de Press de banca").fill("8");
  await saved(page);
  await expect(page).toHaveURL(/\/sesiones\/[0-9a-f-]{36}$/);
  sessionA1 = page.url().split("/").pop()!;

  // Después de recargar: 40 × 10, 40 × 10, 40 × 8.
  await page.reload();
  // Al entrar a la sesión, las tarjetas están cerradas.
  await expect(page.getByRole("button", { name: "Expandir Press de banca" })).toHaveAttribute("aria-expanded", "false");
  await expand(page, "Press de banca");
  await expect(press.getByLabel(/^Peso serie \d+ de Press de banca/)).toHaveCount(3);
  for (const [n, reps] of [[1, "10"], [2, "10"], [3, "8"]] as const) {
    await expect(page.getByLabel(`Peso serie ${n} de Press de banca`, { exact: false })).toHaveValue("40");
    await expect(page.getByLabel(`Repeticiones serie ${n} de Press de banca`)).toHaveValue(reps);
  }
  await shot(page, "04b-tres-series-recargadas");

  // «Agregar serie» precarga la última fila; se edita para tener pesos distintos.
  await press.getByRole("button", { name: "Agregar serie", exact: true }).click();
  await expect(page.getByLabel("Peso serie 4 de Press de banca", { exact: false })).toHaveValue("40");
  await expect(page.getByLabel("Repeticiones serie 4 de Press de banca")).toHaveValue("8");
  await setSet(page, "Press de banca", 4, "42,5", "6");
  await saved(page);

  // Ejercicio de peso corporal, creado desde la misma sesión.
  await addExercise(page, "Dominadas", { create: true, muscle: "Espalda" });
  const dominadas = page.getByRole("region", { name: "Dominadas" });

  // Al agregar otro ejercicio, el anterior se colapsa: solo queda su nombre.
  await expect(page.getByRole("button", { name: "Expandir Press de banca" })).toHaveAttribute("aria-expanded", "false");
  await expect(press.locator(".ex-summary")).toHaveText("4 series · Mejor serie: 42,5 kg × 6");
  await expect(press.getByRole("button", { name: /^(Subir|Bajar) / })).toHaveCount(0);
  await expect(press.getByLabel(/^Peso serie \d+ de Press de banca/)).toHaveCount(0);
  await shot(page, "05b-ejercicio-colapsado");
  await page.getByRole("button", { name: "Expandir Press de banca" }).click();
  await expect(press.getByLabel(/^Peso serie \d+ de Press de banca/)).toHaveCount(4);
  await page.getByRole("button", { name: "Colapsar Press de banca" }).click();
  await expect(press.getByLabel(/^Peso serie \d+ de Press de banca/)).toHaveCount(0);

  // «Agregar serie» con el ejercicio vacío lleva a la captura rápida.
  await dominadas.getByRole("button", { name: "Agregar serie", exact: true }).click();
  await expect(dominadas.getByLabel("Repeticiones por serie de Dominadas")).toBeFocused();
  await dominadas.getByLabel("Cantidad de series de Dominadas").fill("2");
  await dominadas.getByLabel("Repeticiones por serie de Dominadas").fill("10");
  await dominadas.getByRole("button", { name: "Agregar 2 series" }).click();
  await expect(page.getByLabel("Peso serie 1 de Dominadas", { exact: false })).toHaveValue("");
  await saved(page);

  // Falla el guardado (sin red hacia el servidor) → se conserva lo capturado.
  await page.route("**/*", (route) =>
    route.request().method() === "POST" && route.request().headers()["next-action"] ? route.abort("internetdisconnected") : route.continue(),
  );
  await page.getByLabel("Repeticiones serie 2 de Dominadas").fill("8");
  await expect(page.getByRole("status").filter({ hasText: "No se guardó" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: "Reintentar" })).toBeVisible();
  await shot(page, "04-error-guardado");

  // Recargar con el guardado fallido: el borrador local sobrevive.
  await page.unroute("**/*");
  await page.reload();
  await expect(page.getByText("Recuperamos cambios")).toBeVisible();
  await expand(page, "Dominadas");
  await expect(page.getByLabel("Repeticiones serie 2 de Dominadas")).toHaveValue("8");
  // Doble toque en Guardar: idempotente.
  const guardar = page.getByRole("button", { name: "Guardar", exact: true });
  if (await guardar.isVisible()) await guardar.dblclick().catch(() => {});
  await saved(page);
  await shot(page, "05-sesion-guardada");

  await page.reload();
  // Al entrar a una sesión con varios ejercicios, todos están cerrados.
  await expect(page.getByRole("button", { name: "Expandir Press de banca" })).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("button", { name: "Expandir Dominadas" })).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("button", { name: /^Colapsar / })).toHaveCount(0);
  await expand(page, "Press de banca");
  await expand(page, "Dominadas");
  await expect(page.getByLabel("Peso serie 4 de Press de banca", { exact: false })).toHaveValue("42,5");
  await expect(page.getByLabel("Repeticiones serie 2 de Dominadas")).toHaveValue("8");
  await expect(page.getByLabel("Peso serie 1 de Dominadas", { exact: false })).toHaveValue("");
  await expect(page.getByLabel("Peso serie 2 de Dominadas", { exact: false })).toHaveValue("");

  await page.getByRole("button", { name: "Finalizar sesión" }).click();
  await expect(page).toHaveURL(/\/historial$/);
  await expect(page.getByRole("link", { name: /Press de banca/ })).toHaveCount(1);
  await page.context().close();
});

test("cuenta A: días después reutiliza el ejercicio y copia la última sesión", async ({ browser }) => {
  const page = await newPage(browser);
  await login(page, userA.email, userA.final);
  await page.getByRole("link", { name: "Registrar entrenamiento" }).click();
  await expect(page.getByLabel("Fecha del entrenamiento")).toHaveValue(isoDaysAgo(0));

  await addExercise(page, "press");
  const card = page.getByRole("region", { name: "Press de banca" });
  await expect(card.getByText("Última vez")).toBeVisible();
  await expect(card.locator(".previous-summary")).toHaveText("2 × 10 a 40 kg · 40 kg × 8 · 42,5 kg × 6");
  await shot(page, "06-series-anteriores");

  // Copia con los valores originales, aunque pesos y reps sean distintos.
  await card.getByRole("button", { name: "Copiar última sesión" }).click();
  const esperado = [["40", "10"], ["40", "10"], ["40", "8"], ["42,5", "6"]];
  await expect(card.getByLabel(/^Peso serie \d+ de Press de banca/)).toHaveCount(4);
  for (const [i, [peso, reps]] of esperado.entries()) {
    await expect(page.getByLabel(`Peso serie ${i + 1} de Press de banca`, { exact: false })).toHaveValue(peso);
    await expect(page.getByLabel(`Repeticiones serie ${i + 1} de Press de banca`)).toHaveValue(reps);
  }
  // Con series ya cargadas no se ofrece copiar otra vez (evita duplicados).
  await expect(card.getByRole("button", { name: "Copiar última sesión" })).toHaveCount(0);

  await setSet(page, "Press de banca", 4, "45", "6");
  await saved(page);
  await page.reload();
  await expand(page, "Press de banca");
  await expect(page.getByLabel("Peso serie 4 de Press de banca", { exact: false })).toHaveValue("45");
  await expect(page.getByLabel("Repeticiones serie 3 de Press de banca")).toHaveValue("8");
  await shot(page, "07-sesion-nueva");

  // Progreso: dos sesiones y gráfica.
  await page.getByRole("navigation").getByRole("link", { name: "Progreso" }).click();
  await page.getByRole("link", { name: /Press de banca/ }).click();
  await expect(page).toHaveURL(/\/progreso\/[0-9a-f-]{36}/);
  pressId = page.url().split("/").pop()!.split("?")[0];
  await expect(page.getByRole("img", { name: /Peso máximo por sesión/ })).toBeVisible();
  const series = page.locator(".history-item");
  await expect(series).toHaveCount(2);
  await expect(series.first()).toContainText("45 kg × 6");
  await expect(series.nth(1)).toContainText("42,5 kg × 6");
  await shot(page, "08-progreso");

  // Rango personalizado: solo la sesión antigua.
  await page.getByRole("group", { name: "Período" }).getByRole("button", { name: "Personalizado" }).click();
  await page.getByLabel("Hasta").fill(isoDaysAgo(3));
  await expect(series).toHaveCount(1);

  // Peso corporal: se muestran repeticiones.
  await page.goto("/progreso");
  await page.getByRole("link", { name: /Dominadas/ }).click();
  await expect(page.getByRole("img", { name: /Mejor serie por sesión/ })).toBeVisible();
  await expect(series.first()).toContainText("10 reps");
  await expect(series.first()).toContainText("18 reps totales");
  await shot(page, "09-progreso-peso-corporal");
  await page.context().close();
});

test("cuenta A: modal «Agregar ejercicio» por grupo muscular", async ({ browser }) => {
  const page = await newPage(browser);
  await login(page, userA.email, userA.final);
  // Sesión de hoy (la más reciente del historial).
  await page.getByRole("navigation").getByRole("link", { name: "Historial" }).click();
  await page.locator(".list > li").first().getByRole("link").click();
  await expect(page.getByRole("heading", { name: "Sesión de entrenamiento" })).toBeVisible();

  await page.getByRole("button", { name: "Agregar ejercicio", exact: true }).click();
  const dialog = page.getByRole("dialog");
  const filtros = dialog.getByRole("group", { name: "Filtrar por grupo muscular" });
  await expect(filtros.getByRole("button", { name: "Todos", exact: true })).toHaveAttribute("aria-pressed", "true");

  // «Pecho»: solo sus ejercicios; Press de banca ya está en la sesión.
  await filtros.getByRole("button", { name: "Pecho", exact: true }).click();
  await expect(filtros.getByRole("button", { name: "Pecho", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(dialog.getByRole("listitem")).toHaveCount(1);
  await expect(dialog.getByRole("listitem")).toContainText("Press de banca");
  await expect(dialog.getByRole("listitem")).toContainText("En la sesión");
  await expect(dialog.getByRole("listitem").getByRole("button")).toBeDisabled();
  await shot(page, "09c-modal-pecho");

  // Grupo sin ejercicios vs. búsqueda sin resultados; «+ Crear ejercicio» en ambos.
  await filtros.getByRole("button", { name: "Hombros", exact: true }).click();
  await expect(dialog.getByText("Aún no tienes ejercicios de Hombros.")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Crear ejercicio" })).toHaveCount(2);
  await filtros.getByRole("button", { name: "Pecho", exact: true }).click();
  await dialog.getByLabel("Buscar ejercicio").fill("Aperturas");
  await expect(dialog.getByText("Ningún ejercicio de Pecho coincide con «Aperturas».")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Crear ejercicio" })).toHaveCount(2);

  // Crear desde «Pecho»: nombre y grupo precargados; cancelar conserva filtro y búsqueda.
  await dialog.locator(".picker-foot").getByRole("button", { name: "Crear ejercicio" }).click();
  await expect(dialog.getByLabel("Nombre del ejercicio")).toHaveValue("Aperturas");
  await expect(dialog.getByLabel("Grupo muscular")).toHaveValue("pecho");
  await shot(page, "09d-modal-crear");
  await dialog.getByRole("button", { name: "Cancelar" }).click();
  await expect(filtros.getByRole("button", { name: "Pecho", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(dialog.getByLabel("Buscar ejercicio")).toHaveValue("Aperturas");
  await dialog.locator(".picker-foot").getByRole("button", { name: "Crear ejercicio" }).click();
  await dialog.getByLabel("Nombre del ejercicio").fill("Aperturas con mancuernas");
  await dialog.getByRole("button", { name: "Crear y agregar a la sesión" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("region", { name: "Aperturas con mancuernas" })).toBeVisible();
  await saved(page);

  // Desde «Todos» el grupo se elige explícitamente: sin grupo se rechaza.
  await page.getByRole("button", { name: "Agregar ejercicio", exact: true }).click();
  await dialog.locator(".picker-foot").getByRole("button", { name: "Crear ejercicio" }).click();
  await expect(dialog.getByLabel("Grupo muscular")).toHaveValue("");
  await dialog.getByLabel("Nombre del ejercicio").fill("Fondos");
  await dialog.getByRole("button", { name: "Crear y agregar a la sesión" }).click();
  await expect(dialog.getByText("Selecciona un grupo muscular")).toBeVisible();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancelar" }).click();

  // Doble toque sobre un ejercicio disponible: se agrega una sola vez.
  await dialog.getByLabel("Buscar ejercicio").fill("Dominadas");
  await dialog.getByRole("listitem").filter({ hasText: "Dominadas" }).getByRole("button").dblclick();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("region", { name: "Dominadas" })).toHaveCount(1);
  await saved(page);

  // Tras recargar: el nuevo ejercicio sigue en la sesión y en el catálogo, con Pecho.
  await page.reload();
  await expect(page.getByRole("region", { name: "Aperturas con mancuernas" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Dominadas" })).toHaveCount(1);
  await page.goto("/ejercicios");
  await expect(catalogRow(page, "Aperturas con mancuernas")).toContainText("Pecho");

  // Las sesiones anteriores siguen mostrando sus ejercicios.
  await page.goto(`/sesiones/${sessionA1}`);
  await expect(page.getByRole("region", { name: "Press de banca" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Dominadas" })).toBeVisible();
  await page.context().close();
});

test("cuenta A: pestaña «Ejercicios»: crear, buscar, filtrar, editar y archivar", async ({ browser }) => {
  const page = await newPage(browser);
  await login(page, userA.email, userA.final);
  await page.getByRole("navigation").getByRole("link", { name: "Ejercicios" }).click();
  await expect(page.getByRole("heading", { name: "Ejercicios", level: 1 })).toBeVisible();

  // El botón «+ Nuevo ejercicio» se ve al entrar, antes de la búsqueda y los filtros.
  const nuevoBtn = page.locator(".catalog-head").getByRole("button", { name: "Nuevo ejercicio" });
  await expect(nuevoBtn).toBeInViewport();
  const btnBox = (await nuevoBtn.boundingBox())!;
  const searchBox = (await page.getByLabel("Buscar ejercicio").boundingBox())!;
  expect(btnBox.y).toBeLessThan(searchBox.y);
  await expect(catalogRow(page, "Press de banca")).toContainText("Pecho");
  await expect(catalogRow(page, "Dominadas")).toContainText("Espalda");
  await shot(page, "11a-ejercicios");

  // Crear al entrar; la lista se actualiza y aparece una confirmación breve.
  let sheet = await openNewExercise(page);
  await expect(sheet.getByLabel("Grupo muscular").locator("option")).toHaveCount(18); // 17 grupos + «Selecciona un grupo»
  await shot(page, "11b-panel-nuevo");
  await sheet.getByRole("button", { name: "Cancelar" }).click();
  await createInCatalog(page, "Curl de bíceps", "Bíceps");
  await expect(catalogRow(page, "Curl de bíceps")).toContainText("Bíceps");

  // Búsqueda al escribir (sin pulsar «Buscar»), por nombre o grupo, y botón para limpiar.
  await page.getByLabel("Buscar ejercicio").fill("biceps");
  await expect(page.locator(".catalog-list li")).toHaveCount(1);
  await expect(page.locator(".catalog-list")).toContainText("Curl de bíceps");
  await page.getByRole("button", { name: "Limpiar búsqueda" }).click();
  await expect(page.getByLabel("Buscar ejercicio")).toHaveValue("");
  await expect(page.locator(".catalog-list li")).toHaveCount(4);

  // Búsqueda sin coincidencias → «Limpiar filtros».
  await page.getByLabel("Buscar ejercicio").fill("zzzz");
  await expect(page.getByText("Ningún ejercicio coincide con los filtros.")).toBeVisible();
  await page.getByRole("button", { name: "Limpiar filtros" }).click();
  await expect(page.locator(".catalog-list li")).toHaveCount(4);

  // Filtro «Pecho»: solo sus ejercicios; el formulario precarga Pecho y permite cambiarlo.
  const filtros = page.getByRole("group", { name: "Filtrar por grupo muscular" });
  await expect(filtros.getByRole("button", { name: "Todos", exact: true })).toHaveAttribute("aria-pressed", "true");
  await filtros.getByRole("button", { name: "Pecho", exact: true }).click();
  await expect(filtros.getByRole("button", { name: "Pecho", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page).toHaveURL(/grupo=pecho/);
  await expect(page.locator(".catalog-list li")).toHaveCount(2);
  sheet = await openNewExercise(page);
  await expect(sheet.getByLabel("Grupo muscular")).toHaveValue("pecho");
  await sheet.getByLabel("Grupo muscular").selectOption({ label: "Hombros" });
  await expect(sheet.getByLabel("Grupo muscular")).toHaveValue("hombros");

  // Grupo vacío: se rechaza y se conservan los campos.
  await sheet.getByLabel("Nombre").fill("Elevaciones laterales");
  await sheet.getByLabel("Grupo muscular").selectOption("");
  await sheet.getByRole("button", { name: "Crear ejercicio" }).click();
  await expect(sheet.getByText("Selecciona un grupo muscular")).toBeVisible();
  await expect(sheet.getByLabel("Nombre")).toHaveValue("Elevaciones laterales");
  await shot(page, "11c-panel-sin-grupo");

  // Guardado con un grupo oculto por el filtro: se conservan los filtros y se ofrece «Ver ejercicio».
  await sheet.getByLabel("Grupo muscular").selectOption({ label: "Hombros" });
  await sheet.getByRole("button", { name: "Crear ejercicio" }).dblclick(); // doble toque: un solo envío
  await expect(sheet).toBeHidden();
  const toast = page.getByRole("status").filter({ hasText: "«Elevaciones laterales» creado" });
  await expect(toast).toBeVisible();
  await expect(filtros.getByRole("button", { name: "Pecho", exact: true })).toHaveAttribute("aria-pressed", "true");
  await toast.getByRole("button", { name: "Ver ejercicio" }).click();
  await expect(filtros.getByRole("button", { name: "Hombros", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(catalogRow(page, "Elevaciones laterales")).toHaveCount(1);
  await expect(catalogRow(page, "Elevaciones laterales")).toHaveAttribute("data-highlight", "true");

  // Editar tocando toda la fila.
  await filtros.getByRole("button", { name: "Todos", exact: true }).click();
  await catalogRow(page, "Dominadas").getByRole("button").click();
  sheet = page.getByRole("dialog", { name: "Editar ejercicio" });
  await expect(sheet.getByLabel("Nombre")).toHaveValue("Dominadas");
  await expect(sheet.getByLabel("Grupo muscular")).toHaveValue("espalda");
  await sheet.getByLabel("Nombre").fill("Dominadas pronas");
  await sheet.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByRole("status").filter({ hasText: "Cambios guardados" })).toBeVisible();
  await expect(catalogRow(page, "Dominadas pronas")).toHaveCount(1);
  await page.reload();
  await catalogRow(page, "Dominadas pronas").getByRole("button").click();
  await sheet.getByLabel("Nombre").fill("Dominadas");
  await sheet.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(sheet).toBeHidden();

  // Archivar y restaurar.
  await catalogRow(page, "Curl de bíceps").getByRole("button").click();
  await sheet.getByRole("button", { name: "Archivar ejercicio" }).click();
  await expect(page.getByRole("status").filter({ hasText: "«Curl de bíceps» archivado" })).toBeVisible();
  await expect(catalogRow(page, "Curl de bíceps")).toHaveCount(0);
  const vista = page.getByRole("group", { name: "Vista" });
  await vista.getByRole("button", { name: /Archivados/ }).click();
  await expect(vista.getByRole("button", { name: /Archivados/ })).toHaveAttribute("aria-pressed", "true");
  await expect(catalogRow(page, "Curl de bíceps")).toHaveCount(1);
  await catalogRow(page, "Curl de bíceps").getByRole("button").click();
  await sheet.getByRole("button", { name: "Restaurar ejercicio" }).click();
  await expect(page.getByRole("status").filter({ hasText: "«Curl de bíceps» restaurado" })).toBeVisible();
  await vista.getByRole("button", { name: /Activos/ }).click();
  await expect(catalogRow(page, "Curl de bíceps")).toHaveCount(1);
  await page.reload();
  await expect(catalogRow(page, "Curl de bíceps")).toHaveCount(1);

  // Lista larga: el encabezado sigue visible al desplazarse y permite crear desde abajo.
  for (let i = 1; i <= 12; i++) await createInCatalog(page, `Cardio ${String(i).padStart(2, "0")}`, "Cardio");
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(nuevoBtn).toBeInViewport();
  await createInCatalog(page, "Creado al final", "Pantorrillas");

  // La navegación inferior no tapa la última fila.
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(300);
  const lastRow = (await page.locator(".catalog-list li").last().boundingBox())!;
  const nav = (await page.getByRole("navigation", { name: "Navegación principal" }).boundingBox())!;
  expect(lastRow.y + lastRow.height).toBeLessThanOrEqual(nav.y);
  await shot(page, "11d-lista-larga");
  await page.context().close();
});

test("cuenta A: panel de ejercicio a 375 px con el teclado abierto", async ({ browser }) => {
  // Teclado abierto en un iPhone de 375 × 812: queda ~400 px de área visible.
  const context = await browser.newContext({ viewport: { width: 375, height: 400 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const page = await context.newPage();
  await login(page, userA.email, userA.final);
  await page.goto("/ejercicios?grupo=pecho");
  const sheet = await openNewExercise(page);
  for (const campo of ["Nombre", "Grupo muscular", "Notas (opcional)"]) {
    const el = sheet.getByLabel(campo);
    await el.scrollIntoViewIfNeeded();
    await expect(el).toBeInViewport();
  }
  const save = sheet.getByRole("button", { name: "Crear ejercicio" });
  await expect(save).toBeInViewport({ ratio: 1 });
  const box = (await save.boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(400);
  // Nada tapa el botón (ni la navegación inferior).
  const encima = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.textContent ?? "", {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
  });
  expect(encima).toContain("Crear ejercicio");
  await sheet.getByLabel("Nombre").fill("Press inclinado");
  await sheet.getByLabel("Notas (opcional)").fill("Banco a 30°");
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/11e-375-teclado.png` });
  await save.click();
  await expect(sheet).toBeHidden();
  await expect(catalogRow(page, "Press inclinado")).toContainText("Pecho");
  await context.close();
});

test("cuenta A: corrige una sesión anterior desde el historial", async ({ browser }) => {
  const page = await newPage(browser);
  await login(page, userA.email, userA.final);
  await page.getByRole("navigation").getByRole("link", { name: "Historial" }).click();
  await expect(page.locator(".list > li")).toHaveCount(2);
  await shot(page, "10-historial");
  await page.locator(`a[href="/sesiones/${sessionA1}"]`).click();
  await expand(page, "Press de banca");
  await setSet(page, "Press de banca", 2, "46,25", "9");
  await page.getByRole("button", { name: "Quitar serie 3 de Press de banca" }).click();
  await saved(page);
  await page.reload();
  await expand(page, "Press de banca");
  await expect(page.getByLabel("Peso serie 2 de Press de banca", { exact: false })).toHaveValue("46,25");
  await expect(page.getByLabel("Peso serie 3 de Press de banca", { exact: false })).toHaveValue("42,5");
  await expect(page.getByLabel("Peso serie 4 de Press de banca", { exact: false })).toHaveCount(0);
  await page.context().close();
});

test("cuenta A: Progreso: lista, detalle, métricas, rangos y correcciones", async ({ browser }) => {
  const page = await newPage(browser);
  await login(page, userA.email, userA.final);

  // Sesión 1 (hace 10 días): Remo 40 kg × 10, 10, 8.
  await page.getByRole("link", { name: "Registrar entrenamiento" }).click();
  await page.getByLabel("Fecha del entrenamiento").fill(isoDaysAgo(10));
  await addExercise(page, "Remo con barra", { create: true, muscle: "Espalda" });
  const remo = page.getByRole("region", { name: "Remo con barra" });
  await remo.getByLabel("Repeticiones por serie de Remo con barra").fill("10");
  await remo.getByLabel("Peso por serie de Remo con barra", { exact: false }).fill("40");
  await remo.getByRole("button", { name: "Agregar 3 series" }).click();
  await page.getByLabel("Repeticiones serie 3 de Remo con barra").fill("8");
  await saved(page);

  // Sesión 2 (hace 5 días): copia de la anterior (40 × 10, 10, 8).
  await page.goto("/entrenar");
  await page.getByLabel("Fecha del entrenamiento").fill(isoDaysAgo(5));
  await addExercise(page, "Remo con barra");
  await remo.getByRole("button", { name: "Copiar última sesión" }).click();
  await saved(page);
  const session2 = page.url().split("/").pop()!;

  // Lista: búsqueda + grupo combinados; orden por última sesión.
  await page.getByRole("navigation").getByRole("link", { name: "Progreso" }).click();
  const conRegistros = page.getByRole("list", { name: "Ejercicios con registros" });
  await expect(conRegistros.locator("li strong")).toHaveText(["Press de banca", "Remo con barra", "Dominadas"]);
  await expect(conRegistros.locator("li").filter({ hasText: "Press de banca" })).toContainText("45 kg × 6");
  await expect(conRegistros.locator("li").filter({ hasText: "Dominadas" })).toContainText("Primer registro");
  await page.getByLabel("Buscar ejercicio").fill("remo");
  await page.getByRole("group", { name: "Filtrar por grupo muscular" }).getByRole("button", { name: "Espalda", exact: true }).click();
  await expect(conRegistros.locator("li")).toHaveCount(1);
  const filaRemo = conRegistros.locator("li").filter({ hasText: "Remo con barra" });
  await expect(filaRemo).toContainText("Espalda");
  await expect(filaRemo).toContainText("40 kg × 10");
  await expect(filaRemo).toContainText("Sin cambio en peso máximo");
  await shot(page, "12a-progreso-lista");

  // Detalle: indicadores y métrica «Reps totales» (28 y 28 antes de corregir).
  await filaRemo.getByRole("link").click();
  await expect(page.getByRole("heading", { name: "Remo con barra", level: 1 })).toBeVisible();
  const resumen = page.getByRole("region", { name: "Resumen del período" });
  await expect(resumen).toContainText("Última sesión");
  await expect(resumen).toContainText("40 kg × 10");
  await expect(resumen).toContainText("Sin cambio en peso máximo");
  await expect(resumen).toContainText("Sesiones del período");
  const metrica = page.getByRole("group", { name: "Métrica de la gráfica" });
  await expect(metrica.getByRole("button", { name: "Peso máximo" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("img", { name: /Peso máximo por sesión.*Máximo 40 kg/ })).toBeVisible();
  await metrica.getByRole("button", { name: "Reps totales" }).click();
  await expect(page.getByRole("img", { name: /Repeticiones totales por sesión.*Máximo 28 reps/ })).toBeVisible();

  // Corregir la sesión 2 desde «Ver sesión»: 40 × 10, 10, 10 → 30 reps totales.
  await page.locator(`a[href="/sesiones/${session2}"]`).click();
  await expand(page, "Remo con barra");
  await page.getByLabel("Repeticiones serie 3 de Remo con barra").fill("10");
  await saved(page);
  await page.goto("/progreso");
  await page.getByLabel("Buscar ejercicio").fill("remo");
  await conRegistros.locator("li").filter({ hasText: "Remo con barra" }).getByRole("link").click();
  await page.getByRole("group", { name: "Métrica de la gráfica" }).getByRole("button", { name: "Reps totales" }).click();
  await expect(page.getByRole("img", { name: /Repeticiones totales por sesión.*Máximo 30 reps/ })).toBeVisible();
  await expect(resumen).toContainText("Sin cambio en peso máximo");
  // Tocar el último punto muestra fecha, valor, unidad y series que aportan.
  await page.locator(".chart rect[fill=transparent]").last().dispatchEvent("pointerdown");
  const tooltip = page.locator("figure [role=status]");
  await expect(tooltip).toContainText("30 reps");
  await expect(tooltip).toContainText("3 series");
  const historial = page.getByRole("region", { name: "Series por fecha" });
  await expect(historial.locator(".history-item").first()).toContainText("30 reps totales");
  await expect(historial.locator(".history-item").nth(1)).toContainText("28 reps totales");
  await shot(page, "12b-progreso-detalle");

  // Sesión 3, el mismo día que la 2: 42,5 kg × 6 → un punto por sesión y «+2,5 kg».
  await page.goto("/entrenar");
  await page.getByLabel("Fecha del entrenamiento").fill(isoDaysAgo(5));
  await addExercise(page, "Remo con barra");
  await remo.getByLabel("Cantidad de series de Remo con barra").fill("1");
  await remo.getByLabel("Repeticiones por serie de Remo con barra").fill("6");
  await remo.getByLabel("Peso por serie de Remo con barra", { exact: false }).fill("42,5");
  await remo.getByRole("button", { name: "Agregar 1 serie" }).click();
  await saved(page);
  await page.goto("/progreso?q=remo&grupo=espalda");
  await expect(filaRemo).toContainText("42,5 kg × 6");
  await expect(filaRemo).toContainText("+2,5 kg vs. sesión anterior");
  await filaRemo.getByRole("link").click();
  await expect(resumen).toContainText("42,5 kg × 6");
  await expect(resumen).toContainText("+2,5 kg vs. sesión anterior");
  await expect(page.getByRole("img", { name: /3 sesiones/ })).toBeVisible();
  await expect(historial.locator(".history-item")).toHaveCount(3);
  await expect(historial.getByText("sesión 2 de 2")).toBeVisible();
  await expect(historial.getByText("sesión 1 de 2")).toBeVisible();

  // Rangos: «30 días» incluye todo; un rango personalizado vacío ofrece ampliar el período.
  const periodo = page.getByRole("group", { name: "Período" });
  await periodo.getByRole("button", { name: "30 días" }).click();
  await expect(historial.locator(".history-item")).toHaveCount(3);
  await periodo.getByRole("button", { name: "Personalizado" }).click();
  await page.getByLabel("Desde").fill(isoDaysAgo(40));
  await page.getByLabel("Hasta").fill(isoDaysAgo(30));
  await expect(page.getByText(/No hay sesiones entre/)).toBeVisible();
  await shot(page, "12c-progreso-rango-vacio");
  await page.getByRole("button", { name: "Ver todo el historial" }).click();
  await expect(historial.locator(".history-item")).toHaveCount(3);

  // Cambiar de métrica y volver al listado conservando búsqueda y grupo.
  await page.getByRole("group", { name: "Métrica de la gráfica" }).getByRole("button", { name: "Reps totales" }).click();
  await page.getByRole("link", { name: "‹ Progreso" }).click();
  await expect(page).toHaveURL(/\/progreso\?q=remo&grupo=espalda$/);
  await expect(page.getByLabel("Buscar ejercicio")).toHaveValue("remo");
  await expect(page.getByRole("group", { name: "Filtrar por grupo muscular" }).getByRole("button", { name: "Espalda", exact: true })).toHaveAttribute("aria-pressed", "true");

  // Peso corporal: «Mejor serie» y «Reps totales».
  await page.goto("/progreso");
  await conRegistros.locator("li").filter({ hasText: "Dominadas" }).getByRole("link").click();
  await expect(page.getByRole("group", { name: "Métrica de la gráfica" }).getByRole("button")).toHaveText(["Mejor serie", "Reps totales"]);
  await expect(resumen).toContainText("10 reps");
  await expect(resumen).toContainText("Primer registro");
  await expect(page.getByRole("img", { name: /Mejor serie por sesión/ })).toBeVisible();

  // Renombrar y archivar conservan el historial.
  await page.goto("/ejercicios");
  await catalogRow(page, "Remo con barra").getByRole("button").click();
  const sheet = page.getByRole("dialog", { name: "Editar ejercicio" });
  await sheet.getByLabel("Nombre").fill("Remo con barra pronado");
  await sheet.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(sheet).toBeHidden();
  await catalogRow(page, "Remo con barra pronado").getByRole("button").click();
  await sheet.getByRole("button", { name: "Archivar ejercicio" }).click();
  await expect(sheet).toBeHidden();
  await page.goto("/progreso");
  await page.getByText(/^Archivados \(/).click();
  const archivados = page.getByRole("list", { name: "Ejercicios archivados" });
  await expect(archivados.locator("li").filter({ hasText: "Remo con barra pronado" })).toContainText("+2,5 kg vs. sesión anterior");
  await archivados.locator("li").filter({ hasText: "Remo con barra pronado" }).getByRole("link").click();
  await expect(page.getByText("Archivado", { exact: true })).toBeVisible();
  await expect(historial.locator(".history-item")).toHaveCount(3);
  await page.context().close();
});

/**
 * Editor de sesión: agregar un ejercicio, encontrar su tarjeta abierta, registrar tres
 * series, cerrarla y leer el resumen; guardado al recargar; peso corporal; quitar un
 * ejercicio con series; encabezado fijo; últimos controles accesibles.
 */
async function editorFlow(page: Page, suffix: string, mobile: boolean) {
  const sentadilla = `Sentadilla goblet ${suffix}`;
  const fondos = `Fondos ${suffix}`;
  await page.goto("/entrenar");
  const head = page.locator(".session-head");
  await expect(head.getByRole("heading", { name: "Sesión de entrenamiento" })).toBeVisible();
  await expect(head.getByRole("button", { name: "Finalizar sesión" })).toBeVisible();
  await expect(head.getByLabel("Fecha del entrenamiento")).toHaveValue(isoDaysAgo(0));
  await head.getByLabel("Fecha del entrenamiento").fill(isoDaysAgo(1));
  await expect(head.locator(".date-control-text")).toContainText(String(Number(isoDaysAgo(1).slice(8))));

  // Agregar: la tarjeta queda abierta y a la vista, sin abrir el teclado.
  await addExercise(page, sentadilla, { create: true, muscle: "Cuádriceps" });
  const card = page.getByRole("region", { name: sentadilla });
  await expect(page.getByRole("button", { name: `Colapsar ${sentadilla}` })).toHaveAttribute("aria-expanded", "true");
  await expect(card).toBeInViewport();
  expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe("INPUT");

  // Tres series: 20 kg × 10, 10 y 8.
  await card.getByLabel(`Repeticiones por serie de ${sentadilla}`).fill("10");
  await card.getByLabel(`Peso por serie de ${sentadilla}`, { exact: false }).fill("20");
  await card.getByRole("button", { name: "Agregar 3 series" }).click();
  await page.getByLabel(`Repeticiones serie 3 de ${sentadilla}`).fill("8");
  await saved(page);

  // Cerrar y leer el resumen.
  await page.getByRole("button", { name: `Colapsar ${sentadilla}` }).click();
  await expect(page.getByRole("button", { name: `Expandir ${sentadilla}` })).toHaveAttribute("aria-expanded", "false");
  await expect(card.locator(".ex-summary")).toHaveText("3 series · Mejor serie: 20 kg × 10");
  await expect(card.getByLabel(/^Peso serie/)).toHaveCount(0);

  // Peso corporal: al agregarlo, el anterior queda cerrado y el nuevo abierto.
  await addExercise(page, fondos, { create: true, muscle: "Tríceps" });
  const cardFondos = page.getByRole("region", { name: fondos });
  await expect(cardFondos).toBeInViewport();
  await cardFondos.getByLabel("Cantidad de series de " + fondos).fill("2");
  await cardFondos.getByLabel(`Repeticiones por serie de ${fondos}`).fill("12");
  await cardFondos.getByRole("button", { name: "Agregar 2 series" }).click();
  await page.getByRole("button", { name: `Colapsar ${fondos}` }).click();
  await expect(cardFondos.locator(".ex-summary")).toHaveText("2 series · Mejor serie: 12 reps");

  // Notas con vista previa.
  await page.getByText("Notas de la sesión").click();
  await page.getByPlaceholder("Cómo te sentiste, molestias, etc.").fill("Buena energía hoy");
  await page.getByText("Notas de la sesión").click();
  await expect(page.locator(".notes-preview")).toHaveText("Buena energía hoy");
  await saved(page);
  // Guardar no vuelve a montar el editor: no aparece el aviso de recuperación ni se reabren tarjetas.
  await expect(page.getByText("Recuperamos cambios")).toHaveCount(0);
  await expect(page.getByRole("button", { name: `Expandir ${sentadilla}` })).toBeVisible();
  await shot(page, `13-editor-${suffix}`);

  // Recargar: todo se conserva (al entrar, todas las tarjetas están cerradas).
  await page.reload();
  await expect(card.locator(".ex-summary")).toHaveText("3 series · Mejor serie: 20 kg × 10");
  await expand(page, sentadilla);
  await expect(page.getByLabel(`Repeticiones serie 3 de ${sentadilla}`)).toHaveValue("8");

  // El encabezado fijo sigue visible al desplazar.
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(head.getByRole("button", { name: "Finalizar sesión" })).toBeInViewport();

  // Quitar de la sesión un ejercicio con series: menú de la tarjeta y confirmación.
  let mensaje = "";
  page.once("dialog", async (d) => {
    mensaje = d.message();
    await d.accept();
  });
  await page.getByRole("button", { name: `Acciones de ${fondos}` }).click();
  await page.getByRole("menuitem", { name: "Quitar de la sesión" }).click();
  expect(mensaje).toContain("Se descartarán sus 2 series registradas");
  await expect(cardFondos).toHaveCount(0);
  await saved(page);
  await page.reload();
  await expect(page.getByRole("region", { name: fondos })).toHaveCount(0);
  await expect(page.getByRole("region", { name: sentadilla })).toHaveCount(1);
  // El ejercicio sigue en el catálogo.
  await page.getByRole("button", { name: "Agregar ejercicio", exact: true }).click();
  await page.getByRole("dialog").getByLabel("Buscar ejercicio").fill(fondos);
  await expect(page.getByRole("dialog").getByRole("listitem")).toHaveCount(1);
  await page.getByRole("dialog").getByRole("button", { name: "Cerrar" }).click();

  // Los últimos controles quedan por encima de la barra inferior en móvil.
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(300);
  const ultimo = (await page.getByRole("button", { name: "Eliminar sesión" }).boundingBox())!;
  if (mobile) {
    const nav = (await page.getByRole("navigation", { name: "Navegación principal" }).boundingBox())!;
    expect(ultimo.y + ultimo.height).toBeLessThanOrEqual(nav.y);
  } else {
    expect(ultimo.y + ultimo.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  }
  await shot(page, `13-editor-${suffix}-final`);

  await page.getByRole("button", { name: "Finalizar sesión" }).click();
  await expect(page).toHaveURL(/\/historial$/);
}

test("cuenta A: editor de sesión en escritorio", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await login(page, userA.email, userA.final);
  await editorFlow(page, "escritorio", false);
  await context.close();
});

test("cuenta A: editor de sesión a 375 px", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const page = await context.newPage();
  await login(page, userA.email, userA.final);
  await editorFlow(page, "movil", true);
  await context.close();
});

test("cuenta B no accede a los datos de A, ni por URL directa", async ({ browser }) => {
  const page = await newPage(browser);
  await login(page, userB.email, userB.temp);
  await page.getByLabel("Nueva contraseña", { exact: true }).fill(userB.final);
  await page.getByLabel("Repite la nueva contraseña").fill(userB.final);
  await page.getByRole("button", { name: "Guardar contraseña" }).click();
  await expect(page).toHaveURL(/\/$/);

  await page.goto("/ejercicios");
  await expect(page.getByText("Tu catálogo está vacío.")).toBeVisible();
  await expect(page.locator(".empty").getByRole("button", { name: "Nuevo ejercicio" })).toBeVisible();
  await page.goto("/historial");
  await expect(page.getByText("Aún no tienes sesiones registradas.")).toBeVisible();
  for (const url of [`/sesiones/${sessionA1}`, `/progreso/${pressId}`, `/ejercicios/${pressId}`]) {
    await page.goto(url);
    await expect(page.getByRole("heading", { name: "No encontrado" })).toBeVisible();
  }
  await shot(page, "11-b-sin-acceso");
  await page.context().close();
});

test("desactivar la cuenta A corta su sesión abierta", async ({ browser }) => {
  const pageA = await newPage(browser);
  await login(pageA, userA.email, userA.final);
  await expect(pageA).toHaveURL(/\/$/);

  const admin = await newPage(browser);
  await login(admin, ADMIN_EMAIL, ADMIN_PASSWORD);
  await admin.goto("/admin");
  const account = admin.getByTestId("account").filter({ hasText: userA.email });
  await account.getByText("Gestionar").click();
  await account.getByRole("button", { name: "Desactivar cuenta" }).click();
  await expect(account.getByText("Desactivada", { exact: true })).toBeVisible();

  await pageA.goto("/historial");
  await expect(pageA).toHaveURL(/\/login\?motivo=desactivada$/);
  await expect(pageA.getByText("Tu cuenta está desactivada")).toBeVisible();
  await login(pageA, userA.email, userA.final, false);
  await expect(pageA.locator(".alert[role=alert]")).toContainText("desactivada");
  await shot(pageA, "12-desactivada");

  // Reactivar devuelve el acceso con sus datos.
  await admin.reload();
  const again = admin.getByTestId("account").filter({ hasText: userA.email });
  await again.getByText("Gestionar").click();
  await again.getByRole("button", { name: "Activar cuenta" }).click();
  await expect(again.getByText("Activa", { exact: true })).toBeVisible();
  await login(pageA, userA.email, userA.final);
  await pageA.goto("/historial");
  await expect(pageA.locator(".list > li").filter({ hasText: "Press de banca" })).toHaveCount(2);
  await pageA.context().close();
  await admin.context().close();
});

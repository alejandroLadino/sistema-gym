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

async function addExercise(page: Page, name: string, opts: { create?: boolean; muscle?: string } = {}) {
  await page.getByRole("button", { name: "Agregar ejercicio" }).click();
  const dialog = page.getByRole("dialog", { name: "Agregar ejercicio" });
  await dialog.getByLabel("Buscar o escribir un ejercicio nuevo").fill(name);
  if (opts.create) {
    if (opts.muscle) await dialog.getByLabel("Grupo muscular (opcional)").selectOption({ label: opts.muscle });
    await dialog.getByRole("button", { name: `Crear «${name}»` }).click();
  } else {
    await dialog.getByRole("listitem").filter({ hasText: name }).first().click();
  }
  await expect(dialog).toBeHidden();
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
  await expect(page.getByRole("button", { name: "Expandir Press de banca" })).toHaveText("Press de banca");
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
  await expect(page.getByLabel("Repeticiones serie 2 de Dominadas")).toHaveValue("8");
  // Doble toque en Guardar: idempotente.
  const guardar = page.getByRole("button", { name: "Guardar", exact: true });
  if (await guardar.isVisible()) await guardar.dblclick().catch(() => {});
  await saved(page);
  await shot(page, "05-sesion-guardada");

  await page.reload();
  // Al abrir una sesión con varios ejercicios, solo el último queda abierto.
  await expect(page.getByRole("button", { name: "Expandir Press de banca" })).toBeVisible();
  await expand(page, "Press de banca");
  await expect(page.getByLabel("Peso serie 4 de Press de banca", { exact: false })).toHaveValue("42,5");
  await expect(page.getByLabel("Repeticiones serie 2 de Dominadas")).toHaveValue("8");
  await expect(page.getByLabel("Peso serie 1 de Dominadas", { exact: false })).toHaveValue("");
  await expect(page.getByLabel("Peso serie 2 de Dominadas", { exact: false })).toHaveValue("");

  await page.getByRole("button", { name: "Terminar" }).click();
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
  await expect(page.getByLabel("Peso serie 4 de Press de banca", { exact: false })).toHaveValue("45");
  await expect(page.getByLabel("Repeticiones serie 3 de Press de banca")).toHaveValue("8");
  await shot(page, "07-sesion-nueva");

  // Progreso: dos sesiones y gráfica.
  await page.getByRole("navigation").getByRole("link", { name: "Progreso" }).click();
  await page.getByRole("link", { name: /Press de banca/ }).click();
  await expect(page).toHaveURL(/\/progreso\/[0-9a-f-]{36}/);
  pressId = page.url().split("/").pop()!.split("?")[0];
  await expect(page.getByRole("img", { name: /Peso máximo por sesión/ })).toBeVisible();
  await expect(page.locator("table.data tbody tr")).toHaveCount(2);
  await expect(page.locator("table.data")).toContainText("42,5 kg × 6");
  await expect(page.locator("table.data")).toContainText("45 kg × 6");
  await shot(page, "08-progreso");

  // Filtro por fechas: solo la sesión antigua.
  await page.getByLabel("Hasta").fill(isoDaysAgo(3));
  await page.getByRole("button", { name: "Filtrar" }).click();
  await expect(page.locator("table.data tbody tr")).toHaveCount(1);

  // Peso corporal: se muestran repeticiones.
  await page.goto("/progreso");
  await page.getByRole("link", { name: /Dominadas/ }).click();
  await expect(page.getByRole("img", { name: /Repeticiones máximas/ })).toBeVisible();
  await expect(page.locator("table.data")).toContainText("10 reps");
  await expect(page.locator("table.data")).toContainText("18 reps");
  await shot(page, "09-progreso-peso-corporal");
  await page.context().close();
});

test("cuenta A: grupos musculares del catálogo, búsqueda y filtro", async ({ browser }) => {
  const page = await newPage(browser);
  await login(page, userA.email, userA.final);
  await page.getByRole("navigation").getByRole("link", { name: "Ejercicios" }).click();
  await expect(page.getByRole("heading", { name: "Ejercicios", level: 1 })).toBeVisible();

  // Los grupos elegidos al crear el ejercicio aparecen con el nombre del catálogo.
  await expect(page.locator(".list .card").filter({ hasText: "Press de banca" })).toContainText("Pecho");
  await expect(page.locator(".list .card").filter({ hasText: "Dominadas" })).toContainText("Espalda");

  // El formulario de nuevo ejercicio ofrece solo la lista predefinida.
  const nuevo = page.locator("section").filter({ has: page.getByRole("heading", { name: "Nuevo ejercicio" }) });
  const select = nuevo.getByLabel("Grupo muscular");
  await expect(select.locator("option")).toHaveCount(18); // 17 grupos + «Sin grupo muscular»
  await nuevo.getByLabel("Nombre").fill("Curl de bíceps");
  await select.selectOption({ label: "Bíceps" });
  await nuevo.getByRole("button", { name: "Crear ejercicio" }).click();
  await expect(nuevo.getByText("«Curl de bíceps» agregado")).toBeVisible();
  await expect(page.locator(".list .card").filter({ hasText: "Curl de bíceps" })).toContainText("Bíceps");

  // Buscar por el nombre del grupo, en minúsculas y sin tilde.
  await page.getByRole("searchbox", { name: "Buscar" }).fill("biceps");
  await page.getByRole("button", { name: "Buscar" }).click();
  await expect(page.locator(".list > li")).toHaveCount(1);
  await expect(page.locator(".list")).toContainText("Curl de bíceps");

  // Filtrar por grupo.
  await page.goto("/ejercicios");
  await page.getByRole("search").getByLabel("Grupo muscular").selectOption({ label: "Espalda" });
  await page.getByRole("button", { name: "Buscar" }).click();
  await expect(page).toHaveURL(/grupo=espalda/);
  await expect(page.locator(".list > li")).toHaveCount(1);
  await expect(page.locator(".list")).toContainText("Dominadas");
  await shot(page, "09b-ejercicios-filtro-grupo");

  // Cambiar el grupo de un ejercicio desde su ficha.
  await page.locator(".list").getByRole("link", { name: /Dominadas/ }).click();
  await expect(page.getByRole("heading", { name: "Dominadas", level: 1 })).toBeVisible();
  await page.getByLabel("Grupo muscular").selectOption({ label: "Bíceps" });
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(page.getByText("Cambios guardados.")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Grupo muscular")).toHaveValue("biceps");
  await page.getByLabel("Grupo muscular").selectOption({ label: "Espalda" });
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(page.getByText("Cambios guardados.")).toBeVisible();
  await page.context().close();
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

test("cuenta B no accede a los datos de A, ni por URL directa", async ({ browser }) => {
  const page = await newPage(browser);
  await login(page, userB.email, userB.temp);
  await page.getByLabel("Nueva contraseña", { exact: true }).fill(userB.final);
  await page.getByLabel("Repite la nueva contraseña").fill(userB.final);
  await page.getByRole("button", { name: "Guardar contraseña" }).click();
  await expect(page).toHaveURL(/\/$/);

  await page.goto("/ejercicios");
  await expect(page.getByText("Tu catálogo está vacío.")).toBeVisible();
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
  await expect(pageA.locator(".list > li")).toHaveCount(2);
  await pageA.context().close();
  await admin.context().close();
});

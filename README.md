# SISTEMA GYM

Aplicación web (en español, pensada para el celular) para registrar entrenamientos,
reutilizar ejercicios y consultar el progreso. Requisitos en [`CLAUDE.md`](CLAUDE.md).

- **Next.js 16** (App Router, Server Components y Server Actions) + TypeScript
- **Supabase Auth** para el acceso y **Postgres** con Row Level Security para los datos

## Requisitos

- Node.js 20 o superior y npm
- Un proyecto de Supabase: en la nube ([supabase.com](https://supabase.com)) o local
  con la [Supabase CLI](https://supabase.com/docs/guides/local-development) (requiere Docker)

## 1. Instalar

```bash
npm install
```

## 2. Variables de entorno

Copia el ejemplo y completa los valores (Supabase → *Project Settings → API*,
o la salida de `npx supabase start` en local):

```bash
cp .env.example .env.local
```

| Variable | Dónde se usa | Descripción |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | navegador y servidor | URL del proyecto |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | navegador y servidor | clave pública (anon / publishable) |
| `SUPABASE_SERVICE_ROLE_KEY` | **solo servidor** | clave `service_role` (secret) para administrar cuentas |

`SUPABASE_SERVICE_ROLE_KEY` solo se lee en `src/lib/supabase/admin.ts` (marcado
`server-only`, de modo que importarlo desde el cliente rompe la compilación) y en el
script del primer administrador. Nunca le pongas el prefijo `NEXT_PUBLIC_`.

> Next.js incrusta las variables `NEXT_PUBLIC_*` al compilar: si las cambias, vuelve a
> ejecutar `npm run build`.

## 3. Aplicar las migraciones

Las migraciones están en `supabase/migrations/`.

**Supabase en la nube**

```bash
npx supabase login
```

```bash
npx supabase link --project-ref <ID_DEL_PROYECTO>
```

```bash
npx supabase db push
```

(También puedes pegar cada archivo de `supabase/migrations/` en el *SQL Editor*, **en orden por nombre** y una sola vez cada uno.)

**Supabase local**

```bash
npx supabase start
```

`supabase start` aplica las migraciones automáticamente; para volver a empezar
desde cero usa `npx supabase db reset`.

### Migraciones en dos pasos

Algunos cambios de esquema se publican en dos pasos para que la app en producción
no falle mientras se despliega la versión nueva. El primer paso amplía el esquema;
el segundo lo contrae y su comentario inicial indica
*«Aplicar DESPUÉS de desplegar…»*:

1. Aplica las migraciones hasta la de ampliación (compatibles con la app actual).
2. Despliega la app nueva (merge a `main`).
3. Aplica la migración de contracción.

En una instalación nueva, sin datos ni app publicada, se aplican todas en orden.

### Configuración recomendada de Auth (proyecto en la nube)

- *Authentication → Sign In / Providers → Email*: desactiva **Allow new users to sign up**.
  Las cuentas se crean desde el panel de administración. Aunque alguien se registrara
  por la API, su perfil nace **inactivo** y sin acceso a datos.
- Desactiva **Secure password change** (o el cambio de contraseña temporal pedirá
  reautenticación por correo).

## 4. Crear el primer administrador

Proceso privado, desde la máquina de quien instala, con la clave `service_role`:

```bash
npm run create-admin -- --email admin@tu-gym.com --name "Nombre Apellido"
```

El script pide la contraseña por teclado (no queda en el historial de la terminal).
En un entorno sin terminal interactiva, pásala en la variable `ADMIN_PASSWORD`.
Si el correo ya existe, lo promueve a administrador, lo activa y le asigna esa contraseña.

Alternativa sin Node: crea el usuario en *Authentication → Users → Add user*
y ejecuta en el *SQL Editor*:

```sql
update public.profiles
set role = 'admin', is_active = true, must_change_password = false
where email = 'admin@tu-gym.com';
```

## 5. Arrancar

Desarrollo:

```bash
npm run dev
```

Producción:

```bash
npm run build
```

```bash
npm start
```

Abre <http://localhost:3000>. Sin sesión, siempre se muestra el login. Para probar
desde el celular en la misma red, usa `http://<IP-de-tu-PC>:3000`.

## Uso

1. El administrador entra, abre **Administración** y crea cuentas (correo, contraseña
   inicial o generada, rol). La contraseña temporal se muestra una sola vez.
2. Cada persona entra con esa contraseña y debe cambiarla antes de continuar.
3. **Registrar entrenamiento**: fecha editable (por defecto, la de hoy en el
   dispositivo), «Agregar ejercicio» busca en el catálogo o crea uno nuevo, y cada
   ejercicio muestra las series de la última sesión anterior a la fecha elegida, con
   el botón «Copiar series». «Agregar serie» repite la anterior para registrar con un toque.
   El peso admite coma o punto y hasta 2 decimales; vacío = peso corporal.
4. La sesión se autoguarda. Arriba se ve el estado: *Guardando…*, *Guardado* o
   *No se guardó* (con «Reintentar»). Lo capturado también queda en el dispositivo,
   así que recargar o perder la conexión no borra nada.
5. **Historial** (con filtro de fechas) abre cualquier sesión para corregirla o eliminarla.
6. **Progreso**: por ejercicio, series por fecha y gráfica del peso máximo por sesión
   (o de repeticiones, si es de peso corporal), con filtro de fechas.

## Seguridad y modelo de datos

| Tabla | Contenido |
|---|---|
| `profiles` | rol (`admin`/`user`), `is_active`, `must_change_password`. Solo lectura para el usuario; solo el servidor (service_role) la modifica |
| `exercises` | catálogo personal; `archived_at` para archivar sin perder historial |
| `workout_sessions` | fecha; el `id` lo genera el cliente (guardado idempotente) |
| `session_exercises` | ejercicio + posición dentro de la sesión |
| `exercise_sets` | orden, repeticiones, `weight_kg numeric(6,2)` opcional |

- **RLS** en todas las tablas de entrenamiento: solo el dueño, con la cuenta **activa**
  y sin contraseña temporal pendiente. Se evalúa en cada consulta, así que
  desactivar una cuenta corta el acceso de inmediato aunque su sesión siga abierta.
  Además, el panel bloquea a la persona en Supabase Auth para que no pueda volver a
  entrar ni renovar su token.
- Las claves foráneas compuestas `(id, user_id)` impiden mezclar datos de dos
  personas incluso a nivel de base de datos.
- El administrador **no** ve los entrenamientos de otros: su panel solo gestiona cuentas.
- `src/proxy.ts` revisa en cada petición la sesión, la cuenta activa, la contraseña
  temporal y el rol. Los layouts y las Server Actions lo vuelven a comprobar.
- `save_workout_session` guarda la sesión completa en una transacción. Con el mismo
  `id`, un doble toque o un reintento actualizan en vez de duplicar.

## Comprobaciones

| Comando | Qué hace |
|---|---|
| `npm run lint` | ESLint |
| `npm run typecheck` | tipos de rutas + TypeScript |
| `npm test` | pruebas unitarias (validación, borrador, formato) |
| `npm run build` | compilación de producción |
| `npm run check` | todo lo anterior |
| `npm run test:db` | aplica las migraciones en un PostgreSQL local temporal (UTF-8, como Supabase) y prueba RLS, aislamiento, desactivación, contraseña temporal, idempotencia, decimales, historial, progreso, catálogo de grupos musculares y conversión de datos (requiere `initdb`/`pg_ctl`/`psql`; ruta con `PG_BIN`). Los archivos de `supabase/tests/ganchos/` siembran datos antes de una migración y los verifican después |
| `npm run test:e2e` | flujo completo en el navegador con ancho móvil (ver abajo) |

### Prueba de extremo a extremo

Con la app corriendo contra un proyecto con las migraciones y un administrador:

```bash
E2E_ADMIN_EMAIL=admin@tu-gym.com E2E_ADMIN_PASSWORD='...' npm run test:e2e
```

Opcionales: `E2E_BASE_URL` (por defecto `http://localhost:3000`),
`E2E_SCREENSHOT_DIR` (guarda capturas) y `PW_CHROMIUM_PATH` (Chromium ya instalado).
Si no tienes navegadores de Playwright, instálalos con `npx playwright install chromium`.
La prueba crea dos cuentas nuevas con correos `@example.com` en cada ejecución:
úsala contra un proyecto de desarrollo, no contra producción.

Cubre: alta de dos cuentas, cambio obligatorio de la contraseña temporal, registro de
Press de banca con varias series y de un ejercicio de peso corporal, fallo de red y
reintento sin duplicados, recuperación tras recargar, reutilización días después
con las series anteriores y «Copiar series», decimales, Progreso con gráfica y filtro,
corrección de una sesión anterior, que la segunda cuenta no accede a nada de la
primera ni por URL directa, desactivación con sesión abierta y reactivación.
Además comprueba que no haya scroll horizontal a 390 px de ancho.

## Estructura

```
src/
  proxy.ts                 control de acceso en cada petición
  app/
    login/, cambiar-clave/, salir/
    (app)/                 páginas privadas: inicio, entrenar, sesiones/[id],
                           ejercicios, historial, progreso, admin
    actions/               Server Actions (auth, admin, ejercicios, sesiones)
  components/              navegación, editor de sesión, selector, gráfica
  lib/                     clientes Supabase, auth, validación, borrador, formato
supabase/
  migrations/              esquema, RLS y funciones
  tests/                   pruebas SQL (con un stub local del esquema auth)
scripts/                   create-admin.mjs, test-db.sh
e2e/                       prueba Playwright del flujo completo
```

## Fuera del alcance del MVP

Plantillas de rutinas, entrenadores, membresías, pagos y planes de alimentación.

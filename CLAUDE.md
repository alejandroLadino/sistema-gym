# SISTEMA GYM

## Objetivo

Construir una aplicación web en español para registrar entrenamientos, reutilizar
ejercicios y consultar el progreso de cada persona. La experiencia principal es
registrar series desde el celular mientras la persona está entrenando.

En la primera versión, una rutina es el conjunto de ejercicios que el usuario
realizó en una sesión. Las plantillas de rutinas quedan para una fase posterior.

## Usuarios y accesos

- Administrador: crea usuarios desde un panel privado, asigna credenciales
  iniciales, restablece contraseñas y activa o desactiva cuentas.
- Usuario: registra sus sesiones, administra sus ejercicios y consulta su
  historial y progreso. Cada usuario tiene acceso exclusivamente a sus datos
  de entrenamiento.
- Si el administrador quiere registrar sus propios entrenamientos, puede hacerlo
  desde su cuenta, con el mismo aislamiento de datos que los demás usuarios.
- La pantalla inicial para quien no haya iniciado sesión es el login.
- Las cuentas se crean desde el panel de administración. El primer administrador
  se configura durante la instalación mediante un proceso privado y documentado.

## Modelo del entrenamiento

- Ejercicio: pertenece al usuario y se crea una sola vez para reutilizarlo.
  Tiene nombre y, opcionalmente, grupo muscular y notas. Se puede archivar
  sin perder su historial.
- Sesión: pertenece al usuario y tiene una fecha de entrenamiento. La fecha
  inicial es la fecha local del usuario y se puede cambiar para registrar
  entrenamientos anteriores. Se permite más de una sesión el mismo día.
- Ejercicio de la sesión: vincula la sesión con un ejercicio del catálogo
  personal y conserva su posición dentro de esa sesión.
- Serie: registra orden, repeticiones y, cuando aplica, peso en kg con
  decimales. Un ejercicio puede tener series con pesos distintos. El peso
  puede quedar vacío en ejercicios de peso corporal.

El historial y el progreso se consultan por el identificador del ejercicio.
Si el usuario cambia su nombre o lo archiva, los registros siguen vinculados.

## Flujo principal

1. El usuario entra y pulsa «Registrar entrenamiento».
2. Selecciona un ejercicio de su catálogo o lo crea desde la misma sesión.
3. Si ya lo hizo antes, ve la fecha, el peso y las repeticiones de cada serie
   de su última sesión anterior a la fecha elegida.
4. Registra sus nuevas series y puede copiar las de la sesión anterior como
   punto de partida para editarlas.
5. El entrenamiento se conserva al recargar. El usuario puede consultar y
   corregir sus sesiones después.
6. Desde «Progreso», el usuario elige un ejercicio, consulta sus series por
   fecha y ve una gráfica del peso máximo registrado en cada sesión.

Ejemplo: el jueves registro Press de banca con 40 kg × 12, 45 kg × 10 y
50 kg × 8. La siguiente semana selecciono el ejercicio existente y veo
esas tres series como referencia. Registro las nuevas y puedo consultar
ambas sesiones. Para peso corporal se muestran repeticiones en el historial.

## Experiencia y alcance

- Diseñar primero para móvil, con campos numéricos cómodos de usar y pocas
  acciones para agregar una serie. Los controles principales deben tener
  etiquetas claras y ser fáciles de tocar con una mano.
- Navegación principal: Inicio, Ejercicios, Historial y Progreso. Mostrar
  Administración solo a quien tenga ese rol.
- Mostrar con claridad si una sesión se está guardando, ya se guardó o si
  falló el guardado. Permitir reintentar sin duplicar registros.
- El MVP abarca acceso, administración de cuentas, catálogo personal de
  ejercicios, registro de sesiones, historial y progreso básico.
- Las plantillas, los entrenadores, las membresías, los pagos y los planes
  de alimentación quedan para fases posteriores.

## Idioma

- Responder siempre en español al usuario, aunque el mensaje, una herramienta o
  una página consultada estén en otro idioma.
- La interfaz, los mensajes de la app, los commits, los pull requests y la
  documentación del proyecto también se escriben en español.

## Notas técnicas (implementación)

- Next.js (App Router) + TypeScript en `src/`, Supabase Auth + Postgres.
- Migraciones en `supabase/migrations/`. Pruebas SQL de RLS en `supabase/tests/`
  (`npm run test:db`, requiere binarios locales de PostgreSQL).
- La clave `SUPABASE_SERVICE_ROLE_KEY` solo se usa en `src/lib/supabase/admin.ts`
  (marcado `server-only`). Nunca importarlo desde componentes cliente.
- Antes de entregar: `npm run check` (lint, tipos, pruebas unitarias y build).

# Roadmap — booking-platform de 0 a 100

Este documento es el plan completo para construir la plataforma desde el día cero hasta el lanzamiento. Está pensado para que Claude Code lo siga etapa por etapa, con checkpoints explícitos donde se pausa para revisar.

## Cómo usar este documento

Cada etapa tiene la misma estructura:

- **Objetivo**: qué se logra al terminar.
- **Entregables**: archivos, configuraciones o commits concretos.
- **Criterios de done**: lista de verificación. Si alguno falla, la etapa no está terminada.
- **Skills relevantes**: cuáles aplicar al trabajar.
- **Specs asociados**: si hay spec(s) que cubren la etapa.

Entre cada bloque grande de etapas hay un **checkpoint**: una parada explícita donde Claude pregunta al usuario si todo está bien o si hay algo que ajustar antes de avanzar. **No saltarse los checkpoints.**

## Convenciones del plan

- Los **specs siguen la numeración** que establecimos en spec-authoring (`0001`, `0002`, ...).
- Las **estimaciones de tiempo** son orientativas para un dev solo trabajando algunas horas al día.
- Las etapas que dicen "spec" requieren producir el documento de spec aprobado antes de codear.

---

## BLOQUE 1 — Fundación (sin código de producto)

### Etapa 0 — Pre-trabajo externo

**Objetivo**: tener las cuentas externas listas y configuradas antes de tocar código.

**Entregables**:

- Cuenta de GitHub con el repo creado (privado al inicio).
- Cuenta de Supabase con un proyecto creado para desarrollo (`booking-dev`).
- Cuenta de OnvoPay del cliente con claves de sandbox obtenidas. Producción se activa más adelante cuando se vaya a hacer go-live.
- Cuenta de Resend con API key obtenida. Dominio para email verificado (subdominio inicial: `mail.tudominio.com`).
- Cuenta de Vercel conectada al repo de GitHub.
- Cuenta de Railway con un proyecto vacío creado.
- Dominio comprado (puede esperar a etapa final si todavía no se eligió).

**Criterios de done**:

- [ ] Repo de GitHub existe y está clonable.
- [ ] Variables/keys de cada servicio guardadas localmente en un gestor de secretos.
- [ ] No hay claves commiteadas a ningún lado.
- [ ] El cliente confirmó disposición a abrir cuenta OnvoPay y dar acceso a las llaves cuando corresponda.

**Skills relevantes**: ninguna (no hay código todavía).

### Etapa 1 — Bootstrap del repo

**Objetivo**: tener el repo con el scaffold inicial (README, docs/, .claude/) committeado en `main`.

**Entregables**:

- Contenido del scaffold inicial extraído al repo.
- Carpetas vacías `web/`, `worker/`, `shared/`, `migrations/` con `.gitkeep`.
- `.gitignore` para Node.js + Next.js + ambientes.
- `LICENSE` (privado/propietario) si aplica.
- `CONTRIBUTING.md` corto apuntando a `.claude/skills/`.

**Criterios de done**:

- [ ] `main` tiene el scaffold completo.
- [ ] El README abre y se ve bien.
- [ ] Las skills y la memoria están en su carpeta correcta.
- [ ] El primer commit sigue Conventional Commits: `chore: scaffold inicial del repo`.

**Skills relevantes**: `commit-and-pr` (para el primer commit).

### Etapa 2 — Setup técnico del monorepo

**Objetivo**: dejar el entorno técnico listo para empezar a desarrollar, con tooling instalado y configurado para enforzar las convenciones.

**Entregables**:

- `web/` inicializado con Next.js 15 (App Router, TypeScript, ESLint).
- `worker/` inicializado con TypeScript y `tsx` para desarrollo, `node` para producción.
- `shared/` con `package.json` y `tsconfig.json` base.
- ESLint configurado en raíz con reglas que detectan:
  - Strings literales en contextos sospechosos (enums, comparaciones de status).
  - Números mágicos en contextos sospechosos.
  - Archivos con más de 150 líneas no-vacías-no-comentario.
  - Imports relativos largos (preferir alias).
- Prettier configurado.
- Husky + lint-staged con hook de pre-commit que corre `lint` y `typecheck` sobre archivos modificados.
- GitHub Actions: workflow que corre `lint`, `typecheck`, `test` en cada PR.
- Variables de entorno: `.env.example` en `web/` y `worker/`. Carga validada con Zod.
- Vitest configurado en `web/` y `worker/` con un test smoke que pasa.
- Script `pnpm db:migrate` (placeholder) y `pnpm db:seed` (placeholder).

**Criterios de done**:

- [ ] `cd web && pnpm dev` levanta Next.js en `localhost:3000` mostrando una página por defecto.
- [ ] `cd worker && pnpm dev` arranca un loop básico que loggea cada 30s "alive".
- [ ] `pnpm lint && pnpm typecheck && pnpm test` pasa en raíz.
- [ ] Un PR de prueba dispara el CI y aparece verde.
- [ ] El linter rechaza un archivo de >150 líneas en una prueba manual.
- [ ] El linter rechaza un `'confirmed'` literal en una comparación de status.

**Skills relevantes**: `codebase-conventions`, `commit-and-pr`.

---

### 🔍 CHECKPOINT 1 — Después de Bloque 1

Antes de continuar al desarrollo del producto, pausar y revisar con el usuario:

- ¿El tooling está cómodo o hay fricciones (linter demasiado estricto, pre-commit lento, etc.)?
- ¿Las reglas custom del linter funcionan como se esperaba en casos reales?
- ¿Falta alguna herramienta del stack (ej: un sistema de feature flags, monitoring)?
- ¿Hay algo del bootstrap que repensar antes de construir sobre eso?

Si hay ajustes, hacerlos ahora. Después de este checkpoint, modificar tooling se vuelve molesto porque rompe builds existentes.

---

## BLOQUE 2 — Modelo de datos y autenticación

### Etapa 3 — Spec y migraciones del modelo base

**Objetivo**: tener el schema base aplicado a la DB de desarrollo.

**Spec asociado**: `0001-modelo-de-datos-base`.

**Entregables**:

- Spec 0001 escrito, revisado y aprobado.
- Migraciones SQL en `migrations/` para: `users` (con roles `admin`, `staff`, `guide`), `tours`, `tour_pricing`, `tour_schedules`. Con índices, constraints, RLS, enums.
- Tipos TypeScript generados desde el schema (Supabase types).
- Constantes derivadas en `shared/constants/` (estados, roles, ticket types, currencies).
- `seed.sql` con un admin demo, un par de tours, varios schedules.
- Tests de integración básicos: crear un tour, leer, RLS funciona (un staff no puede modificar configuración de admin).

**Criterios de done**:

- [ ] Spec aprobado, changelog iniciado.
- [ ] `pnpm db:migrate` aplica todas las migraciones desde cero sin error.
- [ ] `pnpm db:seed` puebla datos demo.
- [ ] Tests de integración pasan.
- [ ] Tipos generados se importan en código sin errores.

**Skills relevantes**: `feature-workflow`, `spec-authoring`, `codebase-conventions`, `testing-practices`, `changelog-maintenance`.

### Etapa 4 — Autenticación de usuarios internos

**Objetivo**: un usuario interno (admin, staff o guía) puede hacer login y entrar al panel admin (que por ahora muestra una pantalla vacía protegida según su rol).

**Spec asociado**: `0002-autenticacion-usuarios-internos`.

**Entregables**:

- Spec 0002 aprobado.
- Páginas `/login`, `/forgot-password` en `web/app/(auth)/`.
- Layout `(admin)` que requiere sesión autenticada y carga datos del usuario y rol.
- Middleware de Next.js que redirige a `/login` cuando no hay sesión en rutas protegidas.
- Server actions para login, logout, password reset.
- Sin signup público: los usuarios internos los crea el admin desde el panel (en una etapa posterior). Para el seed inicial, el admin se crea manualmente.
- Tests de integración del flujo de auth.

**Criterios de done**:

- [ ] Spec aprobado, changelog iniciado.
- [ ] Un admin puede entrar al panel.
- [ ] Tests cubren happy path + casos de error (credenciales inválidas, sesión expirada).
- [ ] Logout limpia la sesión correctamente.
- [ ] El acceso a rutas se controla por rol (un guía no puede ver páginas de admin).

**Skills relevantes**: las mismas que la etapa 3.

---

### 🔍 CHECKPOINT 2 — Después de Bloque 2

- ¿El modelo de datos se siente correcto en la práctica? ¿Algún campo que falta o sobra?
- ¿El flujo de auth funciona bien para los usuarios internos reales?
- ¿Las migraciones son fáciles de aplicar y revertir?
- ¿Los tests están dando confianza o solo ruido?

Aquí es el último momento barato para hacer cambios estructurales al schema o al modelo de auth.

---

## BLOQUE 3 — Tours y portal público

### Etapa 5 — CRUD de tours desde el panel admin

**Objetivo**: el admin puede crear, editar, listar y archivar tours, incluyendo sus precios y schedules.

**Spec asociado**: `0003-gestion-tours-panel-admin`.

**Entregables**:

- Spec 0003 aprobado.
- Páginas `/admin/tours`, `/admin/tours/new`, `/admin/tours/[id]/edit`.
- Componentes UI para formulario de tour (bilingüe), gestión de pricing por temporada/tipo, gestión de schedules semanales.
- Server actions: createTour, updateTour, archiveTour, etc.
- Repository `tours.ts` con queries tipadas.
- Tests unit del repo, integration del flujo completo.

**Criterios de done**:

- [ ] Admin puede crear tour completo con pricing y schedules.
- [ ] Validaciones funcionan (no se puede tener pricing con rangos solapados, no se pueden poner capacidades negativas).
- [ ] Tests cubren validaciones y casos borde.
- [ ] El changelog refleja decisiones tomadas durante la implementación.

### Etapa 6 — Portal público de listado de tours

**Objetivo**: cualquier visitante puede ver los tours disponibles, filtrar por fecha, y ver el detalle de cada uno.

**Spec asociado**: `0004-portal-publico-tours`.

**Entregables**:

- Spec 0004 aprobado.
- Páginas `/`, `/tours`, `/tours/[slug]`.
- Componentes: TourCard, TourGrid, TourFilter, TourDetail.
- Generación de `tour_instances` programada (job en worker que rolea instancias para los próximos 90 días basado en schedules).
- Calendario de disponibilidad en la página de detalle (muestra fechas y horas con cupo).
- i18n base configurado (ES/EN).
- Tests unit + integration.

**Criterios de done**:

- [ ] Un visitante no autenticado ve el grid de tours.
- [ ] El detalle muestra calendario con disponibilidad real.
- [ ] Cambio de idioma funciona.
- [ ] Performance: home y detail cargan en <500ms en local.

---

### 🔍 CHECKPOINT 3 — Después de Bloque 3

- ¿Cómo se siente la UX del panel admin? ¿El cliente podría usarlo sin entrenamiento?
- ¿El portal público es atractivo? ¿La info de cada tour es suficiente?
- ¿El job de rolear tour_instances corre bien? ¿Cuántas instances se generan?
- ¿Los tests están cubriendo bien o hay agujeros visibles?

Después de este bloque tenés un sistema "navegable" pero no transaccional. Es el último checkpoint barato antes de meterse con dinero real.

---

## BLOQUE 4 — Reservas y pagos (el corazón del sistema)

### Etapa 7 — Motor de disponibilidad y holds

**Objetivo**: tener la lógica de capacidad, holds temporales y verificación de "puedo reservar X cupos" funcionando correctamente bajo concurrencia.

**Spec asociado**: `0005-motor-disponibilidad-holds`.

**Entregables**:

- Spec 0005 aprobado.
- Funciones en `lib/booking/availability.ts` para verificar disponibilidad y crear holds.
- Mecanismo de holds con expiración a 15 minutos.
- Job en worker que libera holds expirados.
- Tests de concurrencia exhaustivos (esto es **crítico**: ver casos borde obligatorios en testing-practices).

**Criterios de done**:

- [ ] Tests de concurrencia cubren el caso de "dos clientes intentan el último cupo a la vez".
- [ ] Holds expiran y se liberan correctamente.
- [ ] `capacity_reserved` nunca excede `capacity_total` bajo ningún escenario.
- [ ] Performance: verificar disponibilidad de un tour específico en <50ms.

### Etapa 8 — Flujo de reserva con pago (OnvoPay)

**Objetivo**: un turista puede reservar un tour completo, pagando con tarjeta o SINPE Móvil, sin crear cuenta.

**Spec asociado**: `0006-checkout-reserva-pago-onvopay`.

**Entregables**:

- Spec 0006 aprobado, incluyendo verificación de OnvoPay con external-services-vetting.
- Páginas `/checkout` con multi-step (datos del cliente, tickets, pago).
- Adaptador OnvoPay en `lib/payments/adapters/onvopay.ts` implementando la interfaz `PaymentProvider`.
- Lógica de negocio en `lib/payments/` desacoplada del adaptador (preparada para múltiples pasarelas).
- Payment Intent de OnvoPay creado al iniciar checkout.
- Webhook handler de OnvoPay (`/api/webhooks/onvopay`) que confirma el booking al recibir evento de pago exitoso.
- Idempotencia en webhooks (tabla `processed_webhook_events`).
- Página de confirmación con detalle de la reserva.
- Token de acceso para "ver mi reserva" (magic link).
- Tests de integración completos del flujo (con OnvoPay mockeado vía MSW).
- Tests de idempotencia de webhooks.

**Criterios de done**:

- [ ] Un turista puede completar una reserva end-to-end con tarjeta de prueba de OnvoPay (sandbox).
- [ ] La página de confirmación muestra todo correcto.
- [ ] Webhooks duplicados no causan doble confirmación (test que lo prueba).
- [ ] Si el pago falla, la reserva queda en `payment_failed` y el cupo se libera.
- [ ] SINPE Móvil también funciona en sandbox.
- [ ] La feature se siente "production-ready" en el sentido de que un usuario real podría usarla.

---

### 🔍 CHECKPOINT 4 — Después de Bloque 4 (CRÍTICO)

Este es el checkpoint más importante de todo el roadmap. Aquí pausamos por más tiempo del usual.

- **Test de carga manual**: hacer 20-50 reservas seguidas en tarjeta de prueba. ¿Pasa algo raro?
- **Test de concurrencia manual**: abrir dos navegadores e intentar reservar el último cupo a la vez. ¿Solo uno gana?
- **Revisar los logs**: ¿hay errores silenciosos? ¿hay warnings que indican problemas latentes?
- **Revisar OnvoPay Dashboard**: ¿los pagos sandbox aparecen correctos?
- **Confiabilidad de webhooks**: simular reenvíos. ¿El sistema responde idempotente?
- **Auditoría de strings mágicos y archivos grandes**: pasar el linter a fondo. ¿Apareció algún slip?
- **Revisión del changelog completo**: ¿quedaron decisiones registradas? ¿algo importante se hizo sin documentar?

Si algo no está sólido aquí, **detenerse y arreglar** antes de seguir. Las features siguientes asumen que el core de reservas es confiable.

---

## BLOQUE 5 — Notificaciones y operación

### Etapa 9 — Cola de notificaciones + recordatorio 24h

**Spec asociado**: `0007-notificaciones-recordatorio-24h`.

**Entregables**:

- Spec 0007 aprobado.
- Tabla `notifications` operativa.
- Adaptador de email (Resend) en `lib/notifications/adapters/email.ts`.
- Job del worker `send-notifications` con polling cada 60s.
- Templates de React Email para: confirmación de reserva, recordatorio 24h, recibo de pago.
- Lógica de retry con backoff exponencial.
- Tests de integración del job (incluyendo: cancelar booking debe cancelar la notificación pendiente).

**Criterios de done**:

- [ ] Reservar un tour dispara el email de confirmación inmediato.
- [ ] El email de recordatorio llega 24h antes (testeado manipulando fechas).
- [ ] Cancelar una reserva no envía el recordatorio.
- [ ] Si Resend devuelve error, hay retry; después de 3 fallos, queda en `failed`.

### Etapa 10 — Panel de reservas y check-in

**Spec asociado**: `0008-panel-reservas-checkin`.

**Entregables**:

- Spec 0008 aprobado.
- Página `/admin/bookings` con filtros (fecha, tour, estado).
- Vista de detalle de booking con todos los datos.
- Botón "check-in" que marca asistencia.
- Vista "Mis tours de hoy" para el día.
- Exportación a CSV.

**Criterios de done**:

- [ ] Staff puede ver y filtrar reservas.
- [ ] Check-in funciona y se refleja en `booking_tickets.check_in_at`.
- [ ] CSV se descarga correctamente con todos los campos relevantes.

### Etapa 11 — Gestión y asignación de guías

**Spec asociado**: `0009-gestion-asignacion-guias`.

**Entregables**:

- Spec 0009 aprobado.
- CRUD de guías desde el panel admin.
- UI para asignar guía a un tour_instance.
- Template de email para notificación al guía.
- Página `/guia/[token]/proximos-tours` accesible vía magic link.
- Tests.

**Criterios de done**:

- [ ] Admin puede crear y editar guías.
- [ ] Asignar un guía dispara email automáticamente.
- [ ] El guía abre el link y ve sus tours.

---

### 🔍 CHECKPOINT 5 — Después de Bloque 5

- ¿Las notificaciones llegan confiablemente? ¿Spam folder?
- ¿El staff puede manejar el día a día con el panel actual?
- ¿La asignación de guías funciona en práctica?
- ¿Hay tareas operativas que se hacen en SQL crudo que deberían tener UI?

---

## BLOQUE 6 — Cancelaciones, reportes, i18n

### Etapa 12 — Cancelaciones con refund automático

**Spec asociado**: `0010-cancelaciones-refund-automatico`.

**Entregables**:

- Spec 0010 aprobado.
- Página `/reserva/[token]/cancelar` con vista clara de "tenés derecho a refund: SI/NO" antes de confirmar.
- Lógica de refund vía adaptador OnvoPay.
- Manejo de fallas (OnvoPay rechaza refund): notificar y permitir retry manual.
- Auditoría completa: cada cancelación queda en `audit_logs`.
- Email de confirmación de cancelación + de refund cuando aplique.
- Tests exhaustivos de los casos límite (cancelación exactamente en el borde de 24h).

**Criterios de done**:

- [ ] Turista puede cancelar y ver refund acreditado.
- [ ] Cancelación <24h informa claramente "sin reembolso" antes de confirmar.
- [ ] Staff puede cancelar desde su panel (con auditoría).
- [ ] Tests cubren el caso de OnvoPay respondiendo error al intentar refund.

### Etapa 13 — Reportes básicos

**Spec asociado**: `0011-reportes-basicos`.

**Entregables**:

- Spec 0011 aprobado.
- Página `/admin/reportes` con: reservas por mes, ingresos por mes, top tours, tasa de cancelación, tasa de no-show.
- Queries optimizadas con índices apropiados.
- Exportación a CSV/Excel de reportes.

### Etapa 14 — i18n completo

**Spec asociado**: `0012-i18n-completo-es-en`.

**Entregables**:

- Spec 0012 aprobado.
- Diccionarios completos en `web/locales/es.json` y `en.json`.
- Auditoría: no quedan strings hardcodeados en componentes (linter lo verifica).
- Detección automática de idioma desde browser, opción de cambio manual.
- Emails en el idioma del cliente.

---

### 🔍 CHECKPOINT 6 — Después de Bloque 6

- Auditoría de strings hardcodeados a fondo: ¿queda alguno?
- ¿Los reportes se sienten útiles o son ruido?
- ¿La cancelación con refund automático ha resistido pruebas reales?

---

## BLOQUE 7 — Hardening pre-lanzamiento

### Etapa 15 — Rate limiting y seguridad

**Spec asociado**: `0013-rate-limiting-security`.

**Entregables**:

- Rate limiting en endpoints sensibles (crear reserva, validar magic link, login).
- Headers de seguridad (CSP, HSTS, X-Frame-Options).
- Auditoría de SQL injection y XSS.
- Revisión de RLS de todas las tablas.
- Tests de penetración básicos.

### Etapa 16 — Observabilidad

**Spec asociado**: `0014-observabilidad-logging-metricas`.

**Entregables**:

- Logging estructurado en producción (consola en formato JSON parseable).
- Métricas básicas: latencia de endpoints críticos, tasa de errores, jobs procesados/fallidos.
- Alertas básicas (Slack o email cuando algo falla repetidamente).
- Sentry o similar para captura de errores no controlados (aplicar external-services-vetting si se elige Sentry).

### Etapa 17 — Tests e2e

**Spec asociado**: `0015-tests-e2e-flujos-criticos`.

**Entregables**:

- Playwright instalado y configurado.
- 5-10 tests e2e cubriendo: reservar tour, cancelar con refund, login de admin, crear tour, asignar guía.
- E2E corriendo en CI antes de merge a main.

---

### 🔍 CHECKPOINT 7 — Pre-lanzamiento

- ¿El sistema sobrevive a un load test básico (1000 reservas simultáneas)?
- ¿Los logs y métricas dan visibilidad real?
- ¿Hay algún ruido conocido en producción que se pueda apagar?
- ¿Las claves OnvoPay en modo live están listas y funcionando?
- ¿El dominio está apuntando bien?
- ¿Hay un plan de respuesta a incidentes (qué pasa si la DB se cae, si OnvoPay se cae, si un cliente llama enojado)?
- ¿El cliente revisó y aprobó el sistema antes de pasar a producción?

---

## BLOQUE 8 — Lanzamiento

### Etapa 18 — Beta cerrada

**Objetivo**: el cliente usa el sistema en producción con tráfico real pero acotado.

**Entregables**:

- Onboarding del cliente: training, documentación de uso, contacto directo durante beta.
- Bitácora de bugs encontrados y resueltos.
- Iteración basada en feedback real.

**Criterios de done**:

- [ ] El cliente completó al menos 20 reservas reales sin problema crítico.
- [ ] Los bugs encontrados se resolvieron en máximo 48h.
- [ ] No hay disputes de tarjeta abiertos.

### Etapa 19 — Apertura pública

**Objetivo**: el sitio del cliente es público y reservas reales fluyen sin intervención.

### Etapa 20 — Operación continua + agregar PayPal

A partir de acá, el trabajo se vuelve mantenimiento + nuevas features priorizadas. La primera feature post-MVP recomendada es:

**Spec `0016-agregar-paypal-merchant`**: sumar PayPal Business CR como pasarela secundaria para turistas extranjeros. Aprovecha el adapter pattern ya implementado en MVP, agrega `lib/payments/adapters/paypal.ts`, no toca lógica de negocio.

Otras features grandes a considerar después:

- WhatsApp Cloud API para notificaciones (cuando el volumen lo justifique).
- Sistema de reseñas público.
- Cupones de descuento.
- Tours privados (no solo grupales).
- App PWA instalable para guías.
- Multi-currency con precios independientes por moneda.
- Programa de fidelidad para turistas recurrentes.

---

## Apéndice — Cómo Claude Code debe seguir este roadmap

Cuando se retoma trabajo en el proyecto:

1. **Identificar la etapa actual** consultando los specs ya implementados en `docs/specs/` y los changelogs respectivos.
2. **No saltar etapas**. Si la etapa 7 no está hecha, no empezar la 8 aunque el usuario lo pida — primero confirmar con él.
3. **Respetar los checkpoints**. Si el usuario dice "seguí con la 5" pero el checkpoint 1 no se hizo, mencionarlo explícitamente y preguntar antes de avanzar.
4. **No modificar este roadmap silenciosamente**. Si una etapa cambia de alcance, se discute, se actualiza el documento con commit `docs(roadmap): ajusta etapa N — razón`.
5. **Cada etapa es una feature en sí misma**. Sigue feature-workflow estrictamente: spec → aprobación → rama → implementación con tests y changelog → PR → merge.
6. **El roadmap es vivo, no sagrado**. Si descubrimos durante el trabajo que el orden necesita cambiar, se ajusta con razón clara.

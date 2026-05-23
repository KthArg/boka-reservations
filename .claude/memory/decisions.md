# Decisiones técnicas

Registro append-only de decisiones técnicas tomadas. Las más recientes arriba.

---

## 2026-05-19 — Cambio de modelo: SaaS para cliente único, no marketplace

**Contexto**: durante la conversación de planeamiento se identificó que el proyecto en realidad tiene un solo cliente/empresario dueño del negocio, no múltiples operadores independientes. Esto cambia completamente el modelo desde "marketplace técnico" a "SaaS de reservas para un operador turístico".

**Decisión**: el proyecto es un sistema de reservas SaaS para un cliente único (un operador turístico costarricense). El desarrollador es proveedor de software, no plataforma. El modelo comercial entre dev y cliente está fuera del sistema (setup único + mensualidad u otro acuerdo a definir).

**Alternativas consideradas**:
- Marketplace técnico multi-tenant: descartado porque introducía complejidades innecesarias (split de pagos, onboarding de operadores, fiscalidad complicada) que no aplican al caso real.
- SaaS multi-cliente desde el inicio: descartado por sobre-ingeniería. Se diseña para un cliente; si en el futuro hay segundo cliente, se evalúa multi-tenancy real.

**Razón**: el modelo real del negocio es un solo empresario turístico que necesita un sistema de reservas profesional. Modelarlo como marketplace era arquitectura sin uso.

**Implicaciones**:
- El modelo de datos se simplifica: `operators` puede colapsar a una tabla `tenants` con una sola fila (o eliminarse). `operator_users` se convierte en `users` con roles internos.
- No hay split de pagos. La plata va directo a la cuenta del cliente.
- Cualquier pasarela merchant en CR es viable (sin necesidad de marketplace features).
- El desarrollador no toca dinero ajeno: cero exposición fiscal.
- Roles del sistema: `admin` (cliente), `staff` (empleados con permisos limitados), `guide` (guías turísticos), más el turista público sin cuenta.

---

## 2026-05-19 — Pasarela: OnvoPay como única para MVP; PayPal Merchant en post-MVP

**Contexto**: después del cambio a modelo SaaS, se reevaluaron pasarelas. Stripe y PayPal Platform están descartadas para entidades CR (verificado). Se necesita una pasarela que funcione con entidad costarricense, acepte tarjetas internacionales y locales, y tenga API moderna.

**Decisión**: OnvoPay como pasarela única para el MVP. PayPal Business CR como pasarela secundaria a sumar después del MVP, no antes.

**Alternativas consideradas**:
- Stripe estándar: descartado, CR no está en países soportados de Stripe.
- PayPal Platform: descartado, requiere entidad en US/EEA/UK/CA/CH.
- PayPal Merchant estándar (no Platform): viable pero más caro (5.4%+) y menos cómodo para ticos. Lo dejamos como suplemento futuro para turistas extranjeros que prefieran PayPal por confianza.
- Tilopay: viable pero comisiones más altas (4.25%+) y reportes de cargos extras por liquidación.
- BAC Credomatic: viable pero API más arcaica, onboarding presencial, sin SINPE Móvil nativo.
- Transferencia manual: descartado por riesgo fiscal de manejar dinero ajeno como persona física.

**Razón**: OnvoPay reúne las mejores condiciones para el caso. Empresa formal costarricense (Sociedad Anónima 3-101-815764) registrada ante SUGEF. API REST moderna en `docs.onvopay.com` con sandbox accesible (`api.dev.onvopay.com`). SDK npm oficial (`@onvo/onvo-pay-js`). Soporta CRC y USD, tarjetas internacionales, SINPE Móvil a 1.5% (el más bajo). Comisión tarjeta 3.5% + IVA, sin mensualidad. Onboarding 100% digital.

**Implicaciones**:
- Arquitectura: módulo `lib/payments/` con adaptador OnvoPay desde el día uno. Diseño tipo "adapter pattern" para sumar PayPal después sin tocar lógica de negocio.
- Cliente debe abrir cuenta OnvoPay (trámite rápido) antes del go-live.
- Para turistas que prefieran PayPal, posterior al MVP se agrega un segundo adaptador.
- Modelo de datos: `payments` tiene `external_provider` (`onvopay`, `paypal`, etc.) y `external_payment_id`. Generalizado desde el inicio para no tener que migrar al sumar PayPal.

### Verificación de servicio externo

- **Servicio**: OnvoPay
- **Categoría**: pasarela de pagos
- **Disponibilidad CR**: confirmada (empresa costarricense)
- **Modalidad usada**: merchant estándar
- **Requisitos de entidad**: persona física o jurídica registrada en CR
- **Sandbox**: disponible sin verificación KYC completa
- **Costos estimados**: 3.5% + IVA tarjeta, 1.5% SINPE Móvil, sin mensualidad
- **Lock-in**: bajo (adapter pattern aísla la dependencia)
- **Fuente principal**: https://docs.onvopay.com/ y https://onvopay.com/pricing (verificado 2026-05-19)
- **Fuentes secundarias**: registro SUGEF, paquete npm `@onvo/onvo-pay-js`
- **Riesgos identificados**: empresa más joven que actores como BAC, menor reconocimiento de marca para turistas extranjeros (mitigable agregando PayPal post-MVP)

---

## 2026-05-19 — Descartar Stripe y PayPal Platform tras verificación

**Contexto**: durante la planificación se intentó usar Stripe Connect y luego PayPal Commerce Platform sin haber verificado restricciones de país. Al intentar configurar PayPal Platform en la dashboard, el wizard mostró "US accounts only" y no incluyó Costa Rica en el dropdown de países.

**Decisión**: Stripe y PayPal Platform quedan formalmente descartados para entidades registradas únicamente en Costa Rica. Solo se considerarían si el cliente decidiera registrar una LLC en Estados Unidos (decisión que él descartó por ahora).

**Alternativas consideradas**: las mismas que en la decisión de OnvoPay arriba.

**Razón**: ambos servicios requieren entidad en países específicos (US, UK, EEA, Canadá, Suiza para Stripe Connect; US para PayPal Platform). Costa Rica no califica.

**Implicaciones**:
- Se crea la skill `external-services-vetting` para evitar repetir este error con otros servicios.
- Se documenta el aprendizaje en `learnings.md`.
- Toda referencia a Stripe en documentación previa del proyecto se elimina o se reemplaza por OnvoPay.

---

## 2026-05-19 — Cero strings y números mágicos, 150 líneas por archivo

**Contexto**: revisión final de convenciones del codebase antes de codear.

**Decisión**: prohibir strings y números literales con significado semántico en código de aplicación; limitar todos los archivos a 150 líneas no-vacías-no-comentarios.

**Alternativas consideradas**:
- Solo "preferir constantes" sin límite duro: rechazado por degradar con el tiempo.
- Límites más laxos (300 líneas): rechazado por menos disparador efectivo de SRP.

**Razón**: forzar SRP de manera automática y eliminar una clase entera de bugs (typos en string literals, magic numbers sin contexto).

**Implicaciones**: linter custom debe enforzar ambas reglas. Excepciones permitidas explícitas (tests, datos puros, migraciones). Toda configuración numérica vive en `shared/constants/`.

---

## 2026-05-19 — Testing profesional como skill dedicada con cobertura por criticidad

**Contexto**: las prácticas de testing iban diluidas en `codebase-conventions`; el sistema cobra dinero real y necesita testing serio.

**Decisión**: skill propia `testing-practices` que define pirámide, AAA, factories, fixtures, mocks permitidos/prohibidos, casos borde obligatorios para lógica crítica.

**Alternativas consideradas**:
- Mantener todo en `codebase-conventions`: rechazado por mezcla de responsabilidades.
- Porcentaje global de cobertura: rechazado por dar falsa seguridad.

**Razón**: cobertura por criticidad refleja la realidad. La lógica de booking/payments necesita exhaustividad; tests de componentes UI son frágiles y dan poco retorno.

**Implicaciones**: cada spec debe definir explícitamente el plan de tests en la sección 10. CI bloquea merges sin tests donde corresponde.

---

## 2026-05-19 — Memoria persistente del proyecto en `.claude/memory/`

**Contexto**: Claude Code no tiene memoria entre sesiones; se necesita un mecanismo para preservar contexto y aprendizajes.

**Decisión**: carpeta `.claude/memory/` versionada en el repo, con archivos para estado, decisiones, aprendizajes, contexto del usuario, entorno. Skill `project-memory` define cuándo leer y actualizar.

**Alternativas consideradas**:
- Memoria fuera del repo (en home del usuario): rechazado porque no viaja entre máquinas.
- Confiar solo en specs y changelogs: rechazado porque ambos son específicos por feature; falta lugar para conocimiento transversal.

**Razón**: la memoria versionada es auditable, sobrevive cambios de máquina, está siempre disponible donde está el código.

**Implicaciones**: leer la memoria es lo primero que hace Claude Code en cada sesión. Mantenerla destilada y útil requiere disciplina.

---

## 2026-05-19 — Stack: Next.js + Supabase + OnvoPay + Resend + Railway worker

**Contexto**: definición del stack inicial del proyecto.

**Decisión**:
- Frontend + API: Next.js 15 (App Router) en Vercel.
- DB + Auth: Supabase (Postgres).
- Pagos: OnvoPay (CR) como pasarela única en MVP. PayPal Merchant CR a sumar post-MVP.
- Email: Resend con React Email.
- Worker / cron: Node.js en Railway.
- Sin WhatsApp/SMS en MVP inicial (solo email).

**Alternativas consideradas**: ver decisión específica de pagos arriba. Para los demás componentes, se evaluaron alternativas pero los seleccionados ofrecen mejor relación costo/beneficio para nuestro escenario.

**Razón**: stack minimiza costo inicial (~$6-30/mes), aprovecha tier gratuito de cada servicio, encaja con escala esperada y restricciones de operar desde CR.

**Implicaciones**: arquitectura serverless con worker separado. Costos escalan suavemente.

---

## 2026-05-19 — Monorepo en un solo repo, sin workspace tooling al inicio

**Contexto**: pregunta sobre si separar portal público y panel admin en repos distintos.

**Decisión**: monorepo único con carpetas `web/`, `worker/`, `shared/`. Sin Turborepo ni pnpm workspaces al inicio; imports relativos a `shared/`.

**Alternativas consideradas**:
- Dos repos separados (público/admin): rechazado por duplicación de tipos y fricción de deploy.
- Monorepo con workspace tooling desde día uno: rechazado por complejidad innecesaria con un solo dev.

**Razón**: features cruzan ambas caras del sistema constantemente. Workspace tooling se agrega cuando la fricción lo justifique.

**Implicaciones**: el portal público y el admin viven en `web/app/(public)/` y `web/app/(admin)/` respectivamente.

---

## 2026-05-19 — Sin cuenta para turistas: guest checkout + magic links

**Contexto**: el usuario pidió evitar el registro de cuenta para reservar.

**Decisión**: los turistas reservan como invitados (email + nombre + teléfono). Acceso posterior a la reserva vía magic link enviado al email. El token va hasheado en DB.

**Alternativas consideradas**:
- Cuentas con password: rechazado por fricción para usuarios casuales.
- OTP por WhatsApp: descartado por la decisión de no usar WhatsApp en MVP.

**Razón**: minimiza fricción de checkout (es lo que Airbnb Experiences, OpenTable usan para casual users). El magic link cubre los casos de modificación/cancelación posterior.

**Implicaciones**: cada booking tiene `access_token_hash`. Acciones críticas pueden requerir un segundo factor (OTP por email).

---

## 2026-05-19 — Dinero como entero en centavos

**Contexto**: modelado de campos monetarios en DB.

**Decisión**: todos los montos en DB se guardan como `integer` representando centavos. Moneda en columna aparte (`USD` o `CRC`).

**Alternativas consideradas**:
- `decimal(10,2)`: rechazado por complejidad de aritmética.
- `float`/`double`: rechazado por imprecisión.

**Razón**: estándar de la industria para sistemas financieros. Encaja con la API de pasarelas modernas (OnvoPay también usa centavos).

**Implicaciones**: formateo en UI requiere conversión y centralizarse en `lib/format/money.ts`. Los precios pueden almacenarse en USD como moneda base, con visualización en CRC.

---

## 2026-05-19 — Política de cancelación: 24h con refund automático

**Contexto**: definición de la política base de cancelación.

**Decisión**: cancelación con más de 24h de anticipación al inicio del tour → refund automático completo. Menos de 24h → sin reembolso. Comunicación clara al usuario en cada paso.

**Alternativas consideradas**:
- Refund parcial escalonado por horas: rechazado por complejidad operacional.
- Refunds manuales siempre: rechazado por carga operativa.

**Razón**: estándar de la industria, simple de comunicar y de auditar.

**Implicaciones**: lógica de refund automático vía webhook de pasarela. UI debe mostrar dinámicamente "tenés derecho a refund: SÍ/NO" antes de confirmar cancelación.

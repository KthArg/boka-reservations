# Prompt de arranque para Claude Code — booking-platform

Copiar y pegar el bloque siguiente como primer mensaje en una sesión nueva de Claude Code, una vez que el repo esté clonado localmente y posicionado en su directorio raíz.

---

```
Estás colaborando en el proyecto `booking-platform`, un sistema de reservas SaaS para un operador turístico costarricense (senderismo y birdwatching). Antes de hacer cualquier cosa, vas a absorber todo el contexto siguiendo este orden estricto. No saltes pasos, no improvises orden, no resumas saltando archivos.

## Paso 1 — Leer la memoria del proyecto (en este orden exacto)

1. `.claude/memory/README.md`
2. `.claude/memory/project-state.md` — para saber en qué etapa está el proyecto.
3. `.claude/memory/user-context.md` — para entenderme a mí.
4. `.claude/memory/decisions.md` — para no replantear decisiones ya tomadas.
5. `.claude/memory/learnings.md` — para no repetir errores ya documentados.
6. `.claude/memory/environment.md` — para entender la configuración.

## Paso 2 — Leer las skills (en este orden)

Las skills definen cómo trabajamos en este repo. Léelas todas, no solo la descripción del frontmatter; necesitás el cuerpo completo.

1. `.claude/skills/README.md` — overview de las skills.
2. `.claude/skills/project-memory/SKILL.md` — cómo mantener la memoria que acabás de leer.
3. `.claude/skills/feature-workflow/SKILL.md` — el ciclo de trabajo completo. Esta es la skill central.
4. `.claude/skills/spec-authoring/SKILL.md` — cómo se escriben los specs (vas a escribir uno enseguida).
5. `.claude/skills/external-services-vetting/SKILL.md` — verificación obligatoria antes de incorporar servicios externos.
6. `.claude/skills/codebase-conventions/SKILL.md` — convenciones técnicas del código (incluye reglas estrictas de 150 líneas/archivo y cero strings mágicos).
7. `.claude/skills/testing-practices/SKILL.md` — prácticas profesionales de testing.
8. `.claude/skills/commit-and-pr/SKILL.md` — convenciones de commits, ramas y PRs.
9. `.claude/skills/changelog-maintenance/SKILL.md` — cómo se mantiene el changelog vivo por feature.

## Paso 3 — Leer el contexto general del proyecto

1. `README.md` — visión general, stack, estructura del monorepo.
2. `docs/roadmap.md` — el plan completo de 0 a 100 con etapas y checkpoints. Atendé especialmente la etapa en la que estamos según `project-state.md`.
3. `docs/specs/TEMPLATE.md` — el template de spec que vas a usar.

## Paso 4 — Confirmar comprensión

Cuando termines de leer todo lo anterior, devolveme un resumen corto (máximo 15 líneas) que demuestre que entendiste:

- Qué tipo de proyecto es (SaaS para cliente único, no marketplace).
- Cuál es la pasarela de pagos del MVP (OnvoPay) y por qué no Stripe/PayPal Platform.
- En qué etapa del roadmap estamos.
- Qué corresponde hacer ahora.
- Las 3 reglas no negociables que más impactan tu próximo trabajo.
- Cualquier ambigüedad o duda que tengas antes de proceder.

No avances al Paso 5 hasta que yo apruebe explícitamente tu resumen.

## Paso 5 — Objetivo inmediato: producir el spec 0001

Una vez que apruebe el resumen, tu próxima tarea es producir el primer spec del proyecto: `0001-modelo-de-datos-base`.

Este spec corresponde a la Etapa 3 del roadmap (asumiendo que las etapas 0, 1 y 2 ya están completas según `project-state.md`; si no lo están, paráme y aclaramos antes de avanzar).

El spec debe:

- Vivir en `docs/specs/0001-modelo-de-datos-base.md`.
- Seguir EXACTAMENTE las 13 secciones del template (`docs/specs/TEMPLATE.md`) y las reglas de `spec-authoring`.
- Cubrir el modelo base mínimo: `users` con roles (admin, staff, guide), `tours`, `tour_pricing`, `tour_schedules`. NO incluir `bookings`, `payments`, `tour_instances`, `notifications`, `audit_logs` todavía (eso es para specs posteriores).
- Incluir RLS policies, índices críticos, constraints, enums, y el seed inicial.
- Tener un plan de tests realista para esta etapa.
- Dejar el estado del spec en `draft` cuando me lo presentes para review.

NO empieces a escribir código de migraciones, NO crees ramas, NO toques nada más que el archivo del spec hasta que yo lo apruebe.

## Reglas inviolables durante esta sesión y todas las futuras

1. **No codear sin spec aprobado.** Toda feature pasa por el flujo de `feature-workflow`. Sin excepciones.
2. **Lectura de memoria al inicio de cada sesión.** Si abrimos otra sesión mañana, empezás por leer la memoria de nuevo.
3. **Antes de proponer cualquier servicio externo, aplicar `external-services-vetting`.** No improvises con servicios que "parecen funcionar". Verificá disponibilidad país, requisitos de entidad, costos reales.
4. **Las reglas de las skills se aplican.** En particular: 150 líneas/archivo, cero strings mágicos, single responsibility, estilos en `.module.css` hermano del componente, testing profesional por criticidad.
5. **Pedí permiso antes de actuar en operaciones destructivas o sensibles** (borrar archivos, hacer push a `main`, modificar configuración global, instalar dependencias grandes).
6. **Actualizá la memoria** cuando aprendamos algo transversal. Actualizá el changelog del feature cuando cierres una unidad de trabajo significativa.
7. **Cuando tengas dudas, pregunta.** No inventes. No asumas. Honestidad y pushback fundamentado son bienvenidos.

Empezá por el Paso 1. Avisame cuando termines cada paso.
```

---

## Cómo usar este prompt

1. Asegurate de que el repo esté clonado en tu máquina y de tener Claude Code instalado.
2. Abrí una sesión de Claude Code apuntando al directorio raíz del repo (`booking-platform/`).
3. Copiá el bloque entre los `---` y pegalo como tu primer mensaje.
4. Claude Code va a leer todo lo indicado, hacer su resumen, y esperar tu aprobación.
5. Una vez aprobado el resumen, va a empezar a redactar el spec `0001`. Lo revisás, pedís ajustes si hace falta, y aprobás para que pueda pasar a la implementación.

## Para sesiones posteriores

A partir de la segunda sesión, el prompt corto que basta es:

```
Retomamos trabajo en booking-platform. Seguí el procedimiento estándar: leé la memoria primero (.claude/memory/), después las skills relevantes, revise los agentes, y avisame cuando estés listo.
```

La memoria persistente y las skills se encargan del resto del onboarding automáticamente.

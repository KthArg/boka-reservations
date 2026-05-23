---
name: changelog-maintenance
description: Mantenimiento del changelog continuo de IA por feature en booking-platform. Aplicar al concluir cualquier tarea sustantiva dentro de una feature en curso (no al final de cada prompt, sino cuando se cierra una unidad de trabajo: completar la implementación de un módulo, terminar un set de tests, cerrar una decisión técnica, resolver un bug encontrado durante la implementación). También al iniciar una sesión de trabajo sobre una feature existente, para leer el changelog y recuperar contexto. No commitear cambios de código sin haber actualizado el changelog correspondiente cuando la actualización aplique.
---

# Changelog maintenance — registro continuo de trabajo por feature

Este proyecto mantiene un **changelog vivo por feature**, distinto del changelog tradicional de releases. Es un registro narrativo que se actualiza mientras la feature se construye, con dos audiencias principales:

1. **Yo mismo en una sesión futura** (o cualquier otro agente de IA que retome el trabajo): el changelog es la forma más rápida de recuperar contexto sin re-leer todo el código y los commits.
2. **El humano del equipo** que quiere ver qué se hizo sin abrir 14 commits ni leer diffs largos.

No reemplaza al spec (que dice qué se va a hacer) ni a los commits (que registran cambios atómicos al código). Complementa: registra el camino recorrido, las decisiones tomadas en el camino, y los desvíos del plan original.

## Ubicación y formato

Cada feature tiene su changelog hermano del spec:

```
docs/specs/
├── 0007-recordatorio-24h-antes-tour.md       # spec
└── 0007-recordatorio-24h-antes-tour.changelog.md   # changelog
```

El archivo se crea cuando arranca la implementación (etapa 5 del feature-workflow), no antes. Mientras el spec está en `draft` o `in-review` no hay changelog porque no hay trabajo de implementación que registrar.

### Estructura del archivo

```markdown
# Changelog — 0007 Recordatorio 24h antes del tour

Spec: [0007-recordatorio-24h-antes-tour.md](./0007-recordatorio-24h-antes-tour.md)
Rama: feat/0007-recordatorio-24h

## YYYY-MM-DD HH:MM — Título corto de la unidad de trabajo

**Hecho**:
- Cambio concreto 1
- Cambio concreto 2

**Por qué / decisiones**:
- Decisión relevante y su razón

**Pendiente**:
- Próxima unidad de trabajo

**Notas para retomar**:
- Cualquier contexto que ayudaría a continuar en otra sesión
```

Las entradas se agregan en orden cronológico inverso (la más reciente arriba), después del header del archivo. Esto hace que al abrirlo se vea lo último primero.

## Cuándo actualizar el changelog

La regla simple: **cuando se cierra una unidad de trabajo cohesiva dentro de la feature**, no en cada prompt ni en cada commit individual.

### Sí actualizar

- Completar la implementación de un módulo o componente sustantivo.
- Terminar un conjunto de tests asociado a un comportamiento.
- Cerrar una decisión técnica que tomó deliberación (ej: elegir entre dos enfoques, descartar una alternativa).
- Resolver un bug significativo encontrado durante la implementación.
- Terminar de aplicar cambios pedidos en una review.
- Hacer una pausa larga en el trabajo (fin de sesión, cambio de contexto a otra feature).
- Detectar y documentar un desvío del spec original (algo que estaba previsto distinto y se cambió, con razón).
- Avanzar lo suficiente como para que valga la pena que un futuro lector vea el progreso.

### No actualizar

- Cada vez que termina un prompt del usuario.
- Cada vez que se hace un commit (los commits ya tienen sus mensajes; duplicar es ruido).
- Por cambios cosméticos triviales (renombrar una variable, ajustar imports).
- Por correcciones inmediatas de errores propios dentro de la misma unidad de trabajo (si introduje un typo y lo corrijo en el siguiente turno, no es una entrada nueva).
- Para anunciar lo que se va a hacer (eso es planificación, no changelog). El changelog registra lo que se hizo.

### Test mental

Antes de agregar una entrada, preguntate: si vuelvo a este proyecto en dos semanas y solo leo el changelog, ¿esta entrada me ayuda a entender en qué estado quedó la feature? Si la respuesta es no, probablemente no amerita entrada. Si la respuesta es sí, agregala.

## Estructura de una entrada

Cada entrada tiene cuatro bloques:

### `**Hecho**`

Lista concreta de lo que se hizo en esta unidad de trabajo. Cada ítem en pasado, una línea por cambio relevante. No reescribas los diffs ni los nombres de cada función; sí mencioná los archivos o módulos tocados y el comportamiento que cambió.

```markdown
**Hecho**:
- Creé el job `send-notifications.ts` en el worker con lógica de polling cada minuto.
- Agregué template `Reminder24h.tsx` con versiones ES y EN.
- Añadí test de integración que verifica el cálculo de `scheduled_for` y la cancelación si la reserva cambia de estado.
```

### `**Por qué / decisiones**`

Las decisiones que tomaste y que no son obvias del código. Esta es la sección más valiosa para una futura sesión: el código muestra qué hace, pero no por qué se eligió ese camino sobre otros.

```markdown
**Por qué / decisiones**:
- Elegí polling cada 1 minuto en lugar de un scheduler con timers porque el worker corre en Railway con restart frecuente; con timers en memoria perdíamos jobs en cada deploy.
- Decidí marcar la notificación como `cancelled` desde el worker (no desde el handler de cancelación) para evitar race conditions si la cancelación ocurre justo al momento del envío.
```

Si no hubo decisiones notables, escribí "Ninguna decisión notable; implementación directa según el spec." y pasá. No infles esta sección artificialmente.

### `**Pendiente**`

La próxima unidad de trabajo identificada, con suficiente claridad para que el siguiente turno (tuyo o de otro) sepa por dónde seguir.

```markdown
**Pendiente**:
- Conectar el job al endpoint de Resend (ya está mockeado en tests, falta la integración real).
- Migración para crear el índice `(status, scheduled_for)` en `notifications`.
```

Si la feature está completa, escribí "Nada — feature lista para PR." y eso cierra el changelog.

### `**Notas para retomar**`

Contexto adicional que no encaja en las otras secciones pero ayudaría a continuar. Cosas como:

- "El test de integración requiere la variable `TEST_DATABASE_URL` en el .env local."
- "Hay un TODO en `worker/jobs/send-notifications.ts:42` para extraer la lógica de backoff cuando la usemos en otro job."
- "Estoy bloqueado esperando confirmación del usuario sobre el formato del subject del email; ver pregunta abierta en el spec."

Si no hay nada que agregar, omití esta sección (no escribas "ninguna"; mejor que falte).

## Ejemplo completo

```markdown
# Changelog — 0007 Recordatorio 24h antes del tour

Spec: [0007-recordatorio-24h-antes-tour.md](./0007-recordatorio-24h-antes-tour.md)
Rama: feat/0007-recordatorio-24h

## 2026-05-21 16:40 — Cierre de implementación, listo para PR

**Hecho**:
- Conecté el job al envío real vía Resend usando el wrapper de `lib/email/sender.ts`.
- Agregué el caso de retry con backoff exponencial (1min, 5min, 30min).
- Verifiqué el flujo end-to-end con un script de seed que adelanta el reloj.

**Por qué / decisiones**:
- Usé el wrapper existente en `lib/email/sender.ts` en vez de llamar a Resend directo desde el worker, para mantener una sola superficie con la API externa. Eso permitió reutilizar el logging y el manejo de errores.

**Pendiente**:
- Nada — feature lista para PR.

## 2026-05-20 11:15 — Job base y templates listos, falta integración real

**Hecho**:
- Creé `worker/jobs/send-notifications.ts` con polling cada 60s.
- Agregué template `web/emails/Reminder24h.tsx` con versiones ES y EN.
- Tests unitarios del cálculo de `scheduled_for`.

**Por qué / decisiones**:
- Polling cada 1 minuto en lugar de timers en memoria, porque el worker en Railway reinicia con cada deploy y perderíamos jobs en flight.
- La cancelación de la notificación cuando la reserva ya no está `confirmed` la hace el worker al momento del envío, no el handler de cancelación. Evita un race condition donde la notificación se envía entre el momento del cancel y el update.

**Pendiente**:
- Integrar con Resend real (ahora está mockeado).
- Agregar test de integración con DB y reloj manipulado.

**Notas para retomar**:
- El cálculo de `scheduled_for` está en `lib/notifications/scheduling.ts`. Si en el futuro queremos más recordatorios (12h, 2h), esa función ya recibe el offset como parámetro.
```

## Workflow: cómo encaja con el resto

### Al arrancar la implementación de una feature

Después de aprobar el spec y crear la rama, antes de tu primer commit de código:

1. Creá el archivo `docs/specs/<id>-<slug>.changelog.md`.
2. Agregá el header (link al spec, nombre de la rama).
3. Comiteálo solo: `docs(changelog): inicia changelog de <slug>`.

### Al avanzar en el trabajo

Durante la implementación, identificá cuándo cerraste una unidad de trabajo (ver criterios arriba). Cuando lo hagas:

1. Agregá una entrada nueva al inicio del changelog (después del header).
2. Si en esa unidad de trabajo también hiciste commits de código, podés incluir la actualización del changelog en el mismo PR (no en un PR aparte) y commitearla junto con los cambios relacionados, o como commit separado: `docs(changelog): registra avance en <slug>`.

### Al retomar trabajo en una feature existente

Antes de empezar a codear:

1. Abrí el changelog.
2. Leé la entrada más reciente: te dice qué se hizo, qué quedó pendiente y qué notas hay.
3. Releé el spec si han pasado muchas sesiones.
4. Solo entonces seguí.

Saltearse el changelog y empezar a codear "porque ya me acuerdo" es la forma más común de re-trabajar cosas ya hechas o de violar decisiones que se habían tomado.

### Al cerrar la feature

Cuando la feature está implementada y lista para PR:

1. La entrada final del changelog tiene `**Pendiente**: Nada — feature lista para PR.`.
2. En la descripción del PR, mencioná que el changelog completo está en `docs/specs/<id>-<slug>.changelog.md`.
3. Después del merge, el changelog queda como registro histórico junto al spec implementado. No se borra, no se archiva separado.

## Cómo interactúa con commits

Hay una pregunta razonable: si tenemos Conventional Commits, ¿no estamos duplicando información en el changelog?

Respuesta: no. Los commits y el changelog cumplen funciones distintas:

| Aspecto | Commits | Changelog |
|---|---|---|
| Granularidad | Cambio atómico al código | Unidad de trabajo significativa |
| Contenido | Qué cambió + por qué (breve) | Qué se hizo + decisiones + qué falta |
| Audiencia | `git log`, reviewers de diffs | IA en próxima sesión, humano leyendo historia |
| Permanencia | Inmutable después del merge | Vive con el spec, no se modifica retroactivamente |

Un commit es una foto del código. Una entrada de changelog es una nota narrativa que sintetiza lo logrado y orienta lo que viene.

## Anti-patrones

- **Actualizar en cada turno** del agente. Inflación inútil. Solo cuando se cierra una unidad de trabajo.
- **Listar archivos modificados en lugar de comportamientos**. "Modifiqué 8 archivos" no le sirve a nadie. "Implementé el job de envío" sí.
- **Escribir en futuro** ("voy a hacer X"). El changelog registra lo hecho. Lo que va a hacerse va en `Pendiente`.
- **Borrar entradas antiguas** porque "quedaron obsoletas". El changelog es append-only. Si una decisión se revirtió, lo documentás en una entrada nueva.
- **Cambiar entradas pasadas para ocultar errores o desvíos**. Si te equivocaste y volviste atrás, eso es contenido valioso del changelog: lo documentás como una entrada explicando qué pasó.
- **Hacer del changelog un duplicado del spec**. El spec dice qué se va a construir. El changelog dice cómo se fue construyendo. Si copiás secciones del spec al changelog, algo está mal.
- **Esperar al final de la feature para actualizar todo el changelog de una vez**. Pierde el valor de poder recuperar contexto durante el trabajo. Si lo escribís solo al final, es esencialmente un retrospectivo y pierde 80% de su utilidad.

## Skills relacionadas

- **feature-workflow** — define cuándo arranca y cierra el trabajo de una feature. El changelog vive dentro de esa ventana.
- **spec-authoring** — el spec es el complemento del changelog. Spec = qué; changelog = cómo se hizo.
- **commit-and-pr** — los commits del changelog siguen las mismas convenciones (`docs(changelog): ...`).

---
name: project-memory
description: Mantenimiento y consulta de la memoria persistente del proyecto booking-platform. Aplicar SIEMPRE al inicio de cualquier sesión nueva de trabajo (leer la memoria es lo primero que hace Claude Code antes de cualquier otra cosa). Aplicar también cuando se aprende algo transversal al proyecto que beneficiaría a sesiones futuras: una decisión técnica con razón documentada, un gotcha descubierto trabajando con alguna librería o servicio externo, una preferencia del usuario expresada, un quirk de la infraestructura, un cambio en el estado general del proyecto. No confundir con el changelog (que es por feature). Esta skill cubre conocimiento transversal del proyecto entero.
---

# Project memory — memoria persistente del proyecto

Claude Code no tiene memoria entre sesiones por defecto. Cada vez que se reabre el proyecto, arranca sin contexto. Esta skill resuelve ese problema documentando en archivos versionados el conocimiento acumulado que beneficiaría a cualquier sesión futura.

La memoria es **transversal al proyecto entero**. No reemplaza:

- **Specs** (`docs/specs/`): qué se va a construir o se construyó, por feature.
- **Changelogs** (`docs/specs/*.changelog.md`): cómo se construyó cada feature, paso a paso.
- **Roadmap** (`docs/roadmap.md`): plan de alto nivel, etapas y checkpoints.
- **README**, **SKILL.md**: documentación estable del proyecto.

La memoria sí cubre:

- Decisiones técnicas y sus razones.
- Aprendizajes y gotchas descubiertos trabajando.
- Preferencias del usuario expresadas a lo largo del tiempo.
- Estado actual del proyecto en términos de progreso.
- Configuración y credenciales (referencias, nunca valores reales).

## Ubicación y estructura

```
.claude/memory/
├── README.md              # describe el propósito y los archivos
├── decisions.md           # decisiones técnicas con su razón
├── learnings.md           # gotchas, quirks, sorpresas descubiertas trabajando
├── user-context.md        # preferencias del usuario, estilo, cosas a recordar
├── project-state.md       # estado actual del proyecto, qué se hizo, qué sigue
└── environment.md         # referencias a configuración (no valores secretos)
```

La carpeta `.claude/memory/` es parte del repo y se commitea como cualquier otro archivo. Esto garantiza:

- La memoria viaja con el repo.
- La memoria sobrevive cambios de máquina del usuario.
- La memoria es auditable como cualquier otro cambio (un mal recuerdo se ve en el diff).

## Cuándo leer la memoria

**Al inicio de toda sesión nueva**, sin excepción. Esto es no negociable. Leer la memoria es lo primero que hace Claude Code antes de:

- Responder al primer pedido del usuario.
- Tocar código.
- Decidir cualquier cosa sustantiva.

Concretamente, al arrancar:

1. Leer `.claude/memory/project-state.md` — para saber dónde está parado el proyecto.
2. Leer `.claude/memory/user-context.md` — para entender al usuario y sus preferencias.
3. Leer `.claude/memory/decisions.md` y `.claude/memory/learnings.md` — para no repetir errores ni discutir decisiones ya tomadas.
4. Si la sesión va a tocar configuración o servicios externos: leer `.claude/memory/environment.md`.

Si la memoria está vacía o no existe la carpeta, crearla con los archivos base (template más abajo).

## Cuándo actualizar la memoria

Esta sección es la más importante. La memoria pierde valor si se actualiza demasiado poco o demasiado.

### Actualizar SÍ

- **Decisión técnica nueva** que el usuario aprobó o que se tomó con su consentimiento. Va a `decisions.md`.
- **Gotcha descubierto** trabajando con código real (un bug raro de una librería, un quirk de configuración, una limitación no documentada de un servicio). Va a `learnings.md`.
- **Preferencia del usuario** explícita o que se infirió con confianza ("prefiero respuestas concisas", "no me gusta cuando hacés X"). Va a `user-context.md`.
- **Cambio en el estado del proyecto** que vale la pena saber al retomar: feature mergeada, checkpoint pasado, bug grande en investigación. Va a `project-state.md`.
- **Cambio de configuración o setup** (movimos de Vercel a otro provider, agregamos un nuevo servicio externo). Va a `environment.md`.

### Actualizar NO

- En cada turno del agente. La memoria es destilado, no transcripción.
- Por información trivial o derivable del código ("agregué una función llamada X").
- Por cosas que ya están registradas en commits, specs o changelogs.
- Por opinión propia o suposiciones sobre el usuario. Solo registrar lo que el usuario expresó o lo que se aprendió empíricamente.
- Por cosas que cambian frecuentemente (estado momentáneo). La memoria es para conocimiento durable.

### Test mental

Antes de actualizar, preguntate: si en dos meses vuelvo a este proyecto sin contexto, ¿esta nota me serviría? Si la respuesta es no, no la agregues. Si la respuesta es sí, agregala con detalle suficiente para que sea útil aislada.

## Estructura de cada archivo

### `project-state.md`

Estado actual del proyecto. Es el archivo más volátil; se actualiza más seguido que los otros porque refleja "dónde estamos".

```markdown
# Estado del proyecto

Última actualización: YYYY-MM-DD HH:MM

## Etapa actual del roadmap

Etapa X — <título>

## Specs implementados

- 0001 Modelo de datos base — implementado en PR #1
- 0002 Auth de operadores — implementado en PR #2

## Spec en curso

0003 Gestión de tours panel admin — en rama feat/0003-gestion-tours-panel-admin
Cambios principales hechos hasta ahora: <breve resumen>
Ver changelog: docs/specs/0003-gestion-tours-panel-admin.changelog.md

## Próximas etapas pendientes

- 0004 Portal público de tours
- 0005 Motor de disponibilidad y holds

## Checkpoints pasados

- Checkpoint 1 ✓ (YYYY-MM-DD)
- Checkpoint 2 ✓ (YYYY-MM-DD)

## Notas de estado

Cualquier nota relevante al estado actual: bugs conocidos, deuda técnica acordada, decisiones pendientes.
```

### `decisions.md`

Decisiones técnicas tomadas, con su razón y fecha. Append-only en general; si una decisión se revierte, se documenta en una entrada nueva sin borrar la anterior.

```markdown
# Decisiones técnicas

## YYYY-MM-DD — Título corto de la decisión

**Contexto**: situación que motivó la decisión.
**Decisión**: qué se decidió.
**Alternativas consideradas**: qué otras opciones se evaluaron.
**Razón**: por qué se eligió esta.
**Implicaciones**: qué cosas dependen de esta decisión, qué se vuelve más fácil/difícil.

---

## YYYY-MM-DD — (siguiente decisión)
```

### `learnings.md`

Gotchas, quirks y aprendizajes descubiertos durante el trabajo. Cada entrada es corta pero específica: qué pasó, qué se descubrió, qué hacer al respecto.

```markdown
# Aprendizajes y gotchas

## YYYY-MM-DD — Título corto

**Qué pasó**: descripción del problema o sorpresa.
**Causa raíz**: si se identificó.
**Solución / workaround**: qué hacer cuando se enfrente de nuevo.
**Referencias**: links a docs, issues, threads.

---
```

### `user-context.md`

Lo que se aprendió sobre el usuario: preferencias, restricciones, formas de comunicación, decisiones de producto suyas.

```markdown
# Contexto del usuario

## Comunicación

- Idioma: español (Costa Rica).
- Prefiere respuestas <preferencias observadas>.
- Tono <observaciones>.

## Decisiones de producto repetidas

- <decisiones que tomó el usuario y vale recordar>

## Restricciones técnicas conocidas

- <restricciones que mencionó (ej: presupuesto, tiempo, equipo)>

## Cosas que NO le gustan

- <preferencias negativas observadas>
```

### `environment.md`

Información sobre la configuración del proyecto. **NUNCA valores de secretos**: solo referencias y notas.

```markdown
# Entorno y configuración

## Servicios conectados

- **Supabase**: proyecto `booking-dev` (URL en `.env.local`).
- **Stripe**: cuenta en modo test, claves en `.env.local`. Modo live: pendiente verificación.
- **Vercel**: proyecto conectado al repo, deploy a `main` automático.
- **Railway**: worker desplegado, ver dashboard.
- **Resend**: API key en `.env.local`, dominio verificado: `mail.<dominio>.com`.

## Notas de configuración

- <notas sobre cómo se configuró cada cosa, sin valores secretos>

## Cosas que requieren acción del usuario manualmente

- <cosas que Claude no puede hacer y el usuario debe hacer>
```

### `README.md` (de la memoria)

Un archivo corto que describe el propósito de la carpeta para cualquier humano que la abra.

```markdown
# Memoria del proyecto

Esta carpeta contiene conocimiento persistente del proyecto que Claude Code lee al inicio de cada sesión.

Ver `.claude/skills/project-memory/SKILL.md` para las reglas de mantenimiento.

Archivos:
- `project-state.md` — estado actual del proyecto.
- `decisions.md` — decisiones técnicas con su razón.
- `learnings.md` — gotchas y aprendizajes.
- `user-context.md` — preferencias y contexto del usuario.
- `environment.md` — configuración (sin secretos).
```

## Workflow de actualización

### Al detectar algo que va a memoria

1. Identificar qué archivo corresponde según la naturaleza del aprendizaje.
2. Agregar la entrada con la estructura del archivo (no inventar formato propio).
3. Para `decisions.md` y `learnings.md`: append-only en orden cronológico inverso (lo más reciente arriba). Si la sección crece mucho, mover entradas viejas a `decisions.archive.md` / `learnings.archive.md` (no borrar nunca).
4. Para `project-state.md`: actualizar in-place. Es el único archivo donde se modifica contenido existente, porque refleja estado actual.
5. Para `user-context.md` y `environment.md`: actualizar in-place pero conservadoramente. No reescribir entradas existentes; agregar al final si es info nueva.
6. Commit con mensaje `docs(memory): registra <breve descripción>`.

### Al final de una sesión productiva

Antes de cerrar, considerar:

- ¿Hubo decisiones que no quedaron en `decisions.md` y deberían? Agregarlas.
- ¿Cambió el estado del proyecto significativamente? Actualizar `project-state.md`.
- ¿Aprendí algo del usuario? Sumar a `user-context.md`.

No es obligatorio actualizar al final de cada sesión; solo cuando hubo contenido digno de memoria.

## Reglas sobre secretos y privacidad

- **Nunca, bajo ninguna circunstancia, escribir secretos en la memoria**. Ni API keys, ni passwords, ni tokens, ni endpoints completos con credenciales embebidas.
- **Sí está bien**: referirse a "la API key de Resend está en `.env.local`", o "el cliente de Stripe usa la cuenta del operador X (id `acct_xxx` truncado para referencia)".
- **Información del usuario sensible** (datos personales no relacionados al producto, info financiera, etc): no va a memoria. Si el usuario menciona algo así en una sesión, queda en esa sesión.
- **Datos de operadores o clientes reales**: nunca van a memoria. Si hay que documentar un bug específico, anonimizar.

## Anti-patrones

- **Memoria como bitácora exhaustiva** ("hice esto, después esto, después esto"). Eso es el changelog del feature en curso, no la memoria.
- **Memoria como mini-spec** (proponer features futuras). Esas van a specs nuevos.
- **Memoria como retórica** (escribir reflexiones generales sin contenido accionable). Cada entrada debe ser útil aislada.
- **Reescribir o borrar entradas viejas** para que la memoria "esté ordenada". La memoria es append. Solo `project-state.md` se modifica in-place.
- **Duplicar info del README o de skills**. La memoria es para lo no estable; las skills son para reglas durables. Si una regla se va consolidando, podría llegar a ser una skill (con la decisión correspondiente del usuario).
- **Confundir memoria con changelog**. Memoria = transversal al proyecto. Changelog = específico a una feature.

## Ejemplo de buena entrada

En `learnings.md`:

```markdown
## 2026-05-25 — Stripe Connect: account onboarding requiere domain verification

**Qué pasó**: el primer operador de prueba no podía completar el onboarding de Stripe Connect Express. El error era genérico ("we couldn't complete this step").

**Causa raíz**: Stripe requiere que el dominio de la plataforma esté verificado en el Stripe Dashboard antes de iniciar onboarding de operadores. No estaba en la documentación principal; se encontró en un foro.

**Solución**: agregar el dominio en Stripe Dashboard → Settings → Connect → Branding antes de cualquier prueba de onboarding. Tarda ~10 minutos en validar.

**Referencias**: https://stripe.com/docs/connect/branding (sección "Configure the platform")
```

En `decisions.md`:

```markdown
## 2026-05-22 — Centavos como entero para todos los montos

**Contexto**: al modelar `bookings.total_cents` surgió la pregunta de cómo guardar montos en general.

**Decisión**: todos los montos en DB se guardan como `integer` representando centavos. La moneda va en columna aparte.

**Alternativas consideradas**:
- `decimal(10,2)`: rechazado por la complejidad de aritmética con conversión a primitive.
- `float`/`double`: rechazado por imprecisión inherente.

**Razón**: estándar de la industria para sistemas financieros. Aritmética exacta. Encaja con el API de Stripe que también usa centavos.

**Implicaciones**: toda exposición en UI requiere conversión + formateo según locale. Se centraliza en `lib/format/money.ts`.
```

## Skills relacionadas

- **feature-workflow** — al arrancar trabajo en una feature, leer memoria primero.
- **changelog-maintenance** — es específico por feature; esta skill es transversal.
- **spec-authoring** — los specs son contratos puntuales; esta skill captura aprendizajes acumulados.

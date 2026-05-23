---
name: commit-and-pr
description: Convenciones de commits (Conventional Commits), nombrado de ramas, estructura de pull requests, y reglas de merge para el repo booking-platform. Aplicar siempre antes de hacer git commit, git push, abrir un PR, o cuando el usuario pida "subí los cambios", "hagamos un commit", "abrí el PR", "mergeá esto". También cuando se vaya a crear una rama nueva. No usar git directamente sin haber consultado esta skill primero.
---

# Commit and PR — convenciones de git para el proyecto

Este proyecto sigue **Conventional Commits** y un flujo de ramas basado en feature branches con squash merge a `main`. La consistencia acá no es estética: permite generar changelogs automáticos, navegar la historia con `git log`, y entender qué hace cada commit sin abrir su diff.

## Nombrado de ramas

```
<type>/<id>-<slug>
```

Donde:

- `<type>` es uno de: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `perf`, `style`, `build`, `ci`.
- `<id>` es el ID del spec asociado (4 dígitos). Para fixes triviales sin spec, usar `quick`.
- `<slug>` es kebab-case, máximo 5 palabras, en español.

**Ejemplos correctos:**

- `feat/0007-recordatorio-24h-email`
- `fix/0012-error-checkout-stripe-cr`
- `chore/quick-actualizar-deps-mayo`
- `docs/0015-spec-reembolsos-parciales`

**Ejemplos incorrectos:**

- `feature/email-reminder` (falta ID, type incorrecto, en inglés)
- `santiago/working` (no descriptivo)
- `fix-bug` (sin estructura)

`main` es la rama principal. No se commitea directamente a `main`; siempre pasa por PR.

## Conventional Commits

Cada commit sigue este formato:

```
<type>(<scope>): <subject>

<body opcional>

<footer opcional>
```

### Types permitidos

| Type | Cuándo usarlo |
|---|---|
| `feat` | Nueva funcionalidad observable por algún usuario |
| `fix` | Corrección de un bug |
| `docs` | Solo cambios a documentación (README, specs, comentarios) |
| `style` | Cambios de formato que no afectan código (espacios, comas) |
| `refactor` | Cambio de código que no agrega features ni arregla bugs |
| `perf` | Mejora de performance |
| `test` | Agregar o corregir tests |
| `build` | Cambios al sistema de build o dependencias externas |
| `ci` | Cambios a configuración de CI |
| `chore` | Tareas de mantenimiento que no encajan arriba |

### Scope

El scope identifica el área del código afectada. Para este proyecto, los scopes comunes son:

- `web` — cambios al frontend / API routes
- `worker` — cambios al worker de background jobs
- `shared` — cambios a tipos y schemas compartidos
- `db` — migraciones, schema, queries
- `auth` — autenticación de operadores
- `payments` — integración con Stripe
- `email` — templates de email
- `i18n` — traducciones y locales
- `booking` — lógica de reservas
- `admin` — panel administrativo
- `public` — portal público de reservas

Si un commit toca múltiples scopes, elegí el más significativo. Si genuinamente afecta a varios sin uno dominante, omití el scope.

### Subject

- En español.
- Máximo 72 caracteres.
- En minúsculas (excepto nombres propios y siglas).
- Sin punto final.
- En presente del modo indicativo: "agrega", "corrige", "renombra" — no "agregué", "corrigiendo", "agregar".

### Body

- Opcional, pero recomendado para commits no triviales.
- Explica el **por qué** del cambio, no el **qué** (el qué se lee en el diff).
- Líneas máximo 80 caracteres.
- Separado del subject por una línea en blanco.

### Footer

- Opcional.
- Referencias a specs, issues o PRs: `Refs: 0007`, `Closes: #14`.
- Breaking changes: `BREAKING CHANGE: <descripción>`.

### Ejemplos de commits

**Feature pequeña:**

```
feat(booking): valida que la reserva sea con +24h de anticipación

Refs: 0003
```

**Fix con explicación:**

```
fix(payments): evita doble-cobro al recibir webhooks duplicados de Stripe

Stripe puede reintentar webhooks si el endpoint no responde 200 en
3 segundos. La verificación previa de processed_webhook_events tenía
un race condition: dos webhooks llegando al mismo tiempo pasaban
ambos la verificación antes de que ninguno escribiera el registro.

Se mueve la inserción del registro de evento procesado al inicio de
la transacción y se usa ON CONFLICT DO NOTHING para que el segundo
webhook simplemente devuelva 200 sin reprocesar.

Refs: 0019
Closes: #28
```

**Refactor:**

```
refactor(worker): extrae lógica de reintentos a un módulo reusable

Sin cambios de comportamiento. Prepara el terreno para 0024.

Refs: 0024
```

**Documentación:**

```
docs: agrega spec 0021 para asignación automática de guías
```

**Breaking change:**

```
feat(public)!: cambia formato del token de magic link

BREAKING CHANGE: los magic links generados antes de este deploy
dejan de funcionar. Se mandó email a clientes con reservas activas
con un nuevo link válido. Ver spec 0030 sección "Plan de rollout".

Refs: 0030
```

## Frecuencia y tamaño de commits

- **Commits pequeños y atómicos**. Cada commit debe representar un cambio coherente que tenga sentido por sí solo. No mezclés un fix de bug con una refactorización con un cambio de documentación.
- **No acumules**. Si llevás 4 horas codeando sin commitear, ya tenés un problema. Cortá en pedazos lógicos mientras avanzás.
- **Tests viven en el commit de la feature que prueban**, no en commits separados. Si la feature y sus tests se separan, el commit intermedio queda en un estado roto (feature sin tests).
- **No comitees código que no compila ni código con tests rotos**. Cada commit debe pasar `pnpm typecheck` y `pnpm test` en el scope que afectó.

## Pull requests

### Título del PR

Sigue Conventional Commits, igual que los commits. Es lo que va a quedar en `main` después del squash merge.

```
feat(booking): recordatorio por email 24h antes del tour
```

### Descripción del PR

Usá este template. Todo PR debe tener al menos las secciones marcadas como obligatorias.

```markdown
## Spec
<!-- Obligatorio. Link al spec en docs/specs/ -->
docs/specs/0007-recordatorio-24h-antes-tour.md

## Resumen
<!-- Obligatorio. 2-4 líneas que expliquen qué cambia y por qué. -->

## Cambios principales
<!-- Obligatorio. Bullet list de los cambios técnicos relevantes. -->
- Agrega lógica de generación de notification reminder_24h al confirmar booking.
- Implementa el envío en el worker.
- Crea template Reminder24h.tsx en ES y EN.

## Cómo probarlo
<!-- Obligatorio. Pasos concretos para validar manualmente. -->
1. Hacer una reserva en /tours/birdwatching-monteverde/<slug>
2. Modificar tour_instance.start_time a NOW() + 24h y 1 minuto.
3. Ejecutar `pnpm --filter worker dev`.
4. Verificar que el email llega en ~1 minuto al correo registrado.

## Migraciones de DB
<!-- Si aplica. Listar archivos de migración y mencionar si requieren downtime. -->
Ninguna.

## Variables de entorno nuevas
<!-- Si aplica. Mencionar y confirmar que están en .env.example. -->
Ninguna.

## Checklist
- [ ] Spec referenciado y actualizado al estado correcto.
- [ ] Tests agregados/actualizados.
- [ ] Documentación afectada actualizada.
- [ ] No quedan TODOs ni console.log dejados.
- [ ] Se probó manualmente al menos un happy path.
```

### Tamaño del PR

PRs grandes son irreviewables. Apuntá a estos rangos:

- **Ideal**: <300 líneas modificadas.
- **Aceptable**: 300–800 líneas.
- **Justificá explícitamente**: >800 líneas.
- **Partilo**: >1500 líneas, salvo casos extremos (un refactor automático de imports, una migración de tooling).

Si una feature requiere un PR grande, dividila en varios PRs secuenciales, cada uno cohesivo y mergeable independientemente. Un patrón útil: primero PR de migración + tipos, después PR de lógica, después PR de UI.

### Draft PRs

Si querés mostrar trabajo en progreso para feedback temprano, abrí el PR como **Draft**. Marcarlo como ready-for-review solo cuando esté terminado y los tests pasen.

## Merge

- **Modo de merge**: squash merge. Único modo permitido en `main`.
- **Mensaje del squash**: el título del PR (Conventional Commits) + referencia al spec en el body.
- **Quién mergea**: el autor del PR mergea después de tener aprobación. Salvo emergencia, no mergeés PRs ajenos.
- **Después del merge**: borrar la rama remota. Las ramas locales se limpian con `git fetch --prune` periódicamente.

## Antes de hacer push

Antes de empujar a remoto, ejecutá:

```bash
pnpm lint         # ESLint sin errores
pnpm typecheck    # TypeScript sin errores
pnpm test         # todos los tests pasan
```

Si alguno falla, no hagas push. Si es CI quien los va a correr de todas formas, igual corrélos local antes para no quemar minutos de CI por errores triviales.

## Casos especiales

### Hotfix urgente

1. Crear rama `fix/quick-<descripción>` desde `main`.
2. Hacer el fix con tests.
3. Abrir PR con descripción mínima pero clara.
4. Después del merge, si el bug ameritaba investigación de causa raíz, abrir un spec retrospectivo.

### Revertir un commit

Usar `git revert` (que crea un commit nuevo que deshace los cambios), nunca `git reset` sobre `main` ni force-push. El commit de revert sigue Conventional Commits:

```
revert: feat(booking): recordatorio por email 24h antes del tour

Causaba envíos duplicados en producción cuando se editaba la reserva.
Volvemos atrás mientras se arregla en spec 0009.

Refs: 0007
```

### Cherry-pick

Evitarlo salvo necesidad real (ej: traer un fix de `main` a una rama de release antigua). Si se usa, mencionar el commit original en el body: `(cherry picked from commit <hash>)`.

### Cambiar la historia de un PR durante review

Mientras un PR está en review:

- **Permitido**: hacer commits adicionales en la rama de feature respondiendo a comentarios.
- **No permitido**: rebase + force-push, salvo que el reviewer lo pida explícitamente. Reescribir la historia durante review dificulta ver qué cambió.

Después de aprobación pero antes del merge, podés hacer rebase para limpiar la historia si el squash merge no se va a usar (en este proyecto sí se usa, así que rara vez es necesario).

## Anti-patrones

- **Commits "WIP"** mergeados a `main`. Si el commit no está terminado, no se mergea.
- **Commits con mensaje vacío o "fix"** sin contexto.
- **Mergear con tests rotos** "porque ya lo arreglo después". Nunca.
- **Force-push a `main`**. Nunca, bajo ninguna circunstancia.
- **PRs sin spec referenciado** (salvo los `fix/quick-*` justificados).
- **PRs gigantes "porque la feature es grande"**. La feature se parte, no el PR.

## Skills relacionadas

- **feature-workflow** — el ciclo completo que invoca esta skill en sus etapas 4, 5, 6 y 8.
- **spec-authoring** — para entender qué se referencia desde el PR.
- **codebase-conventions** — para asegurar que el código que estás commiteando cumple las convenciones del repo.

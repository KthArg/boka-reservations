---
name: feature-workflow
description: Define el ciclo completo de desarrollo para este proyecto, basado en metodología feature-driven y spec-driven. Aplicar siempre que el usuario pida implementar, agregar, modificar o eliminar cualquier funcionalidad en el repositorio booking-platform, ya sea que mencione explícitamente "feature", "spec", "ticket", "tarea", "cambio", o describa la necesidad en lenguaje natural ("quiero que el usuario pueda...", "necesitamos que el sistema...", "hay un bug en..."). Esta skill es el punto de entrada obligatorio antes de tocar código y referencia las skills auxiliares spec-authoring, commit-and-pr, y codebase-conventions.
---

# Feature workflow — flujo de trabajo del proyecto

Este proyecto se desarrolla con metodología **feature-driven + spec-driven**. Significa dos cosas concretas que debés respetar siempre:

1. **Feature-driven**: el trabajo se organiza por feature, no por capa técnica. Una feature es una unidad de valor completa para algún usuario del sistema (turista, operador o guía). No se hacen PRs que tocan solo "el modelo de datos" o "solo el frontend" sin contexto del valor que entregan.

2. **Spec-driven**: ninguna feature arranca sin un spec escrito y aprobado. Codear primero y documentar después es un anti-patrón en este proyecto. El spec es la fuente de verdad de qué se va a hacer y por qué; el código es solo su manifestación.

## Antes de empezar cualquier trabajo

**Lectura de memoria es obligatoria al inicio de cada sesión.** Ver skill **project-memory**. Específicamente:

- `.claude/memory/project-state.md` — para saber en qué etapa del roadmap está el proyecto y qué se hizo recientemente.
- `.claude/memory/user-context.md` — para entender al usuario.
- `.claude/memory/decisions.md` y `learnings.md` — para no replantear decisiones ya tomadas ni repetir errores conocidos.

Si la memoria está vacía o no existe, crearla con los templates de `project-memory` antes de actuar.

## El ciclo completo

```
1. Captura de intención  →  2. Spec  →  3. Aprobación  →  4. Rama
                                                              ↓
8. Merge  ←  7. Review  ←  6. PR  ←  5. Implementación + tests + changelog
```

Pasamos por estas etapas en orden. Si el usuario te pide "agregá X", no empieces a programar: empezá por la etapa 1.

### Etapa 1 — Captura de intención

Antes de cualquier otra cosa, asegurate de entender qué se quiere y por qué. Hacé las preguntas que hagan falta. Tres dimensiones que casi siempre vale la pena clarificar:

- **Para quién es**: turista, operador, guía, o staff interno. Cada uno tiene capacidades, contexto y restricciones distintos.
- **Qué problema resuelve**: la solución que el usuario propone a veces no es la mejor; entender el problema te permite proponer alternativas.
- **Cuál es el alcance mínimo viable**: muchas features tienen un núcleo simple y muchos "nice-to-have" alrededor. Identificar el núcleo permite entregar valor más rápido.

No saltés esta etapa aunque el pedido te parezca trivial. Un "agregá un botón para X" sin contexto suele esconder una decisión de producto.

### Etapa 2 — Spec

Una vez clara la intención, escribí un spec en `docs/specs/<id>-<slug>.md`. El formato y secciones obligatorias están en la skill **spec-authoring**. Leéla y seguíla. No inventes estructura propia: la consistencia entre specs hace que todo el equipo (incluido vos como agente) pueda navegarlos rápido.

El spec debe poder leerse y entenderse sin abrir el código. Si alguien que nunca tocó el proyecto lo lee, debe entender qué se va a construir, qué se asume, qué quedó explícitamente fuera de alcance, y cómo se sabrá que está terminado.

**Si el spec incorpora servicios externos** (pasarelas, email, SMS, almacenamiento, etc.), aplicar **external-services-vetting** antes de cerrar el diseño técnico del spec. La sección 5 del spec debe citar la verificación realizada.

### Etapa 3 — Aprobación

El spec no se implementa apenas escrito. Se lo presentás al usuario, esperás feedback, y solo pasás a la siguiente etapa cuando el usuario aprueba explícitamente. La aprobación puede ser tan corta como "dale" o "implementalo", pero debe ser explícita.

Si el usuario pide cambios al spec, los aplicás al archivo y volvés a pedir aprobación. Iterá las veces que haga falta. El spec aprobado se commitea (commit `docs: add spec for <feature>`) antes de tocar código de implementación.

### Etapa 4 — Rama

Una vez aprobado el spec, creá la rama de feature. Las convenciones de naming están en **commit-and-pr**. Resumen rápido:

```
feat/<id>-<slug>      → features nuevas
fix/<id>-<slug>       → bugs
chore/<id>-<slug>     → mantenimiento, dependencias, configs
docs/<id>-<slug>      → solo documentación
refactor/<id>-<slug>  → refactor sin cambio de comportamiento
```

`<id>` es el mismo ID del spec. `<slug>` es una versión corta y kebab-case del título.

### Etapa 5 — Implementación + tests + changelog

Codeá la feature siguiendo las convenciones del proyecto, descritas en **codebase-conventions**. Mientras codeás, recordá:

- **Hacé commits pequeños y frecuentes**, cada uno con un cambio cohesivo. No acumulés tres días de trabajo en un commit gigante. Las reglas de commits están en **commit-and-pr**.
- **Tests son parte de la feature, no algo opcional**. Cada feature que toca lógica de negocio debe incluir tests. El nivel de cobertura depende de la criticidad: la lógica de reservas (concurrencia, refunds, transiciones de estado) debe tener tests de integración exhaustivos; un cambio cosmético en una página puede no necesitarlos.
- **Mantené un changelog vivo de la feature**. Apenas arrancás la implementación, creás el archivo `docs/specs/<id>-<slug>.changelog.md` y vas registrando ahí cada vez que cerrás una unidad de trabajo significativa. Reglas detalladas en **changelog-maintenance**. Esto no es opcional: es la forma en que un agente futuro (o vos mismo en otra sesión) recupera contexto rápido sobre el estado y las decisiones tomadas. Cuando retomes trabajo en una feature ya empezada, **el changelog es lo primero que leés** antes de tocar código.
- **No te desviés del spec sin actualizar el spec primero**. Si durante la implementación descubrís que el spec tiene un error o una omisión importante, parás, actualizás el spec, pedís reconfirmación, y seguís. Cambiar silenciosamente lo que se prometió hacer es la peor forma de romper el contrato con el usuario.
- **Si encontrás algo fuera de alcance** (un bug en otro módulo, una mejora obvia, código que huele mal), no lo arreglés en este PR. Documentalo como un nuevo spec o un issue. Los PRs grandes y "mientras estaba aquí, también arreglé esto" son los más difíciles de revisar y los que más bugs introducen.

### Etapa 6 — PR

Cuando la feature está implementada y todos los tests pasan, abrí un PR. Reglas en **commit-and-pr**. Lo crítico:

- El título del PR sigue el formato Conventional Commits.
- La descripción referencia el spec (link al archivo en `docs/specs/`).
- Incluí una sección "Cómo probarlo" con los pasos concretos para validar manualmente.
- Si la feature requiere migraciones de DB, mencionalo explícitamente en la descripción.
- Si la feature requiere variables de entorno nuevas, documentalas en `.env.example` y mencionalo.

### Etapa 7 — Review

El PR no se mergea sin review. Si estás operando como agente:

- Esperá feedback del usuario antes de mergear.
- Si el usuario pide cambios, aplicalos en commits adicionales (no hagas force-push a la rama de feature durante la review; eso hace difícil ver qué cambió desde la última pasada).
- Cuando todos los comentarios estén resueltos y el usuario apruebe, procedé a mergear.

### Etapa 8 — Merge

Una vez aprobado:

- Mergeá a `main` con **squash merge** por defecto. Esto mantiene la historia de `main` limpia, con un commit por feature.
- El mensaje del squash merge debe seguir Conventional Commits y referenciar el spec.
- Borrá la rama de feature después del merge.

## Cuándo no aplica este flujo

Algunas tareas no requieren spec ni rama de feature dedicada:

- **Hotfixes triviales y urgentes** (un typo en un texto, un broken link, un valor mal seteado en config). Usá una rama `fix/quick-<descripción-corta>` y mergeá rápido, sin spec. Documentá en el commit lo necesario.
- **Cambios al README, comentarios o docs internas** que no representen una decisión de producto. Una rama `docs/...` directamente.
- **Configuración de tooling** (ESLint, Prettier, CI). Una rama `chore/...` directamente.

La regla mental: si el cambio afecta el comportamiento del sistema desde la perspectiva de algún usuario (turista, operador, guía), hay spec. Si el cambio es estrictamente interno o cosmético, no hace falta.

## Anti-patrones que se deben evitar

- **"Pequeño cambio sin spec porque es obvio"**: si es realmente obvio, escribir el spec toma 5 minutos y deja registro de la decisión. Si toma más, probablemente no era tan obvio.
- **"Spec después de codear, para no perder velocidad"**: el spec sirve para pensar antes de codear. Escribirlo después es teatro.
- **"PR gigante que toca muchas cosas"**: imposible de revisar bien. Dividilo en varios PRs secuenciales, cada uno con su feature pequeña y autocontenida.
- **"Mergear sin tests porque corren localmente"**: el CI corre los tests por una razón. Si están rotos en CI, están rotos.
- **"Cambiar el spec retroactivamente para que coincida con lo que se implementó"**: el spec es contrato. Si durante la implementación tenés que cambiarlo, eso es parte del proceso (etapa 5), pero el cambio debe quedar en el commit, no oculto.

## Skills relacionadas

- **project-memory** — lectura obligatoria al inicio de cada sesión, actualización al aprender algo transversal.
- **spec-authoring** — cómo escribir un spec (etapa 2).
- **external-services-vetting** — verificación obligatoria antes de incorporar cualquier servicio externo (etapa 2).
- **commit-and-pr** — convenciones de commits, ramas, PRs (etapas 4, 5, 6, 8).
- **codebase-conventions** — estilo de código y organización del repo (etapa 5).
- **testing-practices** — prácticas profundas de testing (etapa 5).
- **changelog-maintenance** — registro vivo del trabajo durante la implementación (etapa 5).

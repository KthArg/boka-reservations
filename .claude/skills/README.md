# Skills para Claude Code

Esta carpeta contiene las skills que Claude Code consulta cuando colabora en este repositorio. Cada skill es un archivo `SKILL.md` con metadatos al inicio (YAML frontmatter) y reglas escritas en Markdown.

## Cómo funciona

Claude Code lee la descripción de cada skill al iniciar la sesión y mantiene esa metadata siempre en contexto. Cuando aparece un pedido del usuario que coincide con la descripción de una skill, Claude carga el cuerpo completo de esa skill antes de actuar.

Esto significa que vos no necesitás invocar manualmente nada: si tu pedido cae dentro del alcance de una skill, Claude lo va a saber.

## Skills disponibles

| Skill | Cuándo dispara |
|---|---|
| `project-memory` | Al inicio de toda sesión nueva, y al aprender algo transversal al proyecto |
| `feature-workflow` | Cualquier pedido de implementar, modificar o eliminar funcionalidad |
| `spec-authoring` | Antes de codear features nuevas, al crear archivos en `docs/specs/` |
| `external-services-vetting` | Antes de incorporar o sugerir cualquier servicio externo |
| `commit-and-pr` | Antes de commits, pushes, PRs, merges |
| `codebase-conventions` | Mientras se escribe o modifica código en `web/`, `worker/`, `shared/` |
| `testing-practices` | Al escribir, revisar o modificar tests; al planificar cobertura de una feature |
| `changelog-maintenance` | Al cerrar unidades de trabajo dentro de una feature, y al retomar trabajo |

`project-memory` se consulta primero en cada sesión (es lectura). `feature-workflow` es el punto de entrada principal cuando se va a actuar sobre el código.

## Cómo agregar una skill

1. Crear carpeta `<nombre-de-la-skill>/` dentro de `.claude/skills/`.
2. Dentro, crear `SKILL.md` con la siguiente estructura:

```markdown
---
name: nombre-de-la-skill
description: Cuándo y por qué aplicar esta skill. Sé específico con los disparadores; describí los contextos y frases que deben activarla. Si la skill es importante de aplicar, sé explícito ("aplicar siempre que...", "no usar X sin consultar esta skill").
---

# Título de la skill

Cuerpo en Markdown con las reglas, ejemplos, decisiones.
```

3. Mantenelo bajo 500 líneas. Si crece más, dividilo en una skill principal + archivos referenciados.
4. Commitealo siguiendo las convenciones de `commit-and-pr` (típicamente `docs: agrega skill X` o `chore: ...`).

## Cómo modificar una skill existente

Las skills evolucionan con el proyecto. Cuando una convención cambie:

1. Editá el `SKILL.md` correspondiente.
2. Mencioná el cambio en el commit message: `docs(skills): actualiza commit-and-pr con regla de revert`.
3. Si el cambio es grande o controvertido, escribí un spec en `docs/specs/` primero.

## Skills y específs no son lo mismo

- **Specs** (`docs/specs/`): describen QUÉ se va a construir, una feature a la vez. Son contratos puntuales.
- **Skills** (`.claude/skills/`): describen CÓMO se trabaja en este repo, transversalmente. Son normas duraderas.

Si te encontrás escribiendo una regla general en un spec, probablemente debe ir a una skill. Si te encontrás describiendo un cambio puntual en una skill, probablemente debe ir a un spec.

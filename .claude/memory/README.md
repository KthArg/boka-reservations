# Memoria del proyecto

Esta carpeta contiene conocimiento persistente del proyecto que Claude Code lee al inicio de cada sesión.

Ver `.claude/skills/project-memory/SKILL.md` para las reglas de mantenimiento.

## Archivos

- `project-state.md` — estado actual del proyecto.
- `decisions.md` — decisiones técnicas con su razón.
- `learnings.md` — gotchas y aprendizajes descubiertos trabajando.
- `user-context.md` — preferencias y contexto del usuario.
- `environment.md` — configuración del entorno (sin secretos).

## Reglas

- Esta memoria es parte del repo; se commitea con `docs(memory): ...`.
- Nunca se escriben secretos aquí.
- `project-state.md` se modifica in-place; los demás son append-only.
- Lectura obligatoria al inicio de cada sesión.

# Subagentes del proyecto

Los subagentes son agentes especializados que el agente principal puede invocar para tareas específicas. Cada uno tiene contexto acotado y reglas claras sobre cuándo se usa.

## Cuándo Claude Code invoca un subagente

Claude Code decide invocar un subagente cuando la descripción del agente coincide con el tipo de tarea actual. Las descripciones están escritas con triggers explícitos para guiar esta decisión.

El usuario también puede solicitar explícitamente que se use un subagente diciendo "usá el agente X" o "que el code-reviewer revise esto".

## Subagentes disponibles

| Subagente | Cuándo se invoca |
|---|---|
| `spec-reviewer` | Después de escribir un spec en draft, antes de presentarlo al usuario |
| `external-service-validator` | Antes de incorporar cualquier servicio externo nuevo |
| `code-reviewer` | Antes de cada commit o PR significativo |
| `db-schema-guardian` | Antes de mergear PRs que toquen `migrations/` |
| `payment-flow-auditor` | Al modificar código en `lib/payments/`, webhooks de pasarela, o flujo de dinero |
| `memory-curator` | Al cerrar features mergeadas o al detectar drift entre memoria y código |
| `performance-optimizer` | Tras specs con queries pesadas, antes de pre-producción, o ante reportes de lentitud |

## Cómo se relacionan con las skills

Los subagentes consumen las skills existentes pero aplicadas con foco específico. Por ejemplo, `code-reviewer` aplica las reglas de `codebase-conventions` y `testing-practices` con dedicación exclusiva, mientras que el agente principal las aplica como parte de un trabajo más amplio.

Las skills siguen siendo la fuente de verdad de las reglas. Los subagentes solo cambian cómo y cuándo se aplican.

## Patrón de invocación

El agente principal decide invocar a un subagente cuando detecta un trigger apropiado. El subagente recibe contexto acotado, devuelve un reporte estructurado, y el agente principal decide qué hacer con ese reporte (aplicar cambios, defender posición, escalar al usuario).

Los subagentes NUNCA modifican código o documentación sin que el agente principal apruebe. Son revisores y consejeros, no ejecutores autónomos.

---
name: spec-authoring
description: Reglas y plantilla para escribir specs de features en booking-platform. Aplicar siempre que se vaya a crear, editar o revisar un archivo en docs/specs/, o cuando feature-workflow indique que toca escribir un spec. Usar también cuando el usuario pida explícitamente "escribí el spec de X", "documentemos la feature Y antes de codear", o cuando se necesite formalizar un cambio antes de implementarlo. No empezar a codear nuevas features sin haber consultado esta skill primero.
---

# Spec authoring — cómo escribir un spec de feature

Los specs son el contrato entre quien pide una feature y quien la implementa. En este proyecto, todo cambio de comportamiento del sistema arranca con un spec aprobado. Esta skill define el formato y las reglas para escribirlos.

## Ubicación y nombre

Los specs viven en `docs/specs/`. El nombre del archivo es:

```
<id>-<slug>.md
```

- `<id>` es un identificador secuencial de 4 dígitos con cero a la izquierda (`0001`, `0002`, ..., `0042`). Antes de crear un spec nuevo, listá `docs/specs/` y usá el siguiente número disponible.
- `<slug>` es kebab-case, en español, máximo 6 palabras, descriptivo. Ej: `0007-recordatorio-24h-antes-tour.md`.

Una vez asignado, el ID no cambia nunca. Aunque el spec sea rechazado o reemplazado, su número queda quemado.

## Plantilla obligatoria

Todo spec usa exactamente esta estructura. No agregués ni quités secciones. Si una sección no aplica, escribí "No aplica" debajo del header en lugar de borrarlo.

```markdown
# <ID> — <Título descriptivo del spec>

- **Estado**: draft | in-review | approved | implemented | archived
- **Autor**: <nombre o handle>
- **Creado**: <YYYY-MM-DD>
- **Última actualización**: <YYYY-MM-DD>
- **Rama**: feat/<id>-<slug>  (cuando aplique)
- **PR**: #<número>  (cuando aplique)

## 1. Contexto y motivación

Por qué se necesita esta feature. Qué problema resuelve. Para quién (turista, operador, guía, staff). Si reemplaza o modifica algo existente, mencionalo aquí.

Esta sección debe poder leerse sin conocer el sistema. Asumí que el lector entiende el negocio pero no necesariamente la arquitectura.

## 2. Objetivos

Lista de objetivos concretos y medibles. Idealmente 2 a 5. Cada uno debe ser una oración que empiece con un verbo en infinitivo y describa un resultado, no una tarea.

- Permitir que [actor] [acción] sin [restricción actual].
- Reducir el [problema] mediante [aproximación].

## 3. Fuera de alcance

Lista explícita de lo que esta feature NO incluye. Esta sección suele ser más importante que los objetivos. Cualquier cosa que un lector razonable podría asumir que está incluida, pero no lo está, debe aparecer acá.

- No se va a implementar X.
- No se modifica el comportamiento de Y.

## 4. Historias de usuario

Una o más historias en formato estándar:

> Como [actor], quiero [capacidad], para [beneficio].

Acompañadas de criterios de aceptación concretos:

- [ ] Criterio 1
- [ ] Criterio 2

Los criterios se redactan en presente, son verificables, y describen comportamiento observable. "El usuario ve un mensaje de error" es bueno; "el código maneja errores" es vago.

## 5. Diseño técnico

Acá explicás cómo se va a implementar. No es código, pero sí decisiones técnicas concretas:

- Qué tablas se crean o modifican (referenciar nombre y columnas afectadas).
- Qué endpoints o server actions nuevos se exponen, con su forma de request/response.
- Qué jobs del worker se afectan.
- Qué integraciones externas se tocan (Stripe, Resend).
- Qué decisiones de diseño no obvias se tomaron y por qué (alternativas consideradas, tradeoffs).

Si la feature tiene un flujo complejo, incluí un diagrama (Mermaid en bloque de código). No invertir más de 15 minutos en diagramas; si hace falta más, probablemente la feature debe partirse en varios specs.

## 6. Modelo de datos

Detalle de cambios al schema. Para cada tabla afectada:

- **Tabla**: nombre
- **Acción**: create | alter | drop
- **Columnas afectadas**: lista con tipo, nullability, default, constraints.
- **Índices nuevos o modificados**.
- **Migración**: nombre del archivo de migración que se va a crear.

Si no hay cambios al schema, escribir "Sin cambios al modelo de datos".

## 7. Estados y transiciones

Si la feature introduce o modifica una máquina de estados (típicamente en bookings, payments, notifications), documentar:

- Estados nuevos.
- Transiciones permitidas y sus disparadores.
- Estados terminales.

Si no aplica, "No aplica".

## 8. Casos borde y errores

Lista de casos que requieren manejo explícito:

- Qué pasa si [evento inesperado].
- Qué pasa cuando [precondición no se cumple].
- Concurrencia: qué pasa si dos actores intentan la acción al mismo tiempo.

Cada caso debe tener un comportamiento documentado, aunque sea "mostrar error genérico y registrar en logs".

## 9. Impacto en otras áreas

- ¿Esta feature requiere cambios en el panel admin?
- ¿Requiere nuevos emails o cambios a templates existentes?
- ¿Cambia el comportamiento de algún job del worker?
- ¿Tiene impacto en reportes o métricas?
- ¿Afecta políticas de cancelación, refunds o pagos?
- ¿Hay implicaciones de i18n (textos nuevos a traducir)?

## 10. Plan de tests

- Qué tests unitarios cubren la lógica de negocio.
- Qué tests de integración cubren los flujos críticos.
- Si aplica, qué tests manuales se documentan en el PR.

## 11. Plan de rollout

- ¿Requiere feature flag? Si sí, nombre del flag.
- ¿Requiere migración de datos existentes?
- ¿Hay que comunicar a operadores antes del lanzamiento?
- ¿Es reversible? Si algo sale mal en producción, ¿cómo se vuelve atrás?

## 12. Métricas de éxito

Cómo se va a saber, una vez en producción, si esta feature cumplió su objetivo. Idealmente 1–3 métricas concretas observables.

## 13. Preguntas abiertas

Cualquier decisión que aún no esté tomada al momento de aprobar el spec. Cada pregunta debe tener un dueño y una fecha límite.

- [ ] **Pregunta**: ¿…?  **Dueño**: <nombre>  **Antes de**: <fecha>

Si no hay preguntas abiertas, escribir "Ninguna" — es señal de spec sólido.
```

## Ciclo de vida del spec

El campo **Estado** en el encabezado refleja en qué etapa está:

- **draft**: el autor lo está escribiendo. No se discute aún.
- **in-review**: listo para feedback. El usuario lo lee y comenta.
- **approved**: aprobado, listo para implementar. A partir de acá, cambios al spec requieren actualizar la fecha y comunicarlo.
- **implemented**: feature mergeada a `main`. El spec queda como documentación histórica.
- **archived**: spec rechazado o reemplazado. No se borra; queda como registro.

## Reglas de escritura

- **Escribí en español**. Es la lengua de trabajo del proyecto.
- **Voz activa y presente**. "El sistema valida el código" es mejor que "el código será validado por el sistema".
- **Concreto sobre abstracto**. "El campo `customer_email` debe ser un email válido según RFC 5322" es mejor que "el email debe estar bien formateado".
- **Sin jerga innecesaria**. El spec debería poder leerlo alguien técnico que no conozca el código.
- **Markdown limpio**. Usá headers, listas y bloques de código. Evitá tablas decorativas y emojis.
- **Longitud razonable**. Un spec típico vive entre 150 y 400 líneas. Si pasás de 500, probablemente la feature debe partirse.
- **Diagramas solo cuando aportan**. Un diagrama Mermaid de máquina de estados o de flujo es útil; un diagrama de "estructura general" suele ser ruido.

## Ejemplo: spec mínimo bien escrito

Como referencia, así se vería un spec pequeño pero completo:

```markdown
# 0007 — Recordatorio por email 24h antes del tour

- **Estado**: approved
- **Autor**: santi
- **Creado**: 2026-05-19
- **Última actualización**: 2026-05-20
- **Rama**: feat/0007-recordatorio-24h
- **PR**: #14

## 1. Contexto y motivación

Los turistas reservan tours con varios días o semanas de anticipación. Sin un recordatorio cercano a la fecha, una parte significativa olvida el tour o llega tarde al punto de encuentro. Esto afecta la experiencia, genera no-shows que el operador no puede compensar (la política no devuelve plata <24h), y genera reseñas negativas.

## 2. Objetivos

- Enviar a cada cliente un email de recordatorio 24h antes del inicio del tour reservado.
- Incluir en el recordatorio toda la información operativa relevante (hora, punto de encuentro, qué llevar, contacto del guía).
- Permitir que el cliente acceda fácilmente a su reserva desde el email.

## 3. Fuera de alcance

- No se envían recordatorios por WhatsApp o SMS (queda para iteraciones futuras).
- No se envían recordatorios adicionales en otros horarios (1h antes, día de).
- No hay recordatorio al guía (su asignación se maneja en otro spec).

## 4. Historias de usuario

> Como turista que reservó con anticipación, quiero recibir un email recordatorio 24h antes del tour, para no olvidar la fecha y llegar preparado.

Criterios de aceptación:

- [ ] El email se envía aproximadamente 24h antes de `tour_instance.start_time`, con tolerancia de ±15 minutos.
- [ ] El email solo se envía si la reserva está en estado `confirmed`.
- [ ] Si la reserva fue cancelada, no se envía.
- [ ] El email incluye: nombre del tour, fecha, hora, punto de encuentro (con link a mapa), qué llevar, contacto del operador, link a la reserva.
- [ ] Si el email falla, se reintenta hasta 3 veces con backoff exponencial.

## 5. Diseño técnico

Cuando se confirma una reserva (`booking.status → confirmed`), se inserta una fila en `notifications` con `kind=reminder_24h`, `channel=email`, `scheduled_for = tour_instance.start_time - 24h`.

El worker `send-notifications` corre cada minuto, busca `notifications WHERE status='pending' AND scheduled_for <= NOW()`, las envía via Resend, y marca como `sent` o `failed`.

Si la reserva se cancela, el worker marca la notificación pendiente como `cancelled` antes de enviarla.

## 6. Modelo de datos

Sin cambios al schema. La tabla `notifications` ya existe con todas las columnas necesarias.

## 7. Estados y transiciones

Sin cambios a la máquina de estados de bookings. Se usa la máquina existente de notifications: `pending → sent | failed | cancelled`.

## 8. Casos borde y errores

- **Reserva cancelada después de programar el recordatorio**: el worker debe verificar que la reserva siga en `confirmed` antes de enviar; si no, marcar la notificación como `cancelled`.
- **Tour reservado con menos de 24h de anticipación**: no debería ocurrir (la regla de negocio bloquea reservas <24h), pero por seguridad: si `scheduled_for < NOW()` al momento de crear la notificación, se envía inmediatamente.
- **Falla de Resend**: reintento con backoff (1min, 5min, 30min). Después de 3 fallos, marcar como `failed` y loggear.
- **Cambio de hora del tour por parte del operador**: fuera de alcance en este spec; se documentará en un spec aparte cuando se implemente la edición de tour_instances.

## 9. Impacto en otras áreas

- Nuevo template de email en `web/emails/Reminder24h.tsx`.
- Nuevos textos i18n en ES y EN.
- Modificación del worker para incluir el job (ya existe, solo se agrega lógica del kind).
- Sin impacto en el panel admin (aunque a futuro podría agregarse vista de "notificaciones enviadas").

## 10. Plan de tests

- Unit: función que calcula `scheduled_for` dado un `tour_instance.start_time`.
- Unit: lógica de "no enviar si booking ya no está confirmed".
- Integración: insertar booking, avanzar reloj a `start_time - 24h`, ejecutar worker, verificar que se llamó a Resend con el payload correcto.
- Integración: cancelar booking, verificar que notificación queda en `cancelled` y no se envía.

## 11. Plan de rollout

- No requiere feature flag (es un canal nuevo, no reemplaza nada).
- No requiere migración de datos.
- Para reservas existentes en `confirmed` al momento del deploy, ejecutar un script idempotente que cree las notificaciones faltantes.
- Reversible: en caso de problema, deshabilitar el job en el worker.

## 12. Métricas de éxito

- ≥95% de los recordatorios se envían dentro de la ventana ±15min de la hora target.
- Reducción medible (≥20%) en la tasa de no-show a partir del segundo mes de uso.

## 13. Preguntas abiertas

Ninguna.
```

## Trabajando con specs existentes

- **Editar un spec aprobado**: actualizá la fecha "Última actualización", documentá brevemente al inicio de la sección afectada qué cambió y por qué, y pedí re-aprobación si el cambio toca objetivos o alcance.
- **Marcar un spec como implementado**: cambiar `Estado` a `implemented` después del merge del PR. Verificar que el campo `PR` apunte al PR correcto.
- **Archivar un spec**: cambiar `Estado` a `archived` y agregar al final una sección "## Razón de archivado" explicando por qué.

## Anti-patrones

- **Specs vagos** ("se mejora la UX de reservas"): inútiles. El spec debe ser tan específico que dos personas leyéndolo lleguen a la misma implementación.
- **Specs que describen código** ("se crea una función `sendReminder` en `lib/notifications/`"): demasiado detalle de implementación. El spec dice qué y por qué; el código dice cómo.
- **Specs que mezclan varias features**: si tu spec tiene 5 objetivos no relacionados, partilo en varios specs.
- **Specs sin "fuera de alcance"**: garantía de scope creep durante implementación.
- **Specs sin criterios de aceptación**: garantía de "ya está terminado" / "no, todavía falta" después.

# 0005 — Motor de disponibilidad y holds temporales

- **Estado**: approved
- **Autor**: KthArg
- **Creado**: 2026-05-26
- **Última actualización**: 2026-05-26
- **Rama**: feat/0005-motor-disponibilidad-holds
- **PR**: —

## 1. Contexto y motivación

El portal público (spec 0004) muestra fechas disponibles al turista, pero el sistema aún no puede garantizar que dos personas no reserven el mismo cupo al mismo tiempo. Antes de construir el checkout con pago (spec 0006), necesitamos un mecanismo que:

1. Verifique disponibilidad real bajo concurrencia.
2. Reserve cupos temporalmente durante el flujo de checkout (el turista tardará 2–5 minutos en completar el pago; en ese tiempo el cupo debe estar "tomado" para otros visitantes).
3. Libere automáticamente los cupos que no completaron el pago.

Sin este mecanismo, dos turistas podrían iniciar checkout para el último cupo disponible y ambos llegar al pago. El spec 0006 (checkout) depende de esta capa como prerequisito.

## 2. Objetivos

- Exponer una función `checkAvailability(instanceId, seats)` que retorna si hay cupos suficientes considerando bookings confirmados y holds activos.
- Exponer una función `createHold(instanceId, seats, sessionToken)` que reserva cupos temporalmente por 15 minutos bajo concurrencia segura.
- Exponer una función `releaseHold(holdId)` para liberar un hold explícitamente (ej: usuario abandona checkout).
- Ejecutar un job en el worker que libera holds expirados automáticamente cada minuto.
- Garantizar que no se pueda superar `capacity_total` incluso con requests concurrentes simultáneos.

## 3. Fuera de alcance

- Interfaz de usuario para el checkout (spec 0006).
- Persistencia del estado del checkout entre recargas (también spec 0006).
- Holds para guías o recursos del tour (no aplica en MVP).
- Notificaciones al turista cuando su hold expira.
- Panel admin para ver holds activos (spec futuro).
- Holds con duración configurable por tour (siempre 15 min en MVP).

## 4. Historias de usuario

> Como sistema de checkout, quiero reservar temporalmente cupos para un turista mientras completa el pago, para que otros usuarios no puedan tomar esos mismos cupos durante el proceso.

Criterios de aceptación:

- [ ] `createHold` retorna un `hold_id` y `expires_at` si hay cupos suficientes.
- [ ] `createHold` retorna error si `available_seats < seats` solicitados.
- [ ] Dos llamadas simultáneas a `createHold` para el último cupo disponible resultan en exactamente una aprobada y una rechazada.
- [ ] Un hold expira automáticamente a los 15 minutos si no se convierte en reserva.
- [ ] Los cupos de holds expirados quedan disponibles nuevamente para nuevas reservas.

> Como turista, quiero que el sistema me informe si una fecha que elegí ya no tiene cupos, para no perder tiempo en un checkout que va a fallar.

Criterios de aceptación:

- [ ] `checkAvailability` descuenta holds activos además de `capacity_reserved` al calcular cupos disponibles.
- [ ] Si la instancia no existe o tiene `status != 'available'`, `checkAvailability` retorna 0 cupos.

## 5. Diseño técnico

### Cálculo de disponibilidad

```
available = capacity_total - capacity_reserved - SUM(held_seats WHERE status='active' AND expires_at > NOW())
```

- `capacity_reserved` refleja bookings **confirmados** (se incrementa al confirmar una reserva en spec 0006).
- `held_seats` refleja holds **activos** (temporales). No tocan `capacity_reserved`.
- Esta separación evita inconsistencias si el job de expiración se demora.

### Concurrencia segura en `createHold`

El hold se crea dentro de una transacción con `SELECT ... FOR UPDATE` sobre la fila de `tour_instances`. Esto serializa los intentos concurrentes:

```sql
BEGIN;
SELECT id, capacity_total, capacity_reserved
  FROM tour_instances
  WHERE id = $1
  FOR UPDATE;

-- calcular available considerando holds activos en la misma transacción
-- si available >= $seats: INSERT INTO tour_holds
-- si no: ROLLBACK / lanzar error
COMMIT;
```

La función se expone como RPC en Supabase (función SQL con `SECURITY DEFINER`) para que el lock sea atómico. Llamarla desde server action garantiza que el lock no cruza procesos.

### Módulo `lib/booking/availability.ts`

Tres funciones exportadas:

- `checkAvailability(instanceId: string, seats: number): Promise<{ available: number; canBook: boolean }>`
- `createHold(instanceId: string, seats: number, sessionToken: string): Promise<{ holdId: string; expiresAt: string }>`
- `releaseHold(holdId: string): Promise<void>`

Las tres usan el cliente Supabase con `service_role` (acceso pleno). En contexto web, se llaman desde server actions; en el worker, directamente.

### Job del worker: `release-expired-holds`

Corre cada 60 segundos. Marca como `'expired'` todos los holds con `status = 'active'` y `expires_at < NOW()`. No hace UPDATE en `tour_instances` (los cupos se liberan automáticamente en la fórmula de disponibilidad al considerar solo holds `active AND expires_at > NOW()`).

## 6. Modelo de datos

### Tabla nueva: `tour_holds`

| Columna            | Tipo                   | Notas                                                   |
| ------------------ | ---------------------- | ------------------------------------------------------- |
| `id`               | `uuid` PK              | `gen_random_uuid()`                                     |
| `tour_instance_id` | `uuid` FK              | `tour_instances.id` ON DELETE CASCADE                   |
| `session_token`    | `text` NOT NULL        | identificador del checkout (UUID generado en cliente)   |
| `held_seats`       | `integer` NOT NULL     | CHECK > 0                                               |
| `status`           | `text` NOT NULL        | CHECK IN ('active', 'released', 'expired', 'converted') |
| `expires_at`       | `timestamptz` NOT NULL | `NOW() + INTERVAL '15 minutes'`                         |
| `created_at`       | `timestamptz` NOT NULL | `NOW()`                                                 |

Índices:

- `(tour_instance_id, status, expires_at)` — para el cálculo de disponibilidad.
- `(status, expires_at)` WHERE `status = 'active'` — para el job de expiración.

Migración: `20260526000011_create_tour_holds.sql`

### Función SQL nueva: `create_hold_atomic`

Función `SECURITY DEFINER` que ejecuta la transacción con `FOR UPDATE` atómicamente. Retorna el hold creado o lanza excepción si no hay cupos.

```sql
CREATE OR REPLACE FUNCTION public.create_hold_atomic(
  p_instance_id uuid,
  p_seats       integer,
  p_session     text
) RETURNS tour_holds ...
```

Migración: incluida en `20260526000011_create_tour_holds.sql`.

### Sin cambios a `tour_instances`

`capacity_reserved` ya existe y sigue representando solo bookings confirmados. No se modifica el schema de esta tabla.

## 7. Estados y transiciones

```
tour_holds.status:

              createHold()
                  │
                  ▼
              [ active ]
             /    │    \
            /     │     \
    15 min      releaseHold()   spec 0006: booking confirmado
    pasan         │                    │
       │          ▼                    ▼
   [ expired ] [ released ]       [ converted ]
```

Los tres estados terminales (`expired`, `released`, `converted`) son inmutables.

## 8. Casos borde y errores

- **Concurrencia**: dos requests para el último cupo llegan al mismo tiempo. El `FOR UPDATE` serializa; el segundo verá `available = 0` dentro de la transacción y recibirá error `HOLD_NO_CAPACITY`.
- **Hold para instancia `full` o `cancelled`**: `checkAvailability` retorna 0 cupos. `createHold` lanza `HOLD_INSTANCE_UNAVAILABLE`.
- **Hold para instancia pasada** (`starts_at <= NOW()`): `checkAvailability` retorna 0. `createHold` lanza `HOLD_INSTANCE_PAST`.
- **`session_token` duplicado**: el mismo usuario puede llamar `createHold` dos veces por error de red. Agregar `UNIQUE (tour_instance_id, session_token)` con `ON CONFLICT DO NOTHING` y retornar el hold existente si aún es `active`.
- **Hold expirado antes de que el usuario complete el pago**: spec 0006 debe verificar que el hold sigue `active` antes de procesar el pago. Si expiró, reintentar `createHold` o abortar con error amigable.
- **Job de expiración caído**: los holds expirados no se marcan `expired` en la tabla, pero el cálculo de disponibilidad los ignora automáticamente (la condición `expires_at > NOW()` en la query de disponibilidad es suficiente). El job actualiza el estado por limpieza, no por correctitud.
- **`held_seats` mayor que `capacity_total`**: imposible si `createHold` valida correctamente, pero agregar CHECK en DB como defensa en profundidad.

## 9. Impacto en otras áreas

- **Worker**: nuevo job `release-expired-holds.ts` que se registra en `src/index.ts` junto al job de generación de instancias.
- **Panel admin**: sin impacto en esta etapa.
- **Portal público**: `checkAvailability` se usará desde la página de detalle del tour en spec 0006 para deshabilitar el botón "Reservar" si no hay cupos.
- **i18n**: sin textos nuevos en esta spec (los errores son internos al sistema; los mensajes para el usuario van en spec 0006).
- **Pagos**: sin impacto directo. El hold queda en `'active'` hasta que spec 0006 lo marque `'converted'` al confirmar el pago.

## 10. Plan de tests

### Tests unitarios (`worker/src/jobs/release-expired-holds.test.ts`)

- El job marca como `expired` solo los holds con `expires_at < NOW()` y `status = 'active'`.
- Holds en estado `released`, `converted` o `expired` no se modifican.

### Tests de integración (`web/lib/booking/availability.test.ts`)

- `checkAvailability` retorna `available = capacity_total` cuando no hay holds ni bookings.
- `checkAvailability` descuenta holds activos correctamente.
- `checkAvailability` ignora holds expirados.
- `createHold` crea hold y retorna `holdId` + `expiresAt` cuando hay cupos.
- `createHold` falla con error cuando `available < seats`.
- `releaseHold` pasa hold a `released`.

### Tests de concurrencia (`web/lib/booking/availability.concurrency.test.ts`)

- 10 requests simultáneos de `createHold(instanceId, 1)` sobre una instancia con `capacity_total = 5` resultan en exactamente 5 holds creados y 5 errores.
- 2 requests simultáneos de `createHold(instanceId, seats=last_available_seat)` resultan en exactamente 1 aprobado y 1 rechazado.

## 11. Plan de rollout

- No requiere feature flag.
- No hay datos existentes en `tour_holds` (tabla nueva).
- Reversible: la función `create_hold_atomic` puede desactivarse con `revoke execute`, y la tabla puede truncarse sin impacto en `tour_instances`.
- El job del worker entra en el mismo proceso que el job existente; si falla, los holds expirados simplemente no se actualizan en DB pero el sistema sigue siendo correcto.

## 12. Métricas de éxito

- Cero casos de overbooking (más bookings que `capacity_total`) en los primeros 30 días de spec 0006 en producción.
- El job de expiración corre exitosamente en ≥99% de las ejecuciones.
- El tiempo de respuesta de `createHold` es <500ms en el percentil 95.

## 13. Preguntas abiertas

Ninguna.

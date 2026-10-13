# Changelog — 0047 Dos tours fijos: diurno y nocturno

Spec: [0047-dos-tours-fijos-diurno-nocturno.md](./0047-dos-tours-fijos-diurno-nocturno.md)
Rama: feat/0047-dos-tours-fijos

## 2026-10-13 07:05 — El tour de prueba se borra en lugar de archivarse

**Hecho**:

- La migración …061 borra entero el tour `hola` (por slug) con sus salidas, apartados, reservas, pagos, reembolsos y avisos, antes del bloque que archiva cualquier otro tour.
- Probado en la base local dentro de una transacción revertida, con un tour `hola` que tenía apartado, reserva, pago y reembolso: no queda nada y los dos fijos siguen.
- Respaldo de producción previo en `backups/prod-2026-10-13-pre-060`.

**Por qué / decisiones**:

- Decisión del usuario: es una prueba y no hace falta guardar registro.
- Va en la migración porque es la única vía para ejecutar SQL en producción desde esta máquina (`supabase db push`).
- Las filas de `audit_logs` del tour quedan: la tabla es de solo agregar, también para la migración.

**Pendiente**:

- Aplicar …060 y …061 en producción y promover a `main`.
## 2026-10-13 06:40 — PR B: portada partida y páginas dedicadas

**Hecho**:

- Portada `/tours` como díptico: la mitad del día (arena, sol que asoma desde abajo) y la de la noche (tema noche, luna y estrellas). Con puntero, la mitad que se mira gana ancho; bajo 900 px se apilan. Reemplaza `TourGrid` y `TourCard`, que se borraron.
- Cada mitad muestra nombre, descripción recortada a tres líneas, duración, precio "desde" y "Ver fechas". En pausa es un bloque sin enlace con el nombre y "No disponible por ahora".
- Página de cada tour: el héroe lleva su astro y su fondo (sol o luna); con foto, manda la foto. Al final, una franja invita al otro tour con el tema de ese otro tour, y un enlace vuelve a la portada.
- Encabezado: enlaces "Día" y "Noche" con ícono; en teléfonos angostos queda solo el ícono, con el nombre para lectores de pantalla.
- Textos nuevos de la portada: "De día o de noche" / "By day or by night" y su bajada.
- Verificado en navegador a 1280, 360 y 320 px, sin scroll horizontal, en ES y EN. Web unit 554, lint sin errores, typecheck limpio.

**Por qué / decisiones**:

- Sin colores ni tipografías nuevas: todo sale de los tokens del 0042; las transparencias son `color-mix` sobre esos tokens.
- El enlace de cada mitad cubre todo el bloque, pero se anuncia con el nombre y los datos (`aria-labelledby` / `aria-describedby`), no con la descripción entera.
- Con foto el astro se oculta y el velo oscurece arriba y abajo: el texto en hueso sobre el sol no se leía (hallazgo del code-reviewer).
- El ensanche al pasar el puntero solo corre sin `prefers-reduced-motion`.
- La rama "tour en pausa" de la página pasó a `PausedTour.tsx` para no superar las 150 líneas.

**Pendiente**:

- Nada del spec. Queda fuera: verlo con las fotos reales (el seed no trae fotos, así que el caso con foto se revisó solo en el CSS), tests de componente de `TourPanel` (el repo no tiene Testing Library) y unificar el sol y la luna, que hoy están en dos módulos CSS.
- El título y la bajada de la portada los redacté yo: revisarlos con el cliente.

## 2026-10-13 06:05 — PR A: esquema, panel, pausa y rutas por tipo de tour

**Hecho**:

- Migraciones …060 (`paused` en `tour_status`) y …061 (`tours.kind`, índice único, CHECK, disparador `tours_fixed_guard`, sin políticas ni grants de INSERT/DELETE, anon lee los tours en pausa, archivado de los tours existentes e inserción de los dos fijos). Seed reescrito: completa los dos fijos por `kind`.
- Panel: el menú lleva a `/dashboard/tours/day` y `/night`; se fueron la lista, "Nuevo tour", archivar y el campo slug. Botón "Pausar venta" / "Reanudar venta" con auditoría (`tour.paused`, `tour.resumed`).
- Público: rutas `/tours/[kind]` y `/tours/[kind]/checkout`; un tour en pausa muestra solo nombre y aviso; el encabezado enlaza a los dos tours. La portada sigue con las tarjetas de antes (el diseño nuevo es el PR B).
- La pausa cierra la venta en las dos acciones que crean el apartado (`isTourOnSale`); el paso 2 del diferido no la repite.
- El turno de una salida sale del `kind` del tour (`shiftOfDeparture`); se borraron `shiftOfTour`, `getTourShift` y el valor `both`.
- Worker: `generate-tour-instances` corre cada hora.
- Suites: web unit 554, web integración 736, worker unit 280, worker integración 111. Verificado en navegador: pausar, aviso público, checkout bloqueado por URL directa, reanudar.

**Por qué / decisiones**:

- Decisión del usuario al aprobar: los dos tours nacen `active`, no en pausa. Sin horarios ni precios el sitio los muestra sin fechas.
- `TourKind` es un objeto `as const` y no un `enum`: los tipos de la base son literales `'day' | 'night'` y un enum de TypeScript no es asignable a ellos.
- La política de anon quedó como `status <> 'archived'` para que …061 no use el valor que agrega …060.
- `updateTour` sigue recibiendo el id (no el `kind`): así los tests lo ejercitan con tours desechables sin `kind` y los dos fijos casi no se tocan en la suite.
- Al guardar se vuelve a la misma página con `?saved=1`, y la `key` del formulario incluye `updated_at`: sin eso un segundo guardado borraba y reinsertaba las filas nuevas (hallazgo del code-reviewer).
- El bloque que archiva los tours viejos toma el mismo lock que `create_hold_atomic` y aborta también con un apartado en curso (hallazgo del db-schema-guardian). Se probó a mano en la base local dentro de una transacción revertida: archiva, cancela solo las salidas futuras, audita, y aborta con una reserva viva.
- Reanudar distingue qué falta con tres códigos (`tour_resume_missing_info`, `_schedule`, `_price`) en lugar del único `tour_resume_incomplete` del spec.

**Pendiente**:

- PR B: portada partida y páginas dedicadas (reemplaza `TourGrid` y `TourCard`).
- Del plan de tests (§10) no se escribió: checkout inmediato contra un tour en pausa en integración (hay unitario de la acción y la compuerta `isTourOnSale` se prueba contra la base), y cancelar con reembolso una reserva de un tour pausado (se prueba que la reserva y la salida quedan intactas; ninguna función SQL lee `tours.status`). `tours.test.ts` y `table-grants.test.ts` no necesitaron cambios: los permisos nuevos están en `fixed-tours-schema.test.ts`.
- El staff sigue viendo "Guardar" habilitado y recibe el error al enviar, como antes.

**Notas para retomar**:

- Después de `supabase db reset`, si los tests de sesión fallan con `AuthRetryableFetchError`, Kong quedó apuntando al contenedor viejo de auth: `docker restart supabase_kong_booking-platform`.
- Producción: aplicar …060 y …061 con el worker detenido y antes del merge a `main`; la …061 aborta si `hola` tiene reservas vivas, un cobro abierto o un apartado en curso en salidas futuras.

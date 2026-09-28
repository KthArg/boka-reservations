# Changelog — 0034 Términos definitivos y publicación

Spec: [0034-terminos-definitivos-y-publicacion.md](./0034-terminos-definitivos-y-publicacion.md)
Rama: feat/0034-terminos-definitivos

## 2026-09-27 — Implementación completa

**Hecho**:

- **Migración `…048`**:
  - `business_settings`: identidad del operador (`operator_*`, texto, `''` por defecto),
    `operator_has_liability_policy` y `no_show_tolerance_minutes` (15, CHECK 0–120). Solo el
    admin puede editarlos (grants por columna + RLS).
  - `bookings.no_show_tolerance_minutes`, copiada por trigger al crear la reserva: cambiar la
    tolerancia no altera reservas hechas.
  - `refunds_no_processing_fee_check`: la base rechaza cualquier reembolso con comisión.
  - `tours`: `excludes_*`, `requirements_*`, `child_age_min/max` con `tours_child_ages_check`.
- **Textos legales como datos** (`web/content/legal/`): términos y aviso de privacidad en ES y
  EN, versión `2026-09-27`, armados a partir de la identidad del operador. Registro de versiones,
  rutas `/terms`, `/terms/<versión>`, `/privacy`, `/privacy/<versión>`, botón de imprimir.
- **Reembolsos siempre del 100 %**: `computeRefund` sin comisión; con menos de 24 h o no
  presentación, nada. Se borraron `refund-fee-notice` y `REFUND_FEE_FROM_TERMS_VERSION`.
  Diálogos de cancelación del panel y del turista simplificados.
- **Compuertas de venta**: el checkout (inmediato y diferido) no vende si falta un dato del
  operador (`sales-not-enabled`) ni si el tour no tiene la información que prometen los términos.
  La casilla faltante tiene su propio mensaje (`consent-required`).
- **Resumen de compra** en el checkout: vendedor, cédula, punto de encuentro, tolerancia, aviso
  de los 15 minutos de apartado, botón "Pagar USD …".
- **Panel**: sección Identidad del operador en Configuración (auditada), sección de información
  publicada en el formulario de tours, detalle público del tour con "no incluye", requisitos y
  edades.
- **Correos**: pie legal con la identidad del operador y enlaces a los textos (distinto para
  guías); la confirmación muestra el IVA incluido (13 %), la versión de términos aceptada y la
  tolerancia.
- **Pie del sitio** compartido entre las páginas públicas y las de la reserva.

**Decisiones**:

- **La identidad del operador vive en la base, no en el código**: el operador la completa desde
  el panel y los textos se arman con ella. Mientras falte, no se vende; así nunca se publica un
  término con huecos.
- **La tolerancia se copia a cada reserva**: es parte de lo que el turista aceptó al pagar.
- **El IVA se informa, no se calcula aparte**: los precios ya lo incluyen; el correo muestra
  cuánto es.

**Pendiente**:

- Specs 0035 (cierre por mínimo a 24 h, cambio de fecha, revisión por clima o seguridad,
  devolución por transferencia) y 0036 (datos según el aviso): los términos publicados ya
  describen ese comportamiento.
- Spec 0037: factura electrónica ante Hacienda.
- Cargar los datos reales del operador en producción antes de abrir ventas
  (`docs/lanzamiento-checklist.md`).

## 2026-09-27 — Correcciones de las revisiones

Revisiones de db-schema-guardian, payment-flow-auditor y code-reviewer sobre el PR #84.

**Hecho**:

- Los términos nombran el botón real del correo: "Ver mi reserva" / "View my booking".
- `cancel_booking` (reemplazada en `…048`, misma firma): comisión siempre 0 (`INVALID_FEE`) y
  la cancelación del turista reembolsa el total o nada (`INVALID_REFUND_AMOUNT`).
- El trigger de la tolerancia falla (`BUSINESS_SETTINGS_MISSING`) si no existe la fila de
  configuración, en lugar de dejar la reserva sin tolerancia.
- Compuertas que fallan cerradas: la identidad ilegible no da un 500 sino "venta cerrada"; el
  precio de niño se lee con su propio manejo de error; el paso 2 del cobro diferido vuelve a
  verificar las compuertas antes de crear la reserva.
- `computeRefund` lanza ante una fecha inválida (antes devolvía el total).
- Cancelar desde el panel una reserva cobrada exige el monto que mostró el diálogo.
- Plantillas del worker sin la línea de comisión; el correo de confirmación solo enlaza versiones
  legales publicadas (espejo de versiones en `booking-legal.ts`).
- Acción de identidad del operador: aborta si no puede leer el valor anterior (lo necesita la
  auditoría); test de integración nuevo (`operator-settings-action.test.ts`).
- Formulario de tours: las dos edades o ninguna, igual que el CHECK.
- Montos del checkout con el separador del idioma; minutos del apartado desde
  `HOLD_TTL_MINUTES`; tiquetes en plural y sin tipos en cero.
- Impresión sin la cabecera del sitio; excepción de `max-lines` acotada a los textos legales;
  el registro legal ignora claves heredadas en la versión que llega por URL.

**Decisiones**:

- **Textos legales como datos `.ts`, no componentes TSX** (el spec §5 hablaba de
  `<texto>/<versión>/{es,en}.tsx`): un documento es una lista de secciones y bloques que arma
  una sola vista, con los datos del operador como parámetro. Así el test de contenido recorre
  todas las versiones buscando marcadores, y la vista impresa y la web son la misma.

**Pendiente**:

- Borrar la firma vieja de 4 parámetros de `cancel_booking` (`…042`): anotado en "Después del
  lanzamiento" del checklist.
- La factura electrónica que prometen los términos se emite a mano hasta el spec 0037
  (checklist de lanzamiento).

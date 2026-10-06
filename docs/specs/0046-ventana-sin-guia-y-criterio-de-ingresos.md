# 0046 — Ventana de "Salidas sin guía" configurable y criterio de fecha en el reporte de ingresos

- **Estado**: approved
- **Autor**: Kenneth (con Claude Code)
- **Creado**: 2026-10-06
- **Última actualización**: 2026-10-06
- **Rama**: dev (push directo a `main`, autorizado por el usuario)
- **PR**: (sin PR)

## 1. Contexto y motivación

Quedaban dos preguntas abiertas para el cliente:

- La bandeja "Salidas sin guía" (spec 0043) avisa de las salidas de los próximos 14 días. El número es una constante del código; no sabemos con cuánta anticipación asigna guías el operador.
- El reporte de ingresos (spec 0012) agrupa por la fecha del pago. El spec dejó abierta si el operador lo necesita por la fecha de la salida, para saber cuánto dejó cada tour realizado.

En lugar de esperar la respuesta, las dos pasan a ser elecciones del operador en el panel.

Actores: **admin** (configura la ventana), **admin y staff** (ven la bandeja y los reportes).

## 2. Objetivos

- Permitir que el admin cambie desde Configuración con cuántos días de anticipación avisa la bandeja "Salidas sin guía".
- Permitir que quien mira el reporte de ingresos elija si el rango de fechas se aplica a la fecha del pago o a la fecha de la salida.

## 3. Fuera de alcance

- No cambian el umbral de urgencia (24 horas) ni el tope de 30 salidas de la bandeja.
- No cambian los reportes de ocupación ni de reembolsos, que conservan su criterio actual.
- No se guarda el criterio elegido: es un filtro de la página, con "fecha de pago" por defecto.
- No hay ventana por tour.

## 4. Historias de usuario

> Como admin, quiero definir con cuántos días de anticipación me avisa el panel de una salida con turistas y sin guía, para que coincida con cómo organizo a los guías.

> Como admin o staff, quiero ver los ingresos según la fecha de la salida, para saber cuánto dejaron los tours de un período aunque se hayan pagado antes.

Criterios de aceptación:

- [ ] Configuración muestra "Aviso de salidas sin guía (días de anticipación)", entero de 1 a 90, valor inicial 14. Solo el admin lo cambia.
- [ ] La bandeja y la marca "Sin guía" de la tabla usan ese valor. El texto de la bandeja nombra la cantidad de días vigente.
- [ ] El reporte de ingresos tiene un selector "Ingresos por": "Fecha de pago" (por defecto) o "Fecha de salida", junto al rango de fechas.
- [ ] Con "Fecha de pago", los números son los mismos de hoy.
- [ ] Con "Fecha de salida", el bruto suma los pagos (`succeeded` o `refunded`) de las reservas cuya salida empieza dentro del rango, y lo reembolsado suma los reembolsos `succeeded` de esas mismas reservas, se hayan pagado o reembolsado cuando sea.
- [ ] El criterio elegido viaja en la URL (`basis=payment|departure`), se conserva al cambiar el rango y se aplica al CSV de ingresos y a "Top tours".
- [ ] Un valor desconocido de `basis` se trata como "Fecha de pago".
- [ ] El título de la sección de ingresos dice qué criterio se está usando.

## 5. Diseño técnico

- **Ventana**: columna `business_settings.guide_warning_horizon_days`. La server action `updateBusinessSettings` la valida y la guarda. `needsGuide` y `guidelessTray` reciben los días como parámetro obligatorio, para que la bandeja y la marca de la tabla no puedan divergir; la página de Salidas los lee junto con la política del mínimo. La constante `GUIDE_WARNING_HORIZON_DAYS` queda como valor por defecto y rango de respaldo si la configuración no se puede leer.
- **Ingresos**: `report_revenue` suma el parámetro `p_basis text DEFAULT 'payment'`. Con `'departure'`, los dos subtotales filtran por `tour_instances.starts_at` en lugar de `payments.created_at` y `refunds.created_at`. Cambia la firma, así que se hace `DROP` de la de dos argumentos y `CREATE` de la de tres con los mismos permisos (`authenticated`, sin `anon`). Una llamada con dos argumentos sigue funcionando por el valor por defecto: el código viejo no se rompe entre la migración y el deploy.
- **Página**: `basis` es un parámetro de búsqueda validado contra una constante de `shared/constants/reports.ts`. El filtro es un `<select>` dentro del mismo formulario GET.

## 6. Modelo de datos

- **Tabla**: `business_settings` — **alter**: `guide_warning_horizon_days integer NOT NULL DEFAULT 14`, CHECK `BETWEEN 1 AND 90`; `GRANT UPDATE (guide_warning_horizon_days) … TO authenticated`.
- **Función**: `report_revenue(timestamptz, timestamptz, text)` reemplaza a `report_revenue(timestamptz, timestamptz)`. `SECURITY INVOKER`, `STABLE`, `search_path = ''`.
- **Migración**: `20261006000059_ventana_sin_guia_y_criterio_de_ingresos.sql`.

## 7. Estados y transiciones

No aplica.

## 8. Casos borde y errores

- **Reserva cambiada de fecha**: con "Fecha de salida" cuenta en la salida actual de la reserva, no en la original.
- **Salida cancelada con pagos reembolsados**: con "Fecha de salida" aparece con neto cero cuando el reembolso total ya está acreditado; mientras esté pendiente, el neto sigue mostrando el cobro.
- **Salidas y reservas canceladas**: con "Fecha de salida" también cuentan; el criterio cambia a qué fecha se aplica el rango, no qué pagos entran.
- **Sección Reembolsos**: sigue por la fecha del reembolso; con "Fecha de salida" sus totales pueden no coincidir con la columna "reembolsado" de Ingresos, y la página lo aclara.
- **Salida futura ya pagada**: con "Fecha de salida" aparece si el rango la incluye; el rango puede abarcar fechas futuras.
- **`p_basis` desconocido en la base**: la función lo trata como `'payment'`.
- **Configuración ilegible**: la bandeja usa 14 días.
- **Ventana menor a 1 día o mayor a 90**: la rechaza el formulario y, en última instancia, el CHECK.

## 9. Impacto en otras áreas

- **Panel**: un campo nuevo en Configuración; un selector nuevo en Reportes.
- **i18n**: textos nuevos en ES y EN.
- **Worker, emails, pagos**: sin impacto.
- **Reportes**: el CSV de ingresos sale con el criterio elegido; el nombre del archivo lo indica.

## 10. Plan de tests

- **Unit**: `needsGuide` con ventanas de 3 y 30 días; el esquema del formulario acepta 1 y 90 y rechaza 0, 91 y vacío; el parser de `basis` devuelve `payment` ante un valor desconocido.
- **Integración**: `report_revenue` con `'departure'` — un pago hecho fuera del rango de una salida dentro del rango cuenta; uno hecho dentro del rango de una salida fuera del rango no cuenta; el reembolso sigue a la salida; con dos argumentos responde igual que con `'payment'`. La action guarda la ventana solo para admin. Grants de la función.

## 11. Plan de rollout

- Sin feature flag. Respaldo, migración y después el código.
- Reversible, primero el código y después la base (el código nuevo envía `p_basis`): `DROP` de la función de tres argumentos y `CREATE` de la de dos (cuerpo de …046), y `DROP COLUMN`.

## 12. Métricas de éxito

- El operador deja de pedir cambios de código para ajustar la ventana o para ver ingresos por salida.

## 13. Preguntas abiertas

Ninguna.

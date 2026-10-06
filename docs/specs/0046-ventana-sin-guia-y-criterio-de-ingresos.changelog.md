# Changelog — 0046 Ventana de "Salidas sin guía" configurable y criterio de fecha en ingresos

Spec: [0046-ventana-sin-guia-y-criterio-de-ingresos.md](./0046-ventana-sin-guia-y-criterio-de-ingresos.md)

## 2026-10-06 — Implementación

**Decisión del usuario**: en lugar de esperar las dos confirmaciones del cliente, ambas pasan a
ser elecciones del operador en el panel.

**Hecho**:

- Migración `…059`: `business_settings.guide_warning_horizon_days` (1 a 90, inicial 14) y
  `report_revenue` con `p_basis` (`payment` por defecto o `departure`). La función de dos
  argumentos se reemplaza por la de tres, con los mismos permisos.
- Configuración: campo "Aviso de salidas sin guía (días de anticipación)", solo admin.
- Salidas: la bandeja y la marca "Sin guía" usan la ventana configurada; `needsGuide` y
  `guidelessTray` la reciben como parámetro obligatorio. El texto de la bandeja nombra los días.
- Reportes: selector "Ingresos por" (fecha de pago o fecha de salida) en el filtro; viaja en la
  URL, se aplica a "Top tours" y al CSV (`ingresos-por-salida-…csv`). Con "Fecha de salida" la
  sección aclara que Reembolsos sigue por la fecha del reembolso.

**Revisiones**: spec-reviewer y db-schema-guardian, sin bloqueantes. Del primero se tomó hacer
obligatoria la ventana, la aclaración en la página y el orden de reversión.

**Deuda anotada**: el `CASE` del filtro no usa índices (irrelevante al volumen actual); el índice
parcial `payments_succeeded_created_idx` ya no cubría el bruto desde …046.

**Cierra**: la pregunta abierta del spec 0043 (ventana de 14 días) y la del 0012 (ingresos por
fecha de pago o de salida).

# Changelog — 0043 Aviso de salidas con reservas y sin guía

Spec: [0043-aviso-salida-sin-guia.md](./0043-aviso-salida-sin-guia.md)

## 2026-10-03 — Implementación

**Hecho**:

- `listUpcomingDepartures` lee si el guía asignado está activo y cuenta los cupos vivos
  (`confirmed`, `pending_minimum`, `pending_payment`, incluidas las reclamadas).
- Regla pura `needsGuide` / `isGuideUrgent` / `guidelessTray` en `web/lib/guides/needs-guide.ts`,
  con las constantes de ventana (14 días), urgencia (24 h) y tope (30) en
  `shared/constants/departures.ts`.
- Bandeja `GuidelessTray`, primera en Salidas, con el selector de guía de siempre, y la marca
  "Sin guía" en la celda del guía de la tabla.
- Textos ES y EN.
- Tests: 8 unitarios de la regla; integración de los cupos vivos, del guía desactivado y de que
  una salida cancelada no se devuelve.

**Pendiente**:

- Confirmar con el cliente la ventana de 14 días (pregunta abierta del spec).

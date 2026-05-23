# Contexto del usuario

## Comunicación

- Idioma: español (Costa Rica).
- Prefiere respuestas honestas y directas. Pidió explícitamente sinceridad completa al tomar decisiones técnicas: "no lo sé todo y puedo equivocarme".
- Acepta y agradece pushback técnico fundamentado. Aceptó cambios significativos cuando se fundamentaron bien (cambio de Twilio a Resend, descarte de OpenWA, descarte de Stripe Connect, cambio de marketplace a SaaS).
- Tono casual sin formalismo excesivo. Tutea.

## Modelo de negocio

- **El proyecto es SaaS para un cliente único** (un empresario operador turístico costarricense). El usuario es el desarrollador/proveedor del software.
- El cliente ya está comprometido (no es proyecto especulativo).
- El modelo comercial entre desarrollador y cliente aún no está definido. Sugerencia abierta: setup único + mensualidad fija.
- El cliente es quien recibe los pagos. El desarrollador no maneja dinero ajeno.

## Decisiones de producto repetidas

- Prioriza simplicidad y costo bajo sobre features avanzadas: "abaratar costos".
- Prefiere experiencia sin fricción para el turista: sin cuentas, sin registros.
- Acepta esperar features no críticas (WhatsApp, reseñas, multi-currency real) para iterar más rápido en lo core.
- No quiere registrar entidad en el extranjero para usar servicios; prefiere alternativas locales aunque sean menos conocidas.

## Restricciones técnicas conocidas

- Desarrolla solo (no hay equipo).
- Stack preferido: Next.js (para deploy fácil en Vercel). De ahí en adelante sin preferencias fuertes — abierto a recomendaciones.
- Volumen esperado: 100-1000 reservas/mes en primer año.
- Mercado: Costa Rica, ticos y extranjeros (ES/EN, USD/CRC).
- Pasarela: OnvoPay como única en MVP (única opción confirmada que funciona con entidad CR sin lock-in de marketplace extranjero). PayPal Merchant CR como segunda pasarela post-MVP.

## Cosas que NO le gustan

- Soluciones no oficiales con riesgo de ban (rechazó OpenWA cuando entendió el riesgo).
- Sobre-ingeniería: rechazó Turborepo/workspaces al inicio cuando entendió que se podía agregar después.
- Registrar entidad en el extranjero solo para usar un servicio.
- Riesgo fiscal: prefirió cambiar el modelo (de marketplace a SaaS) antes que asumir manejo de dinero ajeno.

## Metodología de trabajo

- Feature-driven + spec-driven, sin excepciones.
- Quiere reglas estrictas que Claude Code siga al pie de la letra al colaborar.
- Le importa la observabilidad del proceso: pide checkpoints, changelogs, memoria persistente.
- Acepta complejidad cuando se justifica con razón concreta; rechaza complejidad sin justificación.
- Cuando descubre un error, prefiere repensar de raíz a parchar.

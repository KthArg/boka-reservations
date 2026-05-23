---
name: external-services-vetting
description: Procedimiento obligatorio de verificación antes de incluir cualquier servicio externo en la arquitectura del proyecto. Aplicar SIEMPRE antes de agregar o sugerir un servicio externo (pasarela de pagos, proveedor de email, SMS, almacenamiento, autenticación, monitoreo, CDN, analytics, base de datos como servicio, lo que sea). Aplicar también al revisar specs que incorporan servicios nuevos. Pensado para detectar restricciones de país, requisitos de entidad jurídica, dependencias ocultas, y otros bloqueantes que históricamente han causado retrabajos significativos en el proyecto. Cubre la checklist de verificación, las preguntas obligatorias a responder ANTES de comprometer arquitectura, fuentes confiables vs no confiables, y el formato de documentación de la decisión.
---

# External services vetting — verificación de servicios externos

Esta skill existe porque ya nos pasó dos veces en este proyecto que dimos por viable un servicio externo (Stripe Connect, después PayPal Platform) que terminó **no estando disponible en Costa Rica** para nuestro caso de uso. Cada vez fue un retrabajo significativo: redefinir arquitectura, actualizar memoria, ajustar specs. Es el tipo de error que no se permite repetir.

La regla central: **no proponer, no agregar, no integrar un servicio externo sin haberlo pasado por la checklist completa de esta skill**. Esto aplica tanto a Claude Code como al usuario humano. Si la verificación no se hizo, no se decide la arquitectura.

## Cuándo aplicar esta skill

- Antes de proponer cualquier servicio externo nuevo, sea cual sea su categoría.
- Al revisar un spec que menciona un servicio externo.
- Al evaluar alternativas para reemplazar un servicio existente.
- Cuando un servicio externo introduce un cambio significativo en su modelo de uso (ej: nueva tier, nuevo país soportado, nuevo requisito de KYC).

## Categorías de servicios que requieren vetting

Esta lista no es exhaustiva pero cubre lo principal:

- Pasarelas de pago y procesadores.
- Proveedores de email transaccional.
- Proveedores de SMS y mensajería (WhatsApp, etc.).
- Bases de datos como servicio (Supabase, Neon, PlanetScale).
- Autenticación como servicio (Auth0, Clerk, Supabase Auth).
- Almacenamiento (S3, Supabase Storage, Cloudflare R2).
- Hosting y deployment (Vercel, Railway, Fly.io, AWS).
- CDN y edge functions.
- Monitoreo, logging, observabilidad (Sentry, Datadog, Logtail).
- Analytics (PostHog, Plausible, Mixpanel).
- Servicios de IA o ML (OpenAI, Anthropic, otros).
- Servicios de mapas, geocodificación.
- Cualquier API que requiera cuenta y autenticación del lado nuestro.

Servicios de código abierto que se autohospedan (PostgreSQL self-hosted, Redis self-hosted) no requieren esta verificación porque no dependen de un proveedor externo.

## La checklist obligatoria

Antes de proponer o incorporar un servicio externo, **responder por escrito** las siguientes preguntas con fuentes verificadas. Si alguna respuesta es "no sé" o "asumo que sí", no avanzar hasta haberlo verificado.

### 1. Disponibilidad geográfica

- ¿El servicio opera en Costa Rica?
- ¿Acepta clientes (empresas o personas) **basados** en Costa Rica como creadores de cuenta?
- ¿Hay alguna restricción específica para CR no documentada en la página principal? (suele estar en `/global`, `/availability`, `/supported-countries`).
- Si el servicio tiene múltiples modalidades (ej: Stripe regular vs Stripe Connect), ¿la modalidad que necesitamos está disponible en CR?

Fuente confiable: página oficial de countries/availability del proveedor. No: foros, blogs antiguos, asunciones.

### 2. Requisitos de entidad

- ¿Funciona con persona física, o requiere persona jurídica?
- ¿Requiere registro de empresa en un país específico (US, UK, EEA)?
- ¿Requiere un tipo específico de entidad (LLC, S.A., etc.)?
- ¿Requiere documentación adicional (RUC, EIN, VAT ID)?

### 3. Verificación KYC/AML

- ¿Cuánto tiempo toma la verificación de la cuenta?
- ¿Qué documentos pide?
- ¿Hay procesos manuales que pueden tardar semanas?
- ¿Es bloqueante para desarrollo (sandbox), o solo para producción (live)?

### 4. Modelo de uso y casos restringidos

- ¿Hay restricciones de industria? Algunos servicios prohíben turismo, juegos, contenido adulto, etc.
- ¿Hay límites de volumen mínimo o máximo?
- ¿Soporta el caso de uso específico que necesitamos (marketplace vs single merchant, suscripciones vs one-time, etc.)?

### 5. API y experiencia developer

- ¿Existe documentación pública de la API?
- ¿Hay SDK oficial para el stack del proyecto (Node.js/TypeScript)?
- ¿Hay sandbox accesible sin requerir verificación KYC completa?
- ¿Soporta webhooks?
- ¿Es REST/HTTP estándar o alguna integración rara?

### 6. Costos

- ¿Hay tier gratuito? ¿Hasta qué volumen?
- ¿Cuál es el costo por unidad en producción?
- ¿Hay costos fijos mensuales además del consumo?
- ¿Costos esperados para nuestro volumen estimado?

### 7. Lock-in y portabilidad

- ¿Qué tan acoplado nos deja a este servicio?
- ¿Hay alternativas con compatibilidad de API si necesitamos cambiar?
- ¿Cuál sería el costo aproximado de migración futura?

### 8. Confiabilidad

- ¿Cuántos años lleva operando?
- ¿Es una empresa formal con registro verificable?
- ¿Hay reportes de uptime / SLA público?
- ¿Hay casos de uso públicos similares al nuestro?

### 9. Soporte

- ¿Cómo es el soporte? (email, chat, teléfono, comunidad)
- ¿Hay tiempo de respuesta esperable?
- ¿Está disponible en español?

### 10. Cumplimiento legal local

- ¿Hay implicaciones fiscales en CR por usar este servicio?
- ¿Hay obligaciones de reporte (factura electrónica, retenciones)?
- ¿Requiere registros adicionales ante entidades costarricenses?

## Fuentes confiables vs no confiables

**Confiables**:
- Páginas oficiales del proveedor con fecha reciente verificable.
- Documentación oficial de la API.
- Términos de servicio (TOS) explícitos.
- Status page del propio servicio.
- Comunicados oficiales y press releases.

**Confiables con cuidado**:
- Hilos de soporte oficiales (en foros del propio proveedor) con respuestas de staff.
- Casos de estudio publicados por el proveedor.

**No confiables**:
- Tutoriales y blogs no oficiales (suelen estar desactualizados).
- Stack Overflow y Reddit (útiles para detectar dudas, no para confirmar disponibilidad).
- Artículos de comparativas (suelen estar pagados o sesgados).
- "Yo escuché que sí funciona en CR".
- Asunciones del agente o del usuario sin fuente.

Si la única fuente que encontrás dice "creo que sí está disponible", **eso no es una confirmación**, es una pista. Hay que llegar a fuente oficial o contactar al proveedor.

## Cuando la documentación pública no alcanza

Algunos servicios ocultan información clave detrás de un formulario "Contact Sales". En esos casos:

1. **Escribir al servicio directamente** vía soporte o ventas con preguntas concretas.
2. Esperar respuesta antes de comprometer arquitectura.
3. Guardar la respuesta (email, captura, link) como evidencia.
4. Documentar en `decisions.md` que la confirmación vino por canal directo y citar la fuente.

Si el servicio no responde en plazo razonable (1-2 semanas), considerar el servicio como "no confirmado" y buscar alternativas. **No es aceptable arquitecturar el sistema sobre un "espero que funcione"**.

## Documentación de la decisión

Toda decisión de incorporar (o descartar) un servicio externo se documenta en `.claude/memory/decisions.md` siguiendo el formato estándar de esa skill, **más** una sección específica:

```markdown
### Verificación de servicio externo

- **Servicio**: nombre del servicio.
- **Categoría**: pasarela de pagos, email, etc.
- **Disponibilidad CR**: confirmada / no disponible / con restricciones.
- **Modalidad usada**: estándar, marketplace, partner, etc.
- **Requisitos de entidad**: persona física en CR, S.A. en CR, LLC US, etc.
- **Sandbox**: disponible sin verificación / requiere verificación.
- **Costos estimados**: para nuestro volumen.
- **Lock-in**: bajo / medio / alto.
- **Fuente principal de la verificación**: link a fuente oficial + fecha.
- **Fuentes secundarias**: lista.
- **Riesgos identificados**: lista.
```

## Cuando un servicio cambia su disponibilidad

Los servicios cambian políticas. Lo que era válido en 2024 puede no serlo en 2026, y viceversa. Una vez integrado un servicio:

- Si el proveedor anuncia cambios de país, modalidad, precios o términos, actualizar `learnings.md` y reevaluar.
- Antes de un go-live de producción, **reconfirmar disponibilidad y términos** ya que entre desarrollo y producción pueden haber pasado meses.

## Lo que esta skill NO cubre

- Evaluación de calidad del servicio en producción (eso se hace por experiencia y por monitoreo).
- Decisiones de equipo sobre preferencias subjetivas.
- Detalles específicos de la integración técnica (eso va en `codebase-conventions` y en specs particulares).

## Anti-patrones

- **Asumir que un servicio popular está disponible en cualquier lugar**. Lo popular en US o EU no necesariamente opera en CR.
- **"Lo voy a usar igual y veré qué pasa"**. Lleva a retrabajos cuando llegás a producción y descubrís que no podés activar la cuenta.
- **Aceptar respuestas vagas del proveedor**. Si dicen "deberías poder usarlo", pedí confirmación concreta por escrito.
- **Descartar servicios sin verificar**. A veces algo que parece "obvio que no funciona" sí funciona en una modalidad específica. Verificar antes de descartar.
- **No documentar la verificación**. Si solo está en tu cabeza, en 6 meses ni vos ni nadie recordará por qué se eligió X sobre Y.
- **Saltarse la checklist "porque es obvio"**. La obvia es la que más se equivoca. Lo aprendimos en este proyecto.

## Skills relacionadas

- **project-memory** — la decisión se documenta en `decisions.md` siguiendo el formato de esa skill.
- **feature-workflow** — el spec de una feature que incorpora un servicio externo debe referenciar la verificación hecha.
- **spec-authoring** — la sección 5 (diseño técnico) de un spec que use servicios externos debe citar la verificación.

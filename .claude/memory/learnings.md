# Aprendizajes y gotchas

Registro append-only de gotchas, quirks y aprendizajes descubiertos durante el trabajo. Las entradas más recientes arriba.

Cada entrada debe ser útil aislada: si en dos meses se vuelve a chocar con el mismo problema, esta entrada debe acelerar la solución.

---

## 2026-05-19 — Stripe NO opera con merchants ubicados en Costa Rica

**Qué pasó**: durante el planeamiento se asumió que Stripe Connect funcionaría para nuestro caso. Al verificar la lista oficial de países soportados de Stripe, Costa Rica no aparece.

**Causa raíz**: Stripe tiene una lista cerrada de países donde acepta abrir cuentas de merchant. CR no está incluida ni en disponibilidad estándar ni en preview.

**Solución / workaround**: la única forma de usar Stripe desde CR es registrar una entidad (LLC o C-Corp) en un país soportado (US, UK, EEA, Canadá, Suiza). Stripe Atlas (~$500) facilita esto. Si esa opción se descarta, **Stripe queda completamente fuera de consideración**.

**Aplicado en este proyecto**: descartamos Stripe y usamos OnvoPay (pasarela local CR).

**Referencias**: https://stripe.com/es-us/global

---

## 2026-05-19 — PayPal Commerce Platform (modalidad marketplace) tampoco funciona desde CR

**Qué pasó**: después de descartar Stripe, intentamos PayPal Commerce Platform como alternativa para marketplace. Al crear una "Platform App" en PayPal Developer, el wizard mostró el aviso explícito "US accounts only" y el dropdown de país no incluía Costa Rica.

**Causa raíz**: PayPal Commerce Platform (la modalidad partner/platform con Platform fee y onboarding de sellers) está restringida a entidades registradas en US.

**Solución / workaround**:
- PayPal Business **estándar** (modalidad Merchant, no Platform) sí funciona desde CR. Sirve para casos donde una sola cuenta recibe los pagos.
- Si se necesita marketplace real con split de fees, no es viable sin entidad US.

**Aplicado en este proyecto**: cambiamos el modelo del proyecto de marketplace a SaaS para cliente único. PayPal Merchant queda como pasarela secundaria a sumar post-MVP.

**Referencias**: dashboard de PayPal Developer al crear app type "Platform".

---

## 2026-05-19 — Manejar dinero ajeno como persona física en CR es riesgo fiscal

**Qué pasó**: durante el planeamiento se evaluó la opción de "cobrar todo a nombre del desarrollador y transferir a operadores manualmente". Se descartó porque, en CR, esto puede llevar a interpretarse como agente recaudador, con obligaciones específicas (registro ICT si es turismo, factura electrónica, retenciones, IVA sobre el monto total que pasa por la cuenta).

**Causa raíz**: la legislación tributaria costarricense no distingue automáticamente "dinero propio" de "dinero en tránsito" sin estructura legal específica que lo declare.

**Solución / workaround**:
- Modelo SaaS (cliente único): la plata va directo a cuenta del cliente. Cero exposición fiscal para el desarrollador.
- Modelo marketplace genuino: requiere estructura legal (S.A. con actividad declarada como intermediario turístico, ICT, etc.) o pasarela con split nativo.
- Modelo "cobro y transfiero": evitarse a menos que haya estructura legal explícita.

**Aplicado en este proyecto**: confirma la decisión de SaaS para cliente único; el desarrollador no toca dinero ajeno.

---

## 2026-05-19 — Verificar disponibilidad de servicio externo ANTES de comprometer arquitectura

**Qué pasó**: pasamos por Stripe → PayPal Platform sin haber verificado restricciones país de cada uno. Cada cambio implicó retrabajo en memoria, skills, roadmap y decisiones.

**Causa raíz**: confiar en que "servicios populares funcionan en todos lados" sin verificar fuente oficial.

**Solución / workaround**: se creó la skill `external-services-vetting` con checklist obligatoria para cualquier servicio externo. La verificación es paso previo a cualquier propuesta arquitectónica.

**Aplicado en este proyecto**: la skill ya está activa. Toda futura inclusión de servicio externo debe pasar la checklist.

**Referencias**: `.claude/skills/external-services-vetting/SKILL.md`

# Factura electrónica a mano

Los términos (cláusula 5) prometen una factura electrónica por cada compra, enviada al correo de la reserva. Al lanzar, el sistema no la emite: la hace el operador a mano. La emisión automática queda para el spec 0037.

## Qué necesita el operador (una sola vez)

- Estar inscrito como contribuyente y habilitado para emitir comprobantes electrónicos.
- Una herramienta para emitirlos: el facturador gratuito de Hacienda o el que ya use su contador.
- Definir con el contador: el código CAByS del servicio, la actividad económica y si la factura se emite al cobrar o al prestar el tour.

## Cada día (o con la frecuencia que acuerde con el contador)

1. Entrar al panel → **Reservas** → filtrar por el rango de fechas → **Exportar CSV**. Solo el admin puede exportar.
2. Tomar las filas con `estado_pago = succeeded` que todavía no tengan factura.
3. Emitir una factura por reserva con estos datos del CSV:

   | Dato de la factura | Columna del CSV                         |
   | ------------------ | --------------------------------------- |
   | Receptor (nombre)  | `cliente`                               |
   | Correo de envío    | `email`                                 |
   | Descripción        | `tour`, `fecha_inicio`, `total_tickets` |
   | Monto sin impuesto | `base_sin_iva`                          |
   | IVA (13 %)         | `iva`                                   |
   | Total              | `monto`                                 |
   | Moneda             | `moneda`                                |

4. Anotar el número de la factura junto al `booking_id` en una hoja propia. El sistema no guarda ese número.

## Reembolsos

Una reserva con `estado_reserva = refunded` y factura ya emitida necesita una **nota de crédito** por el total. Se ven filtrando por ese estado en el mismo CSV.

## Lo que el sistema no cubre

- No pide cédula ni datos fiscales al turista. Si un turista quiere la factura a nombre de una empresa, hay que pedírselos por correo.
- No avisa qué reservas ya tienen factura: el control es la hoja del operador.
- El cobro posterior a la reserva puede cobrarse días después de reservar: la fila aparece como `succeeded` recién cuando se cobra.

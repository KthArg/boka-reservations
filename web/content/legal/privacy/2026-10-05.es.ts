import { p, ul, type LegalDocumentFactory } from '../types';

// Aviso de privacidad, versión 2026-10-05, en español (versión que prevalece). Parte de la
// versión 2026-09-27 y suma lo que hace el programa (decisión del operador, 2026-10-05): la
// tarjeta guardada y los datos que recibe OnvoPay cuando el cobro es posterior a la reserva, y la
// prevención de fraude de OnvoPay en la página donde el banco pide confirmar un cobro (consulta
// de la dirección IP en ipify y my-ip.io, y huella del dispositivo de ThreatMetrix). Pendiente de
// la confirmación de la abogada. Versión inmutable.

export const privacyEs: LegalDocumentFactory = (op) => ({
  title: 'Aviso de privacidad',
  intro: [
    p('Versión del 5 de octubre de 2026.'),
    p(
      'Este aviso explica qué datos personales recogemos cuando usted reserva un tour en este sitio, para qué los usamos, con quién los compartimos, cuánto tiempo los guardamos y cómo puede ejercer sus derechos, conforme a la Ley 8968 de Protección de la Persona frente al Tratamiento de sus Datos Personales y su Reglamento.',
    ),
  ],
  sections: [
    {
      id: 'responsable',
      title: '1. Responsable',
      blocks: [
        p(
          `El responsable de la base de datos de reservas es ${op.legalName}, cédula jurídica ${op.taxId}, con domicilio en ${op.address}. Para cualquier tema relacionado con sus datos personales, escríbanos a ${op.privacyEmail} o llámenos al ${op.phone}.`,
        ),
      ],
    },
    {
      id: 'datos',
      title: '2. Qué datos recogemos',
      blocks: [
        p('Al reservar le pedimos:'),
        ul(
          'su nombre completo;',
          'su correo electrónico;',
          'la cantidad y el tipo de tiquetes (adulto, niño o estudiante).',
        ),
        p(
          'Estos datos son obligatorios: sin ellos no podemos confirmar su reserva, enviarle el comprobante ni avisarle de cambios.',
        ),
        p(
          'No le pedimos documento de identidad, teléfono, dirección, nacionalidad, datos de salud ni datos de las personas que lo acompañan, incluidos los menores de edad.',
        ),
        p(
          'Pago. Los datos de su tarjeta viajan directamente desde su navegador a nuestro procesador de pagos, OnvoPay (ONVO Costa Rica S.A.), sin pasar por nuestros servidores. Nosotros no vemos ni guardamos el número completo de la tarjeta ni su código de seguridad. De OnvoPay recibimos solo la confirmación del pago y una referencia de la transacción.',
        ),
        p(
          'Tarjeta guardada. Cuando el cobro se hace después de reservar, OnvoPay guarda su tarjeta para que podamos cobrarle cuando la salida se confirme, y le enviamos su nombre y su correo para registrarlo como titular. Nosotros guardamos solo la marca de la tarjeta, sus últimos cuatro dígitos y su fecha de vencimiento, para identificarla en nuestros correos. Cuando la reserva ya no puede volver a cobrarse (porque se canceló, o porque se cobró y la salida ya empezó), pedimos a OnvoPay que elimine ese registro con su tarjeta.',
        ),
        p(
          'Prevención de fraude en el pago. Si su banco pide que usted confirme un cobro, la página de confirmación carga un componente de OnvoPay que consulta su dirección IP y recoge datos técnicos de su navegador y de su dispositivo para evaluar el riesgo de fraude del pago. Esos datos los reciben directamente OnvoPay y los servicios que usa para ese fin: ipify y my-ip.io (consulta de la dirección IP) y ThreatMetrix, de LexisNexis Risk Solutions (identificación del dispositivo), que puede usar sus propias cookies o identificadores. Nosotros no recibimos ni guardamos esos datos.',
        ),
        p(
          'El tiempo que esas empresas conservan esos datos y el lugar donde los almacenan los define cada una en su propia política de privacidad, que usted puede consultar en sus sitios: OnvoPay (onvopay.com/policies), LexisNexis Risk Solutions, para ThreatMetrix (risk.lexisnexis.com/corporate/processing-notices/threatmetrix), ipify (ipify.org) y my-ip.io (my-ip.io). Para ejercer sus derechos sobre esos datos puede dirigirse directamente a ellas.',
        ),
        p(
          'Devoluciones por transferencia. Si tenemos que devolverle dinero por transferencia bancaria o SINPE Móvil porque no es posible hacerlo a su tarjeta, le pedimos por correo los datos de una cuenta a su nombre y los usamos solo para esa devolución.',
        ),
        p(
          'Registro de aceptación. Guardamos la fecha y la hora en que aceptó los términos y este aviso, y la versión de cada texto, como prueba de su consentimiento.',
        ),
        p(
          'Datos técnicos. Usamos su dirección IP de forma transitoria, en forma cifrada y por un máximo de 24 horas, solo para prevenir abusos del sitio. Además, nuestros proveedores de alojamiento registran automáticamente datos técnicos de cada visita (dirección IP, fecha y página solicitada) y los conservan un máximo de 30 días, con fines de seguridad y diagnóstico de errores. Usamos únicamente cookies necesarias para que el sitio funcione: una para recordar el idioma y otra para mantener sus cupos apartados mientras paga. No usamos cookies de publicidad ni de analítica, y no hacemos seguimiento de su navegación. La única excepción es el componente de prevención de fraude descrito arriba, que solo se carga en la página donde su banco le pide confirmar un cobro.',
        ),
      ],
    },
    {
      id: 'finalidades',
      title: '3. Para qué los usamos',
      blocks: [
        ul(
          'Gestionar su reserva y su pago.',
          'Prevenir el fraude en los pagos.',
          'Enviarle la confirmación, un recordatorio antes del tour y avisos sobre cambios, cancelaciones o reembolsos.',
          'Atender cancelaciones, reembolsos, consultas y reclamos.',
          'Cumplir obligaciones legales, tributarias y contables, como emitir la factura electrónica.',
        ),
        p(
          'No usamos sus datos para publicidad, no le enviamos correos promocionales, no los vendemos ni los cedemos a terceros para sus propios fines, y no tomamos decisiones automatizadas que lo afecten. La aprobación o el rechazo de un cobro lo deciden su banco y OnvoPay.',
        ),
      ],
    },
    {
      id: 'acceso',
      title: '4. Quién accede a sus datos',
      blocks: [
        ul(
          `El personal autorizado de ${op.legalName}, solo en la medida en que lo necesita para su trabajo y con obligación de confidencialidad.`,
          'Los guías no ven sus datos: solo conocen la cantidad de participantes de cada salida.',
          'Los proveedores tecnológicos que nos ayudan a prestar el servicio, que tratan los datos por nuestra cuenta, siguiendo nuestras instrucciones y bajo obligaciones de confidencialidad y seguridad:',
        ),
        {
          kind: 'table',
          head: ['Proveedor', 'Para qué', 'Dónde almacena los datos'],
          rows: [
            [
              'OnvoPay (ONVO Costa Rica S.A.)',
              'Procesar el pago con tarjeta y los reembolsos, guardar su tarjeta cuando el cobro es posterior a la reserva y prevenir el fraude en los pagos',
              'Bases de datos propias de ONVO Costa Rica S.A. en Amazon Web Services',
            ],
            ['Supabase', 'Base de datos donde se guardan las reservas', 'Estados Unidos'],
            ['Vercel', 'Alojamiento del sitio web', 'Estados Unidos'],
            [
              'Railway',
              'Procesos automáticos (envío de correos, reembolsos, eliminación de datos)',
              'Estados Unidos',
            ],
            ['Resend', 'Envío de correos electrónicos', 'Estados Unidos'],
            ['Sentry', 'Detección de errores técnicos del sitio', 'Estados Unidos'],
          ],
        },
        p(
          'Para prevenir el fraude, OnvoPay usa a su vez los servicios ipify, my-ip.io y ThreatMetrix (LexisNexis Risk Solutions), que reciben su dirección IP y datos técnicos de su dispositivo directamente desde su navegador y los almacenan fuera de Costa Rica.',
        ),
        p(
          'Solo entregamos sus datos a una autoridad cuando una ley o una orden judicial nos obliga a hacerlo.',
        ),
      ],
    },
    {
      id: 'fuera-de-costa-rica',
      title: '5. Almacenamiento fuera de Costa Rica',
      blocks: [
        p(
          'Varios de nuestros proveedores almacenan la información en servidores ubicados en Estados Unidos, y los servicios de prevención de fraude de OnvoPay pueden hacerlo en otros países. Hemos contratado con nuestros proveedores las medidas de confidencialidad y seguridad correspondientes. Al marcar la casilla de consentimiento, usted autoriza que sus datos se almacenen en esos servidores.',
        ),
      ],
    },
    {
      id: 'conservacion',
      title: '6. Cuánto tiempo los guardamos',
      blocks: [
        ul(
          'Si inicia una reserva pero no la paga, eliminamos esos datos a los 90 días.',
          'En las reservas pagadas, eliminamos su nombre, su correo y, si los hubo, los datos de la cuenta de una devolución por transferencia, 18 meses después de la fecha del tour. Lo que queda (fecha, tour, cantidad de tiquetes, monto y referencia del pago en OnvoPay) ya no contiene sus datos de contacto.',
          'Ese registro de la transacción, sin sus datos de contacto, lo conservamos durante 5 años para cumplir las obligaciones tributarias y contables, y después lo eliminamos.',
          'Las copias de respaldo se reemplazan automáticamente cada 7 días, por lo que los datos eliminados desaparecen también de ellas en ese plazo.',
        ),
      ],
    },
    {
      id: 'derechos',
      title: '7. Sus derechos',
      blocks: [
        p('Usted puede, en cualquier momento y de forma gratuita:'),
        ul(
          'acceder a los datos que tenemos sobre usted;',
          'pedir que los corrijamos o actualicemos;',
          'pedir que los eliminemos, salvo los que la ley nos obligue a conservar;',
          'revocar su consentimiento. La revocación no afecta lo hecho antes, pero si la reserva está pendiente, sin sus datos no podremos prestarle el servicio.',
        ),
        p(
          `Para ejercer estos derechos, escriba a ${op.privacyEmail} desde el correo con el que reservó, o indíquelo en su mensaje. Podremos pedirle que confirme su identidad. Le respondemos en un plazo máximo de cinco días hábiles.`,
        ),
        p(
          'Si considera que no atendimos debidamente su solicitud, puede acudir a la Agencia de Protección de Datos de los Habitantes (PRODHAB), www.prodhab.go.cr.',
        ),
      ],
    },
    {
      id: 'seguridad',
      title: '8. Seguridad',
      blocks: [
        p(
          'Protegemos sus datos con medidas técnicas y organizativas: conexión cifrada, acceso restringido por funciones, registro de las actuaciones del personal y enlaces personales de acceso que vencen. Si ocurriera un incidente de seguridad que afecte sus datos, se lo informaremos, junto con lo que estamos haciendo al respecto, en los plazos que establece la ley.',
        ),
      ],
    },
    {
      id: 'menores',
      title: '9. Menores de edad',
      blocks: [
        p(
          'El sitio está dirigido a personas mayores de edad. No recogemos a sabiendas datos personales de menores de edad.',
        ),
      ],
    },
    {
      id: 'cambios',
      title: '10. Cambios a este aviso',
      blocks: [
        p(
          'Si cambiamos este aviso, publicamos la nueva versión con su fecha. Si el cambio implica un uso nuevo de sus datos, le pedimos su consentimiento.',
        ),
      ],
    },
  ],
});

import { p, ul, type LegalDocumentFactory } from '../types';

// Términos y condiciones de reserva, versión 2026-10-05, en español (versión que prevalece).
// Parte de la versión 2026-09-27 y la ajusta a lo que hace el programa (decisión del operador,
// 2026-10-05): describe el cobro posterior a la reserva (tarjeta guardada, retención y cobro al
// confirmarse la salida), la cancelación sin costo antes del cobro, que una salida bajo el mínimo
// puede hacerse igual si el operador lo decide, y que solo hay reembolso en los casos que el
// texto enumera. Pendiente de la confirmación de la abogada. Versión inmutable.

export const termsEs: LegalDocumentFactory = (op) => ({
  title: 'Términos y condiciones de reserva',
  intro: [p('Versión del 5 de octubre de 2026.')],
  sections: [
    {
      id: 'quienes-somos',
      title: '1. Quiénes somos',
      blocks: [
        p(
          `Los tours que se ofrecen en este sitio los organiza y presta ${op.legalName}, cédula jurídica ${op.taxId}, con domicilio en ${op.address}, bajo la marca ${op.brand}.` +
            (op.ictDeclaration
              ? ` Declaratoria turística del ICT número ${op.ictDeclaration}.`
              : ''),
        ),
        p(
          `Puede contactarnos en ${op.contactEmail} o al teléfono ${op.phone}, ${op.hours} (hora de Costa Rica).`,
        ),
      ],
    },
    {
      id: 'aceptacion',
      title: '2. Aceptación de estos términos',
      blocks: [
        p(
          'Estos términos regulan la compra de tiquetes para nuestros tours a través de este sitio. Antes de pagar, usted debe leerlos y aceptarlos marcando la casilla correspondiente. Puede imprimirlos o guardarlos en PDF desde esta página, y en el correo de confirmación le enviamos un enlace a la versión que aceptó.',
        ),
        p(
          'Estos términos se redactan en español. Cualquier traducción a otro idioma es solo una cortesía; en caso de diferencia, prevalece la versión en español.',
        ),
      ],
    },
    {
      id: 'tours',
      title: '3. Los tours',
      blocks: [
        p('En la página de cada tour publicamos la información esencial:'),
        ul(
          'descripción y duración;',
          'nivel de dificultad;',
          'punto de encuentro y hora de inicio;',
          'qué incluye y qué no incluye;',
          'requisitos de edad, condición física u otros que apliquen;',
          'las edades a las que aplica el tiquete de niño.',
        ),
        p(
          'Esa información forma parte de la oferta y nos obliga. Le recomendamos leerla antes de reservar, porque confirma que los participantes cumplen los requisitos publicados.',
        ),
      ],
    },
    {
      id: 'como-reservar',
      title: '4. Cómo reservar',
      blocks: [
        ul(
          'Elija el tour, la fecha y la cantidad de tiquetes de cada tipo (adulto, niño o estudiante).',
          'Indique su nombre completo y su correo electrónico. No necesita crear una cuenta.',
          'Al pasar al pago, apartamos sus cupos por 15 minutos. Si en ese plazo no inicia el pago o no guarda su tarjeta, los cupos se liberan.',
          'Antes de reservar verá un resumen con el tour, la fecha, el punto de encuentro, los tiquetes, el precio total con el impuesto desglosado, las condiciones de cancelación y la tolerancia de llegada tarde.',
          'El sitio le indica, antes de que ingrese su tarjeta, si el cobro se hace en ese momento o más adelante (cláusula 5).',
          'Si el cobro se hace al reservar, la reserva queda confirmada cuando el pago es aprobado. En ese momento le enviamos un correo de confirmación con el resumen de la compra y un enlace personal para consultar o cancelar su reserva.',
          'Si el cobro se hace más adelante, al guardar su tarjeta la reserva queda registrada y le enviamos un correo con el resumen y su enlace personal. La reserva queda confirmada cuando hacemos el cobro, y en ese momento le enviamos el correo de confirmación.',
        ),
        p(
          'Las reservas en línea de cada salida cierran unas horas antes de su inicio. Cuando una salida ya no admite reservas, el sitio se lo indica.',
        ),
        p(
          'Si no recibe nuestro correo en unos minutos, revise su carpeta de correo no deseado o contáctenos.',
        ),
        p(
          'La persona que reserva debe ser mayor de edad. Si reserva para otras personas, declara que actúa con su autorización y que les dará a conocer estos términos y los requisitos del tour.',
        ),
        p(
          'Los tiquetes de niño aplican a las edades indicadas en la página del tour. Los tiquetes de estudiante requieren presentar un carné estudiantil vigente al inicio del tour; si no se presenta, podremos cobrar la diferencia con el tiquete de adulto.',
        ),
      ],
    },
    {
      id: 'precios-y-pago',
      title: '5. Precios y pago',
      blocks: [
        p(
          'Los precios se muestran en dólares de los Estados Unidos e incluyen el impuesto al valor agregado (13 %) y cualquier otro cargo aplicable. No hay cargos adicionales por reservar en línea. Antes de pagar verá el precio total con el desglose del impuesto.',
        ),
        p(
          'El pago se hace con tarjeta de crédito o débito a través de OnvoPay, plataforma de pagos de ONVO Costa Rica S.A. Los datos de su tarjeta los recibe directamente OnvoPay; nosotros no vemos ni guardamos el número completo de la tarjeta ni su código de seguridad.',
        ),
        p(
          'Si su tarjeta está en una moneda distinta del dólar, la conversión la hace su banco emisor con su propio tipo de cambio, y el banco podría cobrarle comisiones por compras internacionales. Como referencia, el tipo de cambio oficial es el de venta de referencia del Banco Central de Costa Rica.',
        ),
        p(
          'Cobro posterior a la reserva. Cuando el cobro no se hace al reservar, usted guarda su tarjeta y nos autoriza a cobrarle el total cuando la salida se confirme. Al reservar no le cobramos nada. Una salida se confirma cuando alcanza su mínimo de participantes o cuando decidimos realizarla (cláusula 7). El cobro se hace cuando la salida se confirma, lo que puede ocurrir apenas alcanza su mínimo o en los días previos a la salida, sin que usted tenga que hacer nada; si reserva una salida que ya está confirmada, se hace en los minutos siguientes.',
        ),
        p(
          'Antes de cobrar podemos hacer una retención por el total en su tarjeta. Una retención no es un cobro: si la salida no se confirma, la soltamos sin cobrarle nada. El tiempo que tarda en desaparecer de su saldo depende de su banco emisor.',
        ),
        p(
          'Si su banco rechaza el cobro o pide que usted lo confirme, le escribimos por correo con un enlace para cambiar la tarjeta o confirmar el cobro y con la fecha límite para hacerlo. Si no lo resuelve a tiempo, la reserva se cancela sin ningún cobro.',
        ),
        p(
          'Por cada compra emitimos la factura electrónica correspondiente y se la enviamos al correo indicado en la reserva.',
        ),
        p(
          'En casos excepcionales, dos personas pueden pagar al mismo tiempo los últimos cupos de una salida. Si al confirmar su pago ya no quedan cupos, cancelamos la reserva, le reembolsamos el 100 % de forma automática y se lo informamos por correo.',
        ),
      ],
    },
    {
      id: 'cancelacion-cliente',
      title: '6. Cancelación por su parte',
      blocks: [
        p('Si ya le cobramos la reserva, puede cancelarla con estas condiciones:'),
        ul(
          'Con 24 horas o más de anticipación al inicio del tour: le devolvemos el 100 % de lo pagado.',
          'Con menos de 24 horas de anticipación: no hay reembolso.',
          'Si no se presenta, o llega después de la tolerancia de llegada tarde indicada en el resumen de compra y en su correo de confirmación sin avisarnos: se considera no presentación y no hay reembolso.',
          'Una vez iniciado el tour no hay reembolso.',
        ),
        p(
          'Si todavía no le cobramos la reserva, puede cancelarla en cualquier momento sin ningún costo. Si ya habíamos hecho una retención en su tarjeta, la soltamos. Mientras un cobro está en proceso, la reserva no se puede cancelar hasta que el cobro termine.',
        ),
        p(
          'Las horas se cuentan en hora de Costa Rica. Puede cancelar desde el botón "Ver mi reserva" de nuestros correos; antes de confirmar la cancelación, el sistema le muestra el monto que se le devolverá.',
        ),
        p(
          `Si prefiere cambiar la fecha en lugar de cancelar, escríbanos a ${op.contactEmail} con al menos 24 horas de anticipación. Podemos pasar una reserva ya cobrada a otra salida del mismo tour con cupos disponibles, sin costo, y le confirmamos la fecha nueva por correo.`,
        ),
      ],
    },
    {
      id: 'cancelacion-operador',
      title: '7. Cancelación por nuestra parte',
      blocks: [
        p(
          'Mínimo de participantes. Algunos tours necesitan un mínimo de participantes. Si una salida no alcanza ese mínimo, nosotros decidimos si la realizamos igual o si la cancelamos. Si la cancelamos por esta causa, se lo avisamos por correo al menos 24 horas antes del inicio y le devolvemos el 100 % de lo pagado; si todavía no le habíamos cobrado, no le cobramos nada. Si decidimos realizarla, su reserva sigue en pie y, si todavía no se había cobrado, hacemos el cobro. Una reserva que no llegó a cobrarse antes del inicio de la salida se cancela sin ningún cobro.',
        ),
        p(
          'Clima, seguridad y fuerza mayor. Las condiciones del clima, la seguridad y otras causas ajenas a nuestra voluntad pueden impedir un tour, y usted reserva asumiendo ese riesgo. Si por alguna de ellas no podemos realizarlo, cancelamos la salida y se lo avisamos por correo. En estos casos no hay reembolso automático: revisamos cada reserva ya cobrada y le comunicamos por correo nuestra decisión, que puede ser el reembolso del 100 %, el cambio a otra fecha sin costo o ningún reembolso. Mientras la revisamos, la reserva no se puede cancelar desde el sitio. Si todavía no le habíamos cobrado, la reserva se cancela sin ningún cobro.',
        ),
        p(
          'Otros cambios. No cambiamos la fecha, la hora ni el punto de encuentro de una salida que ya tiene reservas. Si tenemos que cancelar por cualquier otro motivo, le devolvemos el 100 % de lo pagado.',
        ),
      ],
    },
    {
      id: 'reembolsos',
      title: '8. Reembolsos',
      blocks: [
        p(
          'Solo hay reembolso en los casos que indican las cláusulas 5, 6, 7 y 9. Cuando lo hay, es siempre por el 100 % de lo pagado: no descontamos comisiones ni cargos.',
        ),
        p(
          'Los reembolsos se hacen a la misma tarjeta con la que pagó y se procesan en cuanto se confirma la cancelación. El momento en que el monto aparece en su estado de cuenta depende de su banco emisor.',
        ),
        p(
          'Si no es posible devolver el dinero a la tarjeta (por ejemplo, porque la tarjeta fue cancelada o porque el procesador de pagos ya no permite revertir el cobro), se lo devolvemos por transferencia bancaria o SINPE Móvil a una cuenta a nombre de la persona que hizo la reserva, sin costo para usted. Para eso le pedimos los datos de la cuenta por correo.',
        ),
      ],
    },
    {
      id: 'participacion',
      title: '9. Participación y seguridad',
      blocks: [
        p(
          'Los participantes deben seguir las instrucciones del guía. Antes de reservar, revise que todos los participantes cumplan los requisitos publicados para el tour. Si alguien tiene una condición de salud que pueda afectar su participación, le recomendamos consultarnos antes de reservar.',
        ),
        p(
          'En los tours de aventura, cada participante (o su padre, madre o encargado, si es menor de edad) debe firmar al inicio del tour el acuerdo de responsabilidad que exige la regulación de turismo de aventura.',
        ),
        p(
          'El guía puede impedir la participación de una persona cuando su participación ponga en riesgo su seguridad o la de otros (por ejemplo, por estar bajo los efectos del alcohol o de drogas, o por no cumplir un requisito de seguridad publicado). En esos casos no hay reembolso automático: revisamos el caso y le comunicamos por correo nuestra decisión, que puede ser el reembolso del 100 % de la reserva o ningún reembolso.',
        ),
      ],
    },
    {
      id: 'responsabilidad',
      title: '10. Nuestra responsabilidad',
      blocks: [
        p(
          'Respondemos por prestar el tour tal como se ofreció, con el personal, los permisos, los equipos y las medidas de seguridad que exige la ley' +
            (op.hasLiabilityPolicy
              ? ', y contamos con una póliza de responsabilidad civil vigente.'
              : '.'),
        ),
        p(
          'Nada en estos términos limita nuestra responsabilidad por daños a la vida, la salud o la integridad física de los participantes, ni por el incumplimiento o el cumplimiento defectuoso del servicio, en los términos que establece la ley.',
        ),
        p(
          'No respondemos por objetos personales que no nos haya entregado para su custodia, ni por servicios de terceros que usted contrate por su cuenta (por ejemplo, transporte hasta el punto de encuentro).',
        ),
      ],
    },
    {
      id: 'menores',
      title: '11. Menores de edad',
      blocks: [
        p(
          'Los menores de edad deben participar acompañados por su padre, madre o encargado, o por un adulto autorizado por ellos. Quien reserva tiquetes para menores declara contar con esa autorización. Para reservar no pedimos ningún dato de los menores, solo la cantidad de tiquetes.',
        ),
      ],
    },
    {
      id: 'datos-personales',
      title: '12. Datos personales',
      blocks: [
        p(
          'Tratamos sus datos personales conforme a nuestro Aviso de privacidad, que usted acepta por separado al reservar mediante una casilla independiente.',
        ),
      ],
    },
    {
      id: 'quejas',
      title: '13. Quejas y reclamos',
      blocks: [
        p(
          `Si tiene una queja o un reclamo, escríbanos a ${op.contactEmail} o llámenos al ${op.phone}. El trámite es gratuito. Le confirmamos que recibimos su queja y le damos una respuesta en un plazo máximo de 10 días hábiles.`,
        ),
        p(
          'Usted también puede acudir a la Comisión Nacional del Consumidor del Ministerio de Economía, Industria y Comercio (línea 800-CONSUMO, www.consumo.go.cr).',
        ),
      ],
    },
    {
      id: 'uso-del-sitio',
      title: '14. Uso del sitio',
      blocks: [
        p(
          'Los textos, fotografías y marcas de este sitio nos pertenecen o los usamos con autorización. Usted puede usar el sitio para informarse y reservar, pero no para fines comerciales ajenos ni de forma que afecte su funcionamiento o su seguridad.',
        ),
      ],
    },
    {
      id: 'cambios',
      title: '15. Cambios a estos términos',
      blocks: [
        p(
          'Podemos actualizar estos términos. Cada versión indica su fecha de publicación. Los cambios no afectan las reservas ya hechas, que se rigen por la versión que usted aceptó al reservar.',
        ),
      ],
    },
    {
      id: 'ley-aplicable',
      title: '16. Ley aplicable',
      blocks: [
        p(
          'Estos términos se rigen por las leyes de la República de Costa Rica. Nada en ellos limita los derechos que la ley le reconoce como consumidor. Cualquier controversia podrá presentarse ante la Comisión Nacional del Consumidor o ante los tribunales competentes de Costa Rica.',
        ),
      ],
    },
  ],
});

import { p, ul, type LegalDocumentFactory } from '../types';

// Booking terms and conditions, version 2026-09-27, English courtesy translation. The Spanish
// version prevails (clause 2). Keep it in sync with `2026-09-27.es.ts`; this version is immutable.

export const termsEn: LegalDocumentFactory = (op) => ({
  title: 'Booking terms and conditions',
  intro: [
    p('Version of September 27, 2026.'),
    p(
      'This is a courtesy translation. The Spanish version is the one that applies; if the two differ, the Spanish version prevails.',
    ),
  ],
  sections: [
    {
      id: 'quienes-somos',
      title: '1. Who we are',
      blocks: [
        p(
          `The tours offered on this site are organized and provided by ${op.legalName}, legal ID ${op.taxId}, domiciled at ${op.address}, under the brand ${op.brand}.` +
            (op.ictDeclaration
              ? ` Costa Rican Tourism Board (ICT) tourism declaration number ${op.ictDeclaration}.`
              : ''),
        ),
        p(
          `You can contact us at ${op.contactEmail} or by phone at ${op.phone}, ${op.hours} (Costa Rica time).`,
        ),
      ],
    },
    {
      id: 'aceptacion',
      title: '2. Acceptance of these terms',
      blocks: [
        p(
          'These terms govern the purchase of tickets for our tours through this site. Before paying, you must read and accept them by checking the corresponding box. You can print them or save them as a PDF from this page, and the confirmation email includes a link to the version you accepted.',
        ),
        p(
          'These terms are written in Spanish. Any translation into another language is only a courtesy; if they differ, the Spanish version prevails.',
        ),
      ],
    },
    {
      id: 'tours',
      title: '3. The tours',
      blocks: [
        p('On each tour page we publish the essential information:'),
        ul(
          'description and duration;',
          'difficulty level;',
          'meeting point and start time;',
          'what is included and what is not;',
          'age, fitness or other requirements that apply;',
          'the ages the child ticket applies to.',
        ),
        p(
          'That information is part of the offer and is binding on us. We recommend reading it before booking, because it confirms that participants meet the published requirements.',
        ),
      ],
    },
    {
      id: 'como-reservar',
      title: '4. How to book',
      blocks: [
        ul(
          'Choose the tour, the date and the number of tickets of each type (adult, child or student).',
          'Enter your full name and email address. You do not need to create an account.',
          'When you move on to payment, we hold your seats for 15 minutes. If you do not start the payment within that time, the seats are released.',
          'Before paying you will see a summary with the tour, the date, the meeting point, the tickets, the total price with the tax breakdown, the cancellation conditions and the late-arrival tolerance.',
          'The booking is confirmed when the payment is approved. At that moment we send you a confirmation email with the purchase summary and a personal link to view or cancel your booking.',
        ),
        p(
          'If you do not receive the confirmation email within a few minutes, check your spam folder or contact us.',
        ),
        p(
          'The person booking must be of legal age. If you book for other people, you declare that you act with their authorization and that you will inform them of these terms and the tour requirements.',
        ),
        p(
          'Child tickets apply to the ages shown on the tour page. Student tickets require a valid student ID at the start of the tour; if it is not presented, we may charge the difference with the adult ticket.',
        ),
      ],
    },
    {
      id: 'precios-y-pago',
      title: '5. Prices and payment',
      blocks: [
        p(
          'Prices are shown in United States dollars and include value added tax (13%) and any other applicable charge. There are no additional fees for booking online. Before paying you will see the total price with the tax breakdown.',
        ),
        p(
          'Payment is made by credit or debit card through OnvoPay, the payment platform of ONVO Costa Rica S.A. Your card details are received directly by OnvoPay; we do not see or store the full card number or its security code.',
        ),
        p(
          'If your card is in a currency other than the dollar, the conversion is made by your issuing bank at its own exchange rate, and the bank may charge fees for international purchases. For reference, the official rate is the Central Bank of Costa Rica reference selling rate.',
        ),
        p(
          'For every purchase we issue the corresponding electronic invoice and send it to the email address given in the booking.',
        ),
        p(
          'In exceptional cases, two people may pay for the last seats of a departure at the same time. If no seats are left when your payment is confirmed, we cancel the booking, refund 100% automatically and let you know by email.',
        ),
      ],
    },
    {
      id: 'cancelacion-cliente',
      title: '6. Cancellation by you',
      blocks: [
        p('You can cancel your booking under these conditions:'),
        ul(
          '24 hours or more before the tour starts: we refund 100% of what you paid.',
          'Less than 24 hours before: no refund.',
          'If you do not show up, or arrive after the late-arrival tolerance shown in the purchase summary and in your confirmation email without letting us know: it counts as a no-show and there is no refund.',
        ),
        p(
          'Hours are counted in Costa Rica time. You can cancel at any time from the "Manage my booking" link in the confirmation email; before confirming the cancellation, the system shows you the amount that will be refunded.',
        ),
        p(
          `If you prefer to change the date instead of cancelling, write to us at ${op.contactEmail} at least 24 hours in advance. We move your booking to another departure of the same tour with available seats, at no cost, and confirm the new date by email.`,
        ),
      ],
    },
    {
      id: 'cancelacion-operador',
      title: '7. Cancellation by us',
      blocks: [
        p(
          'Minimum number of participants. Some tours need a minimum number of participants to run. If a departure does not reach that minimum, we cancel it, let you know by email at least 24 hours before the start, and refund 100% of what you paid.',
        ),
        p(
          'Weather, safety and force majeure. Weather conditions, safety and other causes beyond our control can prevent a tour, and you book accepting that risk. If one of them prevents us from running it, we cancel the departure and let you know by email. In these cases there is no automatic refund: we review each booking and let you know our decision by email, which may be a 100% refund, a free change to another date or no refund.',
        ),
        p(
          'Other changes. We do not change the date, time or meeting point of a departure that already has bookings. If we have to cancel for any other reason, we refund 100% of what you paid.',
        ),
      ],
    },
    {
      id: 'reembolsos',
      title: '8. Refunds',
      blocks: [
        p(
          'Refunds are made to the same card you paid with and are processed as soon as the cancellation is confirmed. When the amount appears on your statement depends on your issuing bank.',
        ),
        p(
          'If the money cannot be returned to the card (for example, because the card was closed or because the payment processor no longer allows reversing the charge), we return it by bank transfer or SINPE Móvil to an account in the name of the person who made the booking, at no cost to you. To do so, we ask you for the account details by email.',
        ),
      ],
    },
    {
      id: 'participacion',
      title: '9. Participation and safety',
      blocks: [
        p(
          'Participants must follow the guide’s instructions. Before booking, check that all participants meet the requirements published for the tour. If someone has a health condition that may affect their participation, we recommend asking us before booking.',
        ),
        p(
          'On adventure tours, each participant (or their parent or guardian, if under age) must sign at the start of the tour the liability agreement required by adventure tourism regulations.',
        ),
        p(
          'The guide may prevent a person from taking part when their participation puts their own safety or that of others at risk (for example, being under the influence of alcohol or drugs, or not meeting a published safety requirement). In those cases there is no automatic refund: we review the case and let you know our decision by email, which may be a 100% refund of the booking or no refund.',
        ),
      ],
    },
    {
      id: 'responsabilidad',
      title: '10. Our liability',
      blocks: [
        p(
          'We are responsible for providing the tour as offered, with the staff, permits, equipment and safety measures required by law' +
            (op.hasLiabilityPolicy
              ? ', and we hold a current civil liability insurance policy.'
              : '.'),
        ),
        p(
          'Nothing in these terms limits our liability for harm to the life, health or physical integrity of participants, or for failure to provide or defective provision of the service, as established by law.',
        ),
        p(
          'We are not responsible for personal belongings you have not handed over to us for safekeeping, or for third-party services you hire on your own (for example, transport to the meeting point).',
        ),
      ],
    },
    {
      id: 'menores',
      title: '11. Minors',
      blocks: [
        p(
          'Minors must take part accompanied by their parent or guardian, or by an adult they have authorized. Whoever books tickets for minors declares that they have that authorization. We do not ask for any information about minors to book, only the number of tickets.',
        ),
      ],
    },
    {
      id: 'datos-personales',
      title: '12. Personal data',
      blocks: [
        p(
          'We process your personal data in accordance with our Privacy notice, which you accept separately when booking through an independent checkbox.',
        ),
      ],
    },
    {
      id: 'quejas',
      title: '13. Complaints',
      blocks: [
        p(
          `If you have a complaint, write to us at ${op.contactEmail} or call us at ${op.phone}. The process is free of charge. We confirm that we received your complaint and give you an answer within a maximum of 10 business days.`,
        ),
        p(
          'You can also go to the National Consumer Commission of the Ministry of Economy, Industry and Commerce (line 800-CONSUMO, www.consumo.go.cr).',
        ),
      ],
    },
    {
      id: 'uso-del-sitio',
      title: '14. Use of the site',
      blocks: [
        p(
          'The texts, photographs and trademarks on this site belong to us or are used with authorization. You may use the site to get information and to book, but not for other commercial purposes or in a way that affects its operation or security.',
        ),
      ],
    },
    {
      id: 'cambios',
      title: '15. Changes to these terms',
      blocks: [
        p(
          'We may update these terms. Each version shows its publication date. Changes do not affect bookings already made, which are governed by the version you accepted when booking.',
        ),
      ],
    },
    {
      id: 'ley-aplicable',
      title: '16. Governing law',
      blocks: [
        p(
          'These terms are governed by the laws of the Republic of Costa Rica. Nothing in them limits the rights the law grants you as a consumer. Any dispute may be brought before the National Consumer Commission or the competent courts of Costa Rica.',
        ),
      ],
    },
  ],
});

import { p, ul, type LegalDocumentFactory } from '../types';

// Privacy notice, version 2026-10-05, English courtesy translation. The Spanish version prevails.
// Keep it in sync with `2026-10-05.es.ts`; this version is immutable.

export const privacyEn: LegalDocumentFactory = (op) => ({
  title: 'Privacy notice',
  intro: [
    p('Version of October 5, 2026.'),
    p(
      'This is a courtesy translation. The Spanish version is the one that applies; if the two differ, the Spanish version prevails.',
    ),
    p(
      'This notice explains what personal data we collect when you book a tour on this site, what we use it for, who we share it with, how long we keep it and how you can exercise your rights, in accordance with Costa Rican Law 8968 on the Protection of Persons regarding the Processing of their Personal Data and its Regulations.',
    ),
  ],
  sections: [
    {
      id: 'responsable',
      title: '1. Data controller',
      blocks: [
        p(
          `The controller of the bookings database is ${op.legalName}, legal ID ${op.taxId}, domiciled at ${op.address}. For any matter related to your personal data, write to us at ${op.privacyEmail} or call us at ${op.phone}.`,
        ),
      ],
    },
    {
      id: 'datos',
      title: '2. What data we collect',
      blocks: [
        p('When you book we ask for:'),
        ul(
          'your full name;',
          'your email address;',
          'the number and type of tickets (adult, child or student).',
        ),
        p(
          'This data is required: without it we cannot confirm your booking, send you the receipt or notify you of changes.',
        ),
        p(
          'We do not ask for an ID document, phone number, address, nationality, health data or data about the people who come with you, including minors.',
        ),
        p(
          'Payment. Your card details travel directly from your browser to our payment processor, OnvoPay (ONVO Costa Rica S.A.), without passing through our servers. We do not see or store the full card number or its security code. From OnvoPay we only receive the payment confirmation and a transaction reference.',
        ),
        p(
          'Saved card. When the charge is made after booking, OnvoPay saves your card so that we can charge you once the departure is confirmed, and we send it your name and email to register you as the cardholder. We only store the card brand, its last four digits and its expiry date, to identify it in our emails. When the booking can no longer be charged again (because it was cancelled, or because it was charged and the departure has started), we ask OnvoPay to delete that record with your card.',
        ),
        p(
          'Payment fraud prevention. If your bank asks you to confirm a charge, the confirmation page loads an OnvoPay component that looks up your IP address and collects technical data about your browser and device to assess the fraud risk of the payment. That data is received directly by OnvoPay and the services it uses for this purpose: ipify and my-ip.io (IP address lookup) and ThreatMetrix, by LexisNexis Risk Solutions (device identification), which may use its own cookies or identifiers. We do not receive or store that data.',
        ),
        p(
          'How long those companies keep that data and where they store it is defined by each of them in its own privacy policy, which you can read on their sites: OnvoPay (onvopay.com/policies), LexisNexis Risk Solutions, for ThreatMetrix (risk.lexisnexis.com/corporate/processing-notices/threatmetrix), ipify (ipify.org) and my-ip.io (my-ip.io). To exercise your rights over that data you can contact them directly.',
        ),
        p(
          'Refunds by transfer. If we need to return money to you by bank transfer or SINPE Móvil because it cannot be returned to your card, we ask you by email for the details of an account in your name and use them only for that refund.',
        ),
        p(
          'Acceptance record. We keep the date and time you accepted the terms and this notice, and the version of each text, as proof of your consent.',
        ),
        p(
          'Technical data. We use your IP address temporarily, in encrypted form and for a maximum of 24 hours, only to prevent abuse of the site. In addition, our hosting providers automatically record technical data about each visit (IP address, date and requested page) and keep it for a maximum of 30 days, for security and error diagnosis. We only use cookies necessary for the site to work: one to remember the language and another to keep your seats on hold while you pay. We do not use advertising or analytics cookies, and we do not track your browsing. The only exception is the fraud prevention component described above, which is only loaded on the page where your bank asks you to confirm a charge.',
        ),
      ],
    },
    {
      id: 'finalidades',
      title: '3. What we use it for',
      blocks: [
        ul(
          'Managing your booking and your payment.',
          'Preventing payment fraud.',
          'Sending you the confirmation, a reminder before the tour and notices about changes, cancellations or refunds.',
          'Handling cancellations, refunds, questions and complaints.',
          'Meeting legal, tax and accounting obligations, such as issuing the electronic invoice.',
        ),
        p(
          'We do not use your data for advertising, we do not send you promotional emails, we do not sell it or give it to third parties for their own purposes, and we do not make automated decisions that affect you. Whether a charge is approved or declined is decided by your bank and OnvoPay.',
        ),
      ],
    },
    {
      id: 'acceso',
      title: '4. Who has access to your data',
      blocks: [
        ul(
          `Authorized staff of ${op.legalName}, only to the extent they need it for their work and under a confidentiality obligation.`,
          'Guides do not see your data: they only know the number of participants of each departure.',
          'The technology providers that help us provide the service, which process the data on our behalf, following our instructions and under confidentiality and security obligations:',
        ),
        {
          kind: 'table',
          head: ['Provider', 'Purpose', 'Where it stores the data'],
          rows: [
            [
              'OnvoPay (ONVO Costa Rica S.A.)',
              'Processing card payments and refunds, saving your card when the charge is made after booking, and preventing payment fraud',
              'ONVO Costa Rica S.A.’s own databases on Amazon Web Services',
            ],
            ['Supabase', 'Database where bookings are stored', 'United States'],
            ['Vercel', 'Website hosting', 'United States'],
            [
              'Railway',
              'Automated processes (sending emails, refunds, data deletion)',
              'United States',
            ],
            ['Resend', 'Sending emails', 'United States'],
            ['Sentry', 'Detecting technical errors on the site', 'United States'],
          ],
        },
        p(
          'To prevent fraud, OnvoPay in turn uses the services ipify, my-ip.io and ThreatMetrix (LexisNexis Risk Solutions), which receive your IP address and technical data about your device directly from your browser and store it outside Costa Rica.',
        ),
        p('We only hand over your data to an authority when a law or a court order requires it.'),
      ],
    },
    {
      id: 'fuera-de-costa-rica',
      title: '5. Storage outside Costa Rica',
      blocks: [
        p(
          'Several of our providers store information on servers located in the United States, and OnvoPay’s fraud prevention services may do so in other countries. We have agreed with our providers on the corresponding confidentiality and security measures. By checking the consent box, you authorize your data to be stored on those servers.',
        ),
      ],
    },
    {
      id: 'conservacion',
      title: '6. How long we keep it',
      blocks: [
        ul(
          'If you start a booking but do not pay for it, we delete that data after 90 days.',
          'For paid bookings, we delete your name, your email and, if there were any, the account details of a refund by transfer, 18 months after the tour date. What remains (date, tour, number of tickets, amount and OnvoPay payment reference) no longer contains your contact details.',
          'We keep that transaction record, without your contact details, for 5 years to meet tax and accounting obligations, and then delete it.',
          'Backups are automatically replaced every 7 days, so deleted data also disappears from them within that period.',
        ),
      ],
    },
    {
      id: 'derechos',
      title: '7. Your rights',
      blocks: [
        p('At any time and free of charge, you can:'),
        ul(
          'access the data we hold about you;',
          'ask us to correct or update it;',
          'ask us to delete it, except for data the law requires us to keep;',
          'withdraw your consent. Withdrawal does not affect what was done before, but if the booking is still pending, without your data we will not be able to provide the service.',
        ),
        p(
          `To exercise these rights, write to ${op.privacyEmail} from the email address you booked with, or mention it in your message. We may ask you to confirm your identity. We answer within a maximum of five business days.`,
        ),
        p(
          'If you believe we did not properly handle your request, you can go to the Agency for the Protection of Inhabitants’ Data (PRODHAB), www.prodhab.go.cr.',
        ),
      ],
    },
    {
      id: 'seguridad',
      title: '8. Security',
      blocks: [
        p(
          'We protect your data with technical and organizational measures: encrypted connections, role-based access, a record of staff actions and personal access links that expire. If a security incident affecting your data occurs, we will inform you, together with what we are doing about it, within the time limits set by law.',
        ),
      ],
    },
    {
      id: 'menores',
      title: '9. Minors',
      blocks: [
        p(
          'The site is intended for adults. We do not knowingly collect personal data from minors.',
        ),
      ],
    },
    {
      id: 'cambios',
      title: '10. Changes to this notice',
      blocks: [
        p(
          'If we change this notice, we publish the new version with its date. If the change involves a new use of your data, we ask for your consent.',
        ),
      ],
    },
  ],
});

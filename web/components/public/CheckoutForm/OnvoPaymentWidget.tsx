'use client';

import { useEffect } from 'react';
import { useLocale } from 'next-intl';
import { useRouter } from 'next/navigation';
import { ONVO_PAYMENT_TYPE_ONE_TIME, ONVO_SDK_URL } from '@shared/constants/payments';
import type { OnvoSdk } from './onvo-sdk';
import styles from './CheckoutForm.module.css';

type Props = { paymentIntentId: string; bookingId: string };

/**
 * Widget de pago embebido de OnvoPay (spec 0028, C4: extraído de CheckoutForm por SRP y
 * el límite de 150 líneas). Carga el SDK una sola vez (dedupe por src) y monta el widget
 * sobre el intent creado server-side; el monto NO es editable desde el cliente.
 */
export function OnvoPaymentWidget({ paymentIntentId, bookingId }: Props) {
  const locale = useLocale();
  const router = useRouter();

  useEffect(() => {
    const renderWidget = (onvo: OnvoSdk) => {
      onvo
        .pay({
          publicKey: process.env.NEXT_PUBLIC_ONVOPAY_PUBLIC_KEY,
          paymentIntentId,
          paymentType: ONVO_PAYMENT_TYPE_ONE_TIME,
          onSuccess: () => {
            router.push(`/${locale}/checkout/success?booking=${bookingId}`);
          },
          onError: () => {
            router.push(`/${locale}/checkout/cancel?booking=${bookingId}`);
          },
        })
        .render('#onvo-payment-container');
    };

    if (window.onvo) {
      renderWidget(window.onvo);
      return;
    }

    // El <script> del SDK se agrega una sola vez (dedupe por src); expone el global
    // window.onvo, así que no se remueve al desmontar.
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${ONVO_SDK_URL}"]`);
    const script = existing ?? document.createElement('script');
    const onLoad = () => {
      if (window.onvo) renderWidget(window.onvo);
    };
    script.addEventListener('load', onLoad);
    if (!existing) {
      script.src = ONVO_SDK_URL;
      script.async = true;
      document.head.appendChild(script);
    }
    return () => script.removeEventListener('load', onLoad);
  }, [paymentIntentId, bookingId, locale, router]);

  return <div id="onvo-payment-container" className={styles.widgetContainer} />;
}

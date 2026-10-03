import { useTranslations } from 'next-intl';
import styles from './TourForm.module.css';

// Política ante una salida bajo el mínimo: no se configura por tour. Con el cobro diferido decide
// el staff desde la bandeja de Salidas (spec 0033 §15); la sección solo lo explica.
// `tours.auto_cancel_below_minimum` quedó sin uso desde el 2026-10-02 y el formulario ya no lo envía.
export default function TourMinimumPolicyField() {
  const t = useTranslations('tours');

  return (
    <fieldset className={styles.section}>
      <legend className={styles.sectionTitle}>{t('minimum-policy-section')}</legend>
      <p className={styles.hint}>{t('minimum-policy-hint')}</p>
    </fieldset>
  );
}

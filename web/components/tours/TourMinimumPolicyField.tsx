import { useTranslations } from 'next-intl';
import styles from './TourForm.module.css';

type Props = {
  checked: boolean;
};

// Política del tour ante una salida bajo el mínimo. Desde el spec 0035 la regla es una sola y la
// fijan los términos (cláusula 7): toda salida que un día antes no alcanza el mínimo se cancela
// con reembolso del 100 %. El formulario ya no ofrece la casilla; el valor guardado, que solo usa
// el motor del cobro diferido (spec 0033), se conserva con un campo oculto para que guardar el
// tour no lo cambie.
export default function TourMinimumPolicyField({ checked }: Props) {
  const t = useTranslations('tours');

  return (
    <fieldset className={styles.section}>
      <legend className={styles.sectionTitle}>{t('minimum-policy-section')}</legend>
      {checked ? <input type="hidden" name="auto_cancel_below_minimum" value="on" /> : null}
      <p className={styles.hint}>{t('minimum-policy-hint')}</p>
    </fieldset>
  );
}

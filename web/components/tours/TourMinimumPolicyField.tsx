import { useTranslations } from 'next-intl';
import styles from './TourForm.module.css';

type Props = {
  checked: boolean;
  onChange: (checked: boolean) => void;
};

// Política del tour ante una salida bajo el mínimo (spec 0029). El valor vive en el estado de
// TourForm, pero el checkbox usa `defaultChecked` y no `checked`: React 19 hace form.reset()
// tras la action y eso desmarca en el DOM incluso un checkbox controlado (verificado en el
// navegador con un error de validación). Con defaultChecked ligado al estado, el reset
// restaura justo el valor elegido.
export default function TourMinimumPolicyField({ checked, onChange }: Props) {
  const t = useTranslations('tours');

  return (
    <fieldset className={styles.section}>
      <legend className={styles.sectionTitle}>{t('minimum-policy-section')}</legend>
      <label className={styles.checkLabel}>
        <input
          type="checkbox"
          name="auto_cancel_below_minimum"
          defaultChecked={checked}
          onChange={(e) => onChange(e.target.checked)}
        />
        {t('field-auto-cancel-below-minimum')}
      </label>
      <p className={styles.hint}>{t('hint-auto-cancel-below-minimum')}</p>
    </fieldset>
  );
}

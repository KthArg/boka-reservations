import styles from './settings.module.css';

type Props = {
  name: string;
  label: string;
  hint: string;
  min: number;
  max: number;
  value: string;
  onChange: (value: string) => void;
};

// Campo de horas de `/dashboard/settings`. Controlado: React 19 hace form.reset() tras la action
// y borraría lo tipeado si la validación falla.
export function SettingsHoursField({ name, label, hint, min, max, value, onChange }: Props) {
  return (
    <div className={styles.field}>
      <label className={styles.label}>
        {label}
        <input
          type="number"
          name={name}
          required
          step={1}
          min={min}
          max={max}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={styles.input}
        />
      </label>
      <p className={styles.hint}>{hint}</p>
    </div>
  );
}

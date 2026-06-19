import styles from './TourForm.module.css';

type Props = {
  label: string;
  name: string;
  type?: string;
  // Controlado: pasar `value` + `onChange`. Sin `onChange` cae a no-controlado (`defaultValue`).
  // El form de tours usa el modo controlado para que React 19 no borre los campos al hacer
  // form.reset() tras la action (los valores viven en estado y sobreviven al re-render).
  value?: string;
  onChange?: (value: string) => void;
  defaultValue?: string | number | null;
  errors?: string[];
  multiline?: boolean;
  min?: number;
};

export function TourField({
  label,
  name,
  type = 'text',
  value,
  onChange,
  defaultValue,
  errors,
  multiline,
  min,
}: Props) {
  const valueProps = onChange
    ? {
        value: value ?? '',
        onChange: (e: { target: { value: string } }) => onChange(e.target.value),
      }
    : { defaultValue: defaultValue ?? undefined };
  const inputProps = { name, className: styles.input, min, ...valueProps };
  return (
    <label className={styles.label}>
      {label}
      {multiline ? (
        <textarea {...inputProps} className={styles.textarea} rows={3} />
      ) : (
        <input type={type} {...inputProps} />
      )}
      {errors?.map((e) => (
        <span key={e} className={styles.fieldError}>
          {e}
        </span>
      ))}
    </label>
  );
}

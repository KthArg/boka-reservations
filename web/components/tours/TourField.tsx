import styles from './TourForm.module.css';

type Props = {
  label: string;
  name: string;
  type?: string;
  defaultValue?: string | number | null;
  errors?: string[];
  multiline?: boolean;
  min?: number;
};

export function TourField({
  label,
  name,
  type = 'text',
  defaultValue,
  errors,
  multiline,
  min,
}: Props) {
  const inputProps = {
    name,
    className: styles.input,
    defaultValue: defaultValue ?? undefined,
    min,
  };
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

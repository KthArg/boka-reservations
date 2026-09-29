'use client';

import { useState, type InputHTMLAttributes } from 'react';
import { clampToRule, isValidNumber, parseDraft, type NumberRule } from './number-rule';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> & {
  value: number;
  /**
   * En `report` recibe NaN mientras lo escrito no sea un número. En `correct` recibe siempre un
   * valor dentro de la regla (vacío cuenta como el mínimo), para que lo que depende del campo
   * (un total, por ejemplo) nunca se calcule con NaN.
   */
  onChange: (value: number) => void;
  rule: NumberRule;
  /**
   * `correct`: al salir del campo lo lleva al rango (vacío = mínimo), sin mostrar error.
   * `report`: al salir del campo, o al intentar guardar, avisa si el número no sirve.
   */
  mode: 'correct' | 'report';
  errorMessage?: string;
  /** El formulario intentó guardar: mostrar el error aunque el campo no se haya tocado. */
  forceError?: boolean;
  errorClassName?: string;
};

/**
 * Campo numérico que deja borrar y escribir libremente, y valida recién al salir del campo o al
 * guardar. Antes, cada tecla se convertía a número y un campo vacío volvía a 0 o a 1 al instante.
 */
export function NumberField({
  value,
  onChange,
  rule,
  mode,
  errorMessage,
  forceError = false,
  errorClassName,
  onBlur,
  ...inputProps
}: Props) {
  const [draft, setDraft] = useState(Number.isFinite(value) ? String(value) : '');
  const [touched, setTouched] = useState(false);

  // Lo último que informó este campo: ese valor no se vuelve a escribir encima de lo que se está
  // tipeando (vacío informa el mínimo en `correct`, y no debe aparecer un 0 mientras se escribe).
  const [emitted, setEmitted] = useState(value);

  // Si el valor cambia desde afuera (otra fila, un reset), se refleja, salvo que sea lo mismo que
  // ya está escrito ("12." y 12 son el mismo número). Se ajusta durante el render, el patrón de
  // React para estado que sigue a una prop.
  const [previous, setPrevious] = useState(value);
  if (!Object.is(value, previous)) {
    setPrevious(value);
    const external = !Object.is(value, emitted);
    if (external && Number.isFinite(value) && parseDraft(draft) !== value) setDraft(String(value));
  }

  const emit = (next: number) => {
    setEmitted(next);
    onChange(next);
  };

  const invalid = !isValidNumber(parseDraft(draft), rule);
  const showError = mode === 'report' && invalid && (touched || forceError);

  return (
    <>
      <input
        {...inputProps}
        type="number"
        min={rule.min}
        max={rule.max}
        step={rule.integer ? 1 : inputProps.step}
        value={draft}
        aria-invalid={showError || undefined}
        onChange={(e) => {
          setDraft(e.target.value);
          const parsed = parseDraft(e.target.value);
          emit(mode === 'correct' ? clampToRule(parsed, rule) : parsed);
        }}
        onBlur={(e) => {
          setTouched(true);
          if (mode === 'correct' && invalid) {
            const corrected = clampToRule(parseDraft(draft), rule);
            setDraft(String(corrected));
            emit(corrected);
          }
          onBlur?.(e);
        }}
      />
      {showError && errorMessage ? (
        <span className={errorClassName} role="alert">
          {errorMessage}
        </span>
      ) : null}
    </>
  );
}

'use client';

import { useTransition, type FormEvent } from 'react';

/**
 * Envía un formulario a su action sin el `form.reset()` automático de React 19.
 *
 * Con `<form action={formAction}>`, React resetea el formulario al terminar la action, también
 * cuando falla la validación. Los `<select>` controlados quedan mostrando la primera opción
 * aunque el estado conserve el valor elegido (los horarios se veían en domingo y los precios en
 * adulto), y los campos no controlados pierden lo que se escribió. Con `onSubmit` y la action
 * dentro de una transición, `isPending` de `useActionState` sigue funcionando y no hay reset.
 */
export function useSubmitWithoutReset(formAction: (formData: FormData) => void) {
  const [, startTransition] = useTransition();
  return (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => formAction(formData));
  };
}

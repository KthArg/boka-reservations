import { BATCH_SIZE } from './statuses.js';

// Rotación de lotes entre ciclos (spec 0029 §5.5: ningún cobro queda sin dueño). Un lote fijo con
// las N filas más viejas se traba cuando esas N solo esperan (un 3DS con plazo de semanas, un
// processing): la fila N+1 no se miraría nunca. Con la rotación, cada ciclo toma la ventana
// siguiente y vuelve al principio cuando una ventana llega incompleta. El estado vive en memoria:
// un reinicio vuelve a empezar desde el principio, que es seguro. Si salen filas del conjunto
// entre ciclos, alguna puede saltearse una vuelta; la toma la vuelta siguiente.

export type BatchWindow = { from: number; to: number };

export function createBatchRotation(size: number = BATCH_SIZE) {
  let offset = 0;
  return {
    /** Rango inclusivo para `.range(from, to)` de supabase-js. */
    window(): BatchWindow {
      return { from: offset, to: offset + size - 1 };
    },
    /** Avanza según cuántas filas trajo la ventana actual. */
    advance(fetched: number): void {
      offset = fetched < size ? 0 : offset + size;
    },
  };
}

export type BatchRotation = ReturnType<typeof createBatchRotation>;

import { describe, expect, it } from 'vitest';
import { createBatchRotation } from '../../../src/charges/batch-rotation.js';

const SIZE = 50;

describe('createBatchRotation', () => {
  it('starts at the first window', () => {
    // Act
    const window = createBatchRotation(SIZE).window();

    // Assert
    expect(window).toEqual({ from: 0, to: 49 });
  });

  it('moves to the next window after a full batch', () => {
    // Arrange
    const rotation = createBatchRotation(SIZE);

    // Act
    rotation.advance(SIZE);

    // Assert
    expect(rotation.window()).toEqual({ from: 50, to: 99 });
  });

  it('reaches rows past the first batch even when the first rows never leave the set', () => {
    // Arrange: 51 filas que solo esperan; la 51 queda en la segunda ventana.
    const rotation = createBatchRotation(SIZE);
    const seen = new Set<number>();
    const total = 51;

    // Act: dos ciclos.
    for (let cycle = 0; cycle < 2; cycle += 1) {
      const { from, to } = rotation.window();
      const rows = Array.from({ length: total }, (_, i) => i).slice(from, to + 1);
      rows.forEach((row) => seen.add(row));
      rotation.advance(rows.length);
    }

    // Assert
    expect(seen.size).toBe(total);
  });

  it('wraps to the beginning after an incomplete batch', () => {
    // Arrange
    const rotation = createBatchRotation(SIZE);
    rotation.advance(SIZE);

    // Act
    rotation.advance(1);

    // Assert
    expect(rotation.window()).toEqual({ from: 0, to: 49 });
  });
});

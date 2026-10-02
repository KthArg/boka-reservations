// Latido del worker (spec 0029 §11): el check-in sale cuando el ciclo termina, y sale como error
// cuando el job lanza, sin tragarse la excepción.
import { beforeEach, describe, expect, it, vi } from 'vitest';

type CheckIn = { monitorSlug: string; status: string };
const captureCheckIn = vi.hoisted(() => vi.fn<(checkIn: CheckIn, config: unknown) => void>());
vi.mock('@sentry/node', () => ({ captureCheckIn }));

const { withHeartbeat } = await import('../../src/liveness.js');

const statusOfLastCheckIn = (): string | undefined => captureCheckIn.mock.lastCall?.[0].status;

beforeEach(() => {
  captureCheckIn.mockClear();
});

describe('withHeartbeat', () => {
  it('checks in as ok once the cycle finished', async () => {
    // Arrange
    const job = vi.fn().mockResolvedValue(undefined);

    // Act
    await withHeartbeat(job)();

    // Assert
    expect(job).toHaveBeenCalledTimes(1);
    expect(captureCheckIn).toHaveBeenCalledTimes(1);
    expect(statusOfLastCheckIn()).toBe('ok');
  });

  it('checks in as error and rethrows when the cycle throws', async () => {
    // Arrange
    const failure = new Error('db caída');
    const job = vi.fn().mockRejectedValue(failure);

    // Act
    const run = withHeartbeat(job)();

    // Assert
    await expect(run).rejects.toBe(failure);
    expect(statusOfLastCheckIn()).toBe('error');
  });

  it('declares a one-minute interval monitor so Sentry notices a missed check-in', async () => {
    // Arrange
    const job = vi.fn().mockResolvedValue(undefined);

    // Act
    await withHeartbeat(job)();

    // Assert
    expect(captureCheckIn.mock.lastCall?.[1]).toMatchObject({
      schedule: { type: 'interval', value: 1, unit: 'minute' },
    });
  });
});

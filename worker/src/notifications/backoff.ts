const MS_PER_SECOND = 1_000;
const SECONDS_PER_MINUTE = 60;
const MS_PER_MINUTE = MS_PER_SECOND * SECONDS_PER_MINUTE;

const FIRST_RETRY_MS = MS_PER_MINUTE;
const SECOND_RETRY_MS = MS_PER_MINUTE * 5;
const THIRD_RETRY_MS = MS_PER_MINUTE * 30;

export const MAX_ATTEMPTS = 3;
const BACKOFF_SCHEDULE_MS: readonly number[] = [FIRST_RETRY_MS, SECOND_RETRY_MS, THIRD_RETRY_MS];

export function nextScheduledFor(currentAttempts: number, now: Date = new Date()): Date {
  const idx = Math.min(currentAttempts, BACKOFF_SCHEDULE_MS.length - 1);
  const delay = BACKOFF_SCHEDULE_MS[idx] ?? THIRD_RETRY_MS;
  return new Date(now.getTime() + delay);
}

/**
 * Terminal recién DESPUÉS de agotar los 3 reintentos (1, 5 y 30 min): con
 * `>= MAX_ATTEMPTS` el tercer reintento (el de 30 min) era inalcanzable y la
 * tolerancia real a una caída del provider era ~6 min (fix del spec 0028).
 */
export function isTerminalAfter(attemptsAfterThisFailure: number): boolean {
  return attemptsAfterThisFailure > MAX_ATTEMPTS;
}

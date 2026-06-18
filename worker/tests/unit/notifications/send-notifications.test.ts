import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/env.js', () => ({
  env: {
    NEXT_PUBLIC_SUPABASE_URL: 'http://localhost:54321',
    SUPABASE_SERVICE_ROLE_KEY: 'test-service-key',
    APP_URL: 'http://localhost:3000',
    NODE_ENV: 'test',
    EMAIL_PROVIDER: 'mailpit',
    EMAIL_FROM: 'test@example.com',
    SMTP_HOST: 'localhost',
    SMTP_PORT: 1025,
    NOTIFICATIONS_ENABLED: true,
  },
}));

const adapterMocks = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('../../../src/notifications/adapters/index.js', () => ({
  getEmailAdapter: () => ({ provider: 'mailpit', send: adapterMocks.send }),
}));
const adapterSend = adapterMocks.send;

const repoMocks = vi.hoisted(() => ({
  fetchPending: vi.fn(),
  loadBookingForNotification: vi.fn(),
  cancelNotification: vi.fn(),
  markSent: vi.fn(),
  markFailed: vi.fn(),
  handleTransient: vi.fn(),
}));
vi.mock('../../../src/notifications/repository.js', () => repoMocks);
const {
  fetchPending,
  loadBookingForNotification,
  cancelNotification,
  markSent,
  markFailed,
  handleTransient,
} = repoMocks;

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({})),
}));

// 0011: los emails de booking ahora emiten un token de acceso a la reserva.
vi.mock('../../../src/notifications/booking-token.js', () => ({
  issueBookingToken: vi.fn().mockResolvedValue('tok-test'),
}));

import { sendNotifications } from '../../../src/jobs/send-notifications.js';
import { EmailPermanentError, EmailTransientError } from '../../../src/notifications/types.js';

// Relativo a "ahora" (siempre > la ventana stale de 1h de prepareBookingEmail). Un literal
// fijo se vuelve un time-bomb: el día que el reloj lo pasa, prepareBookingEmail lo marca stale
// y el happy path deja de despachar. testing-practices: no fechas reales fijas en tests.
const FUTURE = new Date(Date.now() + 25 * 60 * 60 * 1000).toISOString();

const notif = {
  id: 'notif-1',
  booking_id: 'booking-1',
  kind: 'booking_confirmation' as const,
  recipient_email: 'maria@example.com',
  locale: 'es' as const,
  attempts: 0,
  scheduled_for: '2026-05-29T12:00:00.000Z',
};

const bookingConfirmed = {
  id: 'booking-1',
  customer_name: 'María',
  customer_email: 'maria@example.com',
  tickets_adult: 2,
  tickets_child: 0,
  tickets_student: 0,
  total_amount_cents: 10_000,
  currency: 'USD',
  status: 'confirmed',
  tour_instance: {
    starts_at: FUTURE,
    tour: {
      name_es: 'Tour ES',
      name_en: 'Tour EN',
      meeting_point_es: 'Punto ES',
      meeting_point_en: 'Point EN',
    },
  },
};

describe('sendNotifications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchPending.mockResolvedValue([notif]);
    loadBookingForNotification.mockResolvedValue(bookingConfirmed);
  });

  afterEach(() => vi.restoreAllMocks());

  it('despacha y marca sent cuando el adapter responde OK', async () => {
    adapterSend.mockResolvedValue({ providerMessageId: 'msg-123' });
    await sendNotifications();
    expect(adapterSend).toHaveBeenCalledTimes(1);
    expect(markSent).toHaveBeenCalledWith(expect.anything(), 'notif-1', 'mailpit', 'msg-123');
    expect(markFailed).not.toHaveBeenCalled();
    expect(cancelNotification).not.toHaveBeenCalled();
  });

  it('cancela si el booking no esta confirmed', async () => {
    loadBookingForNotification.mockResolvedValue({ ...bookingConfirmed, status: 'cancelled' });
    await sendNotifications();
    expect(adapterSend).not.toHaveBeenCalled();
    expect(cancelNotification).toHaveBeenCalledWith(
      expect.anything(),
      'notif-1',
      'booking-status-cancelled',
    );
  });

  it('cancela si el booking no existe', async () => {
    loadBookingForNotification.mockResolvedValue(null);
    await sendNotifications();
    expect(adapterSend).not.toHaveBeenCalled();
    expect(cancelNotification).toHaveBeenCalledWith(
      expect.anything(),
      'notif-1',
      'booking-not-found',
    );
  });

  it('cancela cuando el tour ya paso hace mas de 1h (stale)', async () => {
    const past = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    loadBookingForNotification.mockResolvedValue({
      ...bookingConfirmed,
      tour_instance: { ...bookingConfirmed.tour_instance, starts_at: past },
    });
    await sendNotifications();
    expect(adapterSend).not.toHaveBeenCalled();
    expect(cancelNotification).toHaveBeenCalledWith(expect.anything(), 'notif-1', 'stale');
  });

  it('llama handleTransient ante error transitorio del adapter', async () => {
    adapterSend.mockRejectedValue(new EmailTransientError('503 boom', 503));
    await sendNotifications();
    expect(handleTransient).toHaveBeenCalledWith(
      expect.anything(),
      notif,
      'mailpit',
      expect.stringContaining('503 boom'),
    );
    expect(markFailed).not.toHaveBeenCalled();
  });

  it('marca failed inmediato ante error permanente del adapter', async () => {
    adapterSend.mockRejectedValue(new EmailPermanentError('400 bad', 400));
    await sendNotifications();
    expect(markFailed).toHaveBeenCalledWith(
      expect.anything(),
      'notif-1',
      'mailpit',
      1,
      expect.stringContaining('400 bad'),
    );
    expect(handleTransient).not.toHaveBeenCalled();
  });

  it('sale temprano si no hay pendientes', async () => {
    fetchPending.mockResolvedValue([]);
    await sendNotifications();
    expect(loadBookingForNotification).not.toHaveBeenCalled();
    expect(adapterSend).not.toHaveBeenCalled();
  });
});

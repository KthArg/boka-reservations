export const ErrorCode = {
  // Auth
  Unauthorized: 'UNAUTHORIZED',
  Forbidden: 'FORBIDDEN',
  SessionExpired: 'SESSION_EXPIRED',

  // Tours
  TourNotFound: 'TOUR_NOT_FOUND',
  TourInactive: 'TOUR_INACTIVE',

  // General
  NotFound: 'NOT_FOUND',
  ValidationError: 'VALIDATION_ERROR',
  InternalError: 'INTERNAL_ERROR',
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];

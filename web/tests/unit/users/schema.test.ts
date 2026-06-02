import { describe, it, expect } from 'vitest';
import { UserRole } from '@shared/constants/enums';
import { UserCreateSchema, UserUpdateSchema } from '@shared/schemas';

describe('UserCreateSchema', () => {
  const valid = {
    email: 'a@b.com',
    full_name: 'Juan Pérez',
    role: UserRole.Staff,
    phone: null,
    locale: 'es',
  };

  it('accepts a valid staff user without phone', () => {
    expect(UserCreateSchema.safeParse(valid).success).toBe(true);
  });

  it('requires phone for guides', () => {
    const result = UserCreateSchema.safeParse({ ...valid, role: UserRole.Guide, phone: null });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.phone).toContain('phone-required-for-guide');
    }
  });

  it('accepts a guide with phone', () => {
    const result = UserCreateSchema.safeParse({
      ...valid,
      role: UserRole.Guide,
      phone: '+506 8000-0000',
    });
    expect(result.success).toBe(true);
  });

  it('treats an empty-string phone as null', () => {
    const result = UserCreateSchema.safeParse({ ...valid, phone: '' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.phone).toBeNull();
  });

  it('rejects an invalid email', () => {
    const result = UserCreateSchema.safeParse({ ...valid, email: 'not-an-email' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.email).toContain('email-invalid');
    }
  });

  it('rejects an unsupported locale', () => {
    expect(UserCreateSchema.safeParse({ ...valid, locale: 'fr' }).success).toBe(false);
  });
});

describe('UserUpdateSchema', () => {
  it('accepts the editable fields', () => {
    const result = UserUpdateSchema.safeParse({
      full_name: 'Ana Solís',
      phone: '+506 8000-0000',
      locale: 'en',
    });
    expect(result.success).toBe(true);
  });

  it('rejects an empty full_name', () => {
    const result = UserUpdateSchema.safeParse({ full_name: '', phone: null, locale: 'es' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.full_name).toContain('full-name-required');
    }
  });
});

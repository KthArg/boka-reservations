// Stub de `server-only` para vitest (spec 0023, INFRA-03). El paquete real es un guard de
// build-time de Next que lanza al importarse en un bundle de cliente; no es resolvable en el
// runtime de vitest (node). Los configs de test lo aliasan a este módulo vacío para poder
// importar módulos server-only (supabase-service, payments, invite-set-token, etc.) en los tests.
export {};

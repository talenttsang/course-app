const LOCAL_WEBHOOK_SECRET = "test-webhook-secret";

// A matching secret plus an unknown store is 400. Any other secret is 401,
// the same result as sending none. Local runs use the stand-in secret. An
// external instance skips the 400 check unless E2E_WEBHOOK_SECRET is set.
export function webhookSecretForUnknownStore(env: {
  E2E_WEBHOOK_SECRET?: string;
  E2E_BASE_URL?: string;
}): string | undefined {
  const configured = env.E2E_WEBHOOK_SECRET?.trim();
  if (configured) return configured;
  if (env.E2E_BASE_URL?.trim()) return undefined;
  return LOCAL_WEBHOOK_SECRET;
}

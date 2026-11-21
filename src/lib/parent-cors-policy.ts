export function isAllowedParentOrigin(
  origin: string | null,
  configuredOrigins = process.env.PARENT_APP_ORIGINS ?? ""
): origin is string {
  if (!origin) return false;

  const allowedOrigins = configuredOrigins
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  return allowedOrigins.includes(origin);
}

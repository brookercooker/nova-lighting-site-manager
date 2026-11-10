import { isAllowedOrigin, normalizeOrigin, parseAllowedOrigins } from "./embed.ts";

export function managerOrigins(embed: string | undefined, manager: string | undefined): string[] {
  return [...new Set([...parseAllowedOrigins(embed), ...parseAllowedOrigins(manager)])];
}

export function managerCors(req: Request, allowed: string[], methods = "POST, OPTIONS") {
  const origin = normalizeOrigin(req.headers.get("Origin"));
  return {
    ...(isAllowedOrigin(origin, allowed) && origin ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : {}),
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": methods,
  };
}

export function allowedCaptureOrigin(value: unknown, allowed: string[]): string | null {
  if (typeof value !== "string") return null;
  const origin = normalizeOrigin(value);
  // Unlike an Origin header, a body value could contain credentials, a path or query.
  return origin && value === origin && isAllowedOrigin(origin, allowed) ? origin : null;
}

export function validCapturePath(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("/") && !value.includes("//") && !value.includes("://");
}
import type { SMTPConfig } from "../shared/model.js";

export class OAuthError extends Error {
  constructor(
    message: string,
    public code: string,
  ) {
    super(message);
    this.name = "OAuthError";
  }
}

// Fixed Microsoft endpoint and SMTP scope; no caller-supplied URLs or redirects.
export async function getMicrosoftToken(config: SMTPConfig, request: typeof fetch = fetch) {
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    scope: "https://outlook.office365.com/.default",
    grant_type: "client_credentials",
  });
  try {
    const response = await request(
      `https://login.microsoftonline.com/${encodeURIComponent(config.tenantId)}/oauth2/v2.0/token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
        redirect: "error",
        signal: AbortSignal.timeout(config.timeout),
      },
    );
    const data = await response.json();
    if (!response.ok) {
      // Do not expose raw Microsoft error descriptions, which can echo credentials.
      const aadCode = Array.isArray(data.error_codes)
        ? data.error_codes.find(
            (value: unknown) => Number.isSafeInteger(value) && Number(value) > 0,
          )
        : undefined;
      throw new OAuthError(
        "Microsoft hat die Token-Anforderung abgelehnt.",
        aadCode ? `AADSTS${aadCode}` : "OAUTH_TOKEN_REJECTED",
      );
    }
    if (
      typeof data.access_token !== "string" ||
      !data.access_token ||
      data.access_token.length > 16384 ||
      String(data.token_type).toLowerCase() !== "bearer"
    )
      throw new OAuthError(
        "Microsoft hat kein gültiges Zugriffstoken geliefert.",
        "OAUTH_INVALID_RESPONSE",
      );
    return data.access_token as string;
  } catch (error) {
    if (error instanceof OAuthError) throw error;
    throw new OAuthError(
      "Microsoft-Token-Endpunkt nicht erreichbar oder Zeitüberschreitung.",
      "OAUTH_REQUEST_FAILED",
    );
  }
}

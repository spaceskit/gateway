import {
  issueHttpPrincipalToken,
  type HttpPrincipalAuthOptions,
} from "../src/services/http-principal-auth.js";

export const TEST_HTTP_PRINCIPAL_SECRET = "test-secret";

export function createHttpPrincipalTestContext(
  now: Date = new Date("2026-03-02T20:00:00.000Z"),
): {
  now: Date;
  principalAuth: HttpPrincipalAuthOptions;
  strictPrincipalAuth: HttpPrincipalAuthOptions;
  headers: (principalId: string, options?: { deviceId?: string }) => Record<string, string>;
} {
  const baseAuth: HttpPrincipalAuthOptions = {
    hs256Secret: TEST_HTTP_PRINCIPAL_SECRET,
    now: () => now,
  };

  return {
    now,
    principalAuth: baseAuth,
    strictPrincipalAuth: {
      ...baseAuth,
      strictVerification: true,
    },
    headers: (principalId: string, options?: { deviceId?: string }) => {
      const issued = issueHttpPrincipalToken({
        principalId,
        deviceId: options?.deviceId,
        hs256Secret: TEST_HTTP_PRINCIPAL_SECRET,
        ttlSeconds: 300,
        now: () => now,
      });
      return {
        authorization: `Bearer ${issued.token}`,
      };
    },
  };
}

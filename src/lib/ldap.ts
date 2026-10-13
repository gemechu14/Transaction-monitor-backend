import { readFileSync } from "node:fs";
import { rootCertificates } from "node:tls";
import { Client } from "ldapts";

export interface UserInfo {
  displayName: string | null;
  email: string | null;
  managerDn: string | null;
  givenName: string | null;
  distinguishedName: string;
  username: string | null;
}

export class LdapUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "LdapUnavailableError";
  }
}

function getLdapConfig() {
  const enabled = process.env.AD_ENABLED === "true";
  const primaryUrl = process.env.AD_URL;
  const fallbackUrl = process.env.AD_FALLBACK_URL;
  const domain = process.env.AD_DOMAIN;
  const baseDn = process.env.AD_BASE_DN;
  const bindDn = process.env.AD_USERNAME;
  let password = process.env.AD_PASSWORD;

  if (!enabled) {
    throw new Error("Active Directory authentication is disabled");
  }

  const urls = new Set<string>();
  if (primaryUrl) urls.add(primaryUrl);
  if (fallbackUrl) urls.add(fallbackUrl);

  // If connecting by IP, also try the domain name (better TLS + DNS)
  if (primaryUrl && domain) {
    try {
      const parsed = new URL(primaryUrl);
      const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(parsed.hostname);
      if (isIp) {
        urls.add(`${parsed.protocol}//${domain}:${parsed.port || "636"}`);
      }
    } catch {
      // ignore invalid URL
    }
  }

  if (urls.size === 0 || !baseDn || !bindDn || !password) {
    throw new Error("Active Directory is not configured");
  }

  if (
    (password.startsWith('"') && password.endsWith('"')) ||
    (password.startsWith("'") && password.endsWith("'"))
  ) {
    password = password.slice(1, -1);
  }

  const connectTimeout = Number(process.env.LDAP_CONNECT_TIMEOUT_MS ?? 15000);
  const maxRetries = Number(process.env.LDAP_MAX_RETRIES ?? 1);
  const tlsServername =
    process.env.LDAP_TLS_SERVERNAME || domain || undefined;

  return {
    urls: [...urls],
    baseDn,
    bindDn,
    password,
    connectTimeout,
    maxRetries,
    tlsServername,
  };
}

function createClient(
  url: string,
  connectTimeout: number,
  tlsServername?: string
) {
  const isSecure = url.startsWith("ldaps://");

  return new Client({
    url,
    timeout: connectTimeout,
    connectTimeout,
    ...(isSecure && {
      tlsOptions: {
        rejectUnauthorized:
          process.env.LDAP_TLS_REJECT_UNAUTHORIZED !== "false",
        ...(tlsServername && { servername: tlsServername }),
        // Internal CA that signed the DC certificate (PEM), added on top of Node's defaults.
        ...(process.env.LDAP_CA_CERT_PATH && {
          ca: [...rootCertificates, readFileSync(process.env.LDAP_CA_CERT_PATH, "utf8")],
        }),
      },
    }),
  });
}

function escapeLdapFilter(value: string): string {
  return value.replace(/[\\*()\0]/g, (char) => {
    const hex = char.charCodeAt(0).toString(16).padStart(2, "0");
    return `\\${hex}`;
  });
}

function getAttributeValue(
  entry: Record<string, unknown>,
  attributeName: string
): string | null {
  const value = entry[attributeName];
  if (Array.isArray(value) && value.length > 0) {
    return String(value[0]);
  }
  if (typeof value === "string") {
    return value;
  }
  return null;
}

function isTransientNetworkError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;

  const code = "code" in error ? String(error.code) : "";
  const message =
    error instanceof Error
      ? error.message.toLowerCase()
      : String(error).toLowerCase();

  const transientCodes = [
    "ETIMEDOUT",
    "ECONNRESET",
    "ECONNREFUSED",
    "EHOSTUNREACH",
    "ENETUNREACH",
    "EPIPE",
    "EAI_AGAIN",
  ];

  const transientMessages = [
    "connection timeout",
    "connect timeout",
    "timed out",
    "network unreachable",
    "connection refused",
  ];

  return (
    transientCodes.includes(code) ||
    transientMessages.some((part) => message.includes(part))
  );
}

async function withRetry<T>(
  label: string,
  retries: number,
  fn: () => Promise<T>
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!isTransientNetworkError(error) || attempt === retries) {
        break;
      }
      const waitMs = 1000 * (attempt + 1);
      console.warn(
        `LDAP ${label} failed (attempt ${attempt + 1}/${retries + 1}), retrying in ${waitMs}ms:`,
        error instanceof Error ? error.message : error
      );
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }

  throw lastError;
}

async function findUserEntry(
  client: Client,
  baseDn: string,
  identifier: string
) {
  const escapedIdentifier = escapeLdapFilter(identifier);
  const filter = `(|(mail=${escapedIdentifier})(sAMAccountName=${escapedIdentifier}))`;

  const { searchEntries } = await client.search(baseDn, {
    scope: "sub",
    filter,
    attributes: [
      "distinguishedName",
      "mail",
      "sAMAccountName",
      "displayName",
      "manager",
      "givenName",
    ],
  });

  return searchEntries[0] ?? null;
}

async function authenticateWithUrl(
  url: string,
  baseDn: string,
  bindDn: string,
  password: string,
  connectTimeout: number,
  tlsServername: string | undefined,
  identifier: string,
  userPassword: string
): Promise<UserInfo | null> {
  const client = createClient(url, connectTimeout, tlsServername);

  try {
    // 1. Bind with service account
    await client.bind(bindDn, password);

    // 2. Find user
    const userEntry = await findUserEntry(client, baseDn, identifier);
    if (!userEntry) {
      return null;
    }

    const userDn =
      getAttributeValue(userEntry, "distinguishedName") ?? userEntry.dn;
    if (!userDn) {
      return null;
    }

    // 3. Rebind as user on the same connection (one TLS handshake)
    try {
      await client.bind(userDn, userPassword);
    } catch (error) {
      if (isTransientNetworkError(error)) {
        throw error;
      }
      // AD embeds the real reason (bad password vs. expired/locked/disabled
      // account, sub-codes 532/533/775/etc.) in the bind error message.
      // Logged server-side only — the client still gets a generic 401.
      console.warn(
        `LDAP user bind failed for ${userDn}:`,
        error instanceof Error ? error.message : error
      );
      return null;
    }

    return {
      displayName: getAttributeValue(userEntry, "displayName"),
      email: getAttributeValue(userEntry, "mail"),
      managerDn: getAttributeValue(userEntry, "manager"),
      givenName: getAttributeValue(userEntry, "givenName"),
      distinguishedName: userDn,
      username: getAttributeValue(userEntry, "sAMAccountName"),
    };
  } finally {
    await client.unbind().catch(() => undefined);
  }
}

export async function authenticateUser(
  identifier: string,
  userPassword: string
): Promise<UserInfo | null> {
  const {
    urls,
    baseDn,
    bindDn,
    password,
    connectTimeout,
    maxRetries,
    tlsServername,
  } = getLdapConfig();

  let lastNetworkError: unknown;

  for (const url of urls) {
    try {
      return await withRetry("authenticate", maxRetries, () =>
        authenticateWithUrl(
          url,
          baseDn,
          bindDn,
          password,
          connectTimeout,
          tlsServername,
          identifier,
          userPassword
        )
      );
    } catch (error) {
      if (isTransientNetworkError(error)) {
        lastNetworkError = error;
        console.warn(
          `LDAP failed via ${url}:`,
          error instanceof Error ? error.message : error
        );
        continue;
      }
      throw error;
    }
  }

  throw new LdapUnavailableError(
    `Cannot reach Active Directory (${urls.join(", ")})`,
    { cause: lastNetworkError }
  );
}

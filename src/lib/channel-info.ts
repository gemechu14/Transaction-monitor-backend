import type { ChannelInfo, ChannelType } from "@prisma/client";

/**
 * Validation and shaping for admin-edited channel details. Kept free of the
 * database so the rules can be tested on their own.
 */

export const CHANNEL_TYPES: readonly ChannelType[] = ["normal", "nightly", "monthly", "yearly", "seasonal"];

export const MAX_OWNERS = 10;
const MAX_LENGTH = { description: 300, ownerName: 120, ownerEmail: 254 } as const;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// A type, not an interface, so Prisma accepts a list of these as JSON.
export type ChannelOwner = { name: string | null; email: string | null };

/** Fields a PATCH may write; `undefined` means "not sent, leave as is". */
export interface ChannelPatch {
  description?: string | null;
  /** Replaces the whole list; `[]` removes every owner. */
  owners?: ChannelOwner[];
  channelType?: ChannelType | null;
  /** Always written as a sorted, de-duplicated list; `[]` stands for "no months". */
  activeMonths?: number[];
}

type Saved = Pick<ChannelInfo, "channelType" | "activeMonths"> | null;

/** Trimmed text, `null` for empty (clears the field), `undefined` when not sent (left as is). */
function readText(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const text = String(value).trim();
  return text ? text : null;
}

/** Checks the owners list: each needs a name or an email, emails are valid and not repeated. */
function parseOwners(value: unknown): { owners: ChannelOwner[] } | { error: string } {
  if (value === null) return { owners: [] };
  if (!Array.isArray(value)) return { error: "owners must be a list of { name, email }" };
  if (value.length > MAX_OWNERS) return { error: `A channel can have at most ${MAX_OWNERS} owners` };

  const owners: ChannelOwner[] = [];
  const seen = new Set<string>();
  for (const [i, item] of value.entries()) {
    const label = `Owner ${i + 1}`;
    if (!item || typeof item !== "object" || Array.isArray(item)) return { error: `${label} must be { name, email }` };
    const { name: rawName, email: rawEmail } = item as Record<string, unknown>;
    const name = readText(rawName) ?? null;
    const email = readText(rawEmail)?.toLowerCase() ?? null;

    if (!name && !email) continue; // an empty row in the form, not an owner
    if (name && name.length > MAX_LENGTH.ownerName) return { error: `${label}: name must be at most ${MAX_LENGTH.ownerName} characters` };
    if (email) {
      if (email.length > MAX_LENGTH.ownerEmail) return { error: `${label}: email must be at most ${MAX_LENGTH.ownerEmail} characters` };
      if (!EMAIL_PATTERN.test(email)) return { error: `${label}: email is not valid` };
      if (seen.has(email)) return { error: `${email} is listed more than once` };
      seen.add(email);
    }
    owners.push({ name, email });
  }
  return { owners };
}

/**
 * Checks a PATCH body against the saved row and returns what to write, or a
 * readable error for a 400. Type and months are checked on the merged result,
 * so a description-only PATCH on a seasonal channel stays valid.
 */
export function parseChannelPatch(body: unknown, saved: Saved): { data: ChannelPatch } | { error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { error: "Invalid body" };
  const input = body as Record<string, unknown>;

  if (input.ownerName !== undefined || input.ownerEmail !== undefined) {
    return { error: "ownerName and ownerEmail were replaced by owners: [{ name, email }]" };
  }

  const data: ChannelPatch = { description: readText(input.description) };
  if (data.description && data.description.length > MAX_LENGTH.description) {
    return { error: `description must be at most ${MAX_LENGTH.description} characters` };
  }

  if (input.owners !== undefined) {
    const parsed = parseOwners(input.owners);
    if ("error" in parsed) return parsed;
    data.owners = parsed.owners;
  }

  if (input.channelType !== undefined) {
    if (input.channelType !== null && !CHANNEL_TYPES.includes(input.channelType as ChannelType)) {
      return { error: `channelType must be one of ${CHANNEL_TYPES.join(", ")}, or null` };
    }
    data.channelType = input.channelType as ChannelType | null;
  }

  let months: number[] | undefined;
  if (input.activeMonths !== undefined) {
    if (input.activeMonths === null) {
      months = [];
    } else {
      const list = input.activeMonths;
      if (!Array.isArray(list) || list.length > 12 || !list.every((m) => Number.isInteger(m) && m >= 1 && m <= 12)) {
        return { error: "activeMonths must be null or a list of months from 1 to 12" };
      }
      months = [...new Set(list as number[])].sort((a, b) => a - b);
    }
  }

  const type = data.channelType !== undefined ? data.channelType : (saved?.channelType ?? null);
  if (type === "seasonal") {
    const resulting = months ?? saved?.activeMonths ?? [];
    if (!resulting.length) return { error: "Pick at least one month for a seasonal channel." };
    if (months) data.activeMonths = months;
  } else if (months !== undefined || saved?.activeMonths?.length) {
    // Months only mean something for seasonal channels; clear any that are sent or left over.
    data.activeMonths = [];
  }

  return { data };
}

/** A row as the API returns it: `owners` is always a list, no months is `null` like an unset type. */
export function toChannelResponse(row: ChannelInfo) {
  return {
    ...row,
    owners: Array.isArray(row.owners) ? (row.owners as unknown as ChannelOwner[]) : [],
    channelType: row.channelType ?? null,
    activeMonths: row.activeMonths?.length ? row.activeMonths : null,
  };
}

import type { ChannelInfo, ChannelType } from "@prisma/client";

/**
 * Validation and shaping for admin-edited channel details. Kept free of the
 * database so the rules can be tested on their own.
 */

export const CHANNEL_TYPES: readonly ChannelType[] = ["normal", "nightly", "monthly", "yearly", "seasonal"];

const MAX_LENGTH = { description: 300, ownerName: 120, ownerEmail: 254 } as const;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Fields a PATCH may write; `undefined` means "not sent, leave as is". */
export interface ChannelPatch {
  description?: string | null;
  ownerName?: string | null;
  ownerEmail?: string | null;
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

/**
 * Checks a PATCH body against the saved row and returns what to write, or a
 * readable error for a 400. Type and months are checked on the merged result,
 * so a description-only PATCH on a seasonal channel stays valid.
 */
export function parseChannelPatch(body: unknown, saved: Saved): { data: ChannelPatch } | { error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { error: "Invalid body" };
  const input = body as Record<string, unknown>;

  const ownerEmail = readText(input.ownerEmail);
  const data: ChannelPatch = {
    description: readText(input.description),
    ownerName: readText(input.ownerName),
    ownerEmail: ownerEmail ? ownerEmail.toLowerCase() : ownerEmail,
  };
  for (const [field, max] of Object.entries(MAX_LENGTH)) {
    const value = data[field as keyof typeof MAX_LENGTH];
    if (value && value.length > max) return { error: `${field} must be at most ${max} characters` };
  }
  if (data.ownerEmail && !EMAIL_PATTERN.test(data.ownerEmail)) return { error: "Owner email is not valid" };

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

/** A row as the API returns it: no months is `null`, like an unset type. */
export function toChannelResponse(row: ChannelInfo) {
  // `?.`: a row read by an outdated Prisma client has no activeMonths at all.
  return { ...row, channelType: row.channelType ?? null, activeMonths: row.activeMonths?.length ? row.activeMonths : null };
}

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ChannelInfo } from "@prisma/client";

import { parseChannelPatch, toChannelResponse } from "@/lib/channel-info";

const NONE = null;
const SEASONAL_SAVED = { channelType: "seasonal" as const, activeMonths: [5, 6, 7] };

function ok(result: ReturnType<typeof parseChannelPatch>) {
  if ("error" in result) assert.fail(`expected data, got error: ${result.error}`);
  return result.data;
}

function error(result: ReturnType<typeof parseChannelPatch>) {
  if (!("error" in result)) assert.fail("expected an error");
  return result.error;
}

describe("parseChannelPatch: channel type and active months", () => {
  it("saves a seasonal type with its months", () => {
    const data = ok(parseChannelPatch({ channelType: "seasonal", activeMonths: [5, 6, 7] }, NONE));
    assert.equal(data.channelType, "seasonal");
    assert.deepEqual(data.activeMonths, [5, 6, 7]);
  });

  it("rejects a seasonal type without months", () => {
    assert.equal(
      error(parseChannelPatch({ channelType: "seasonal", activeMonths: [] }, NONE)),
      "Pick at least one month for a seasonal channel.",
    );
    assert.match(error(parseChannelPatch({ channelType: "seasonal", activeMonths: null }, NONE)), /at least one month/);
    assert.match(error(parseChannelPatch({ channelType: "seasonal" }, NONE)), /at least one month/);
  });

  it("clears months for a non-seasonal type even when months are sent", () => {
    const data = ok(parseChannelPatch({ channelType: "nightly", activeMonths: [5, 6] }, NONE));
    assert.equal(data.channelType, "nightly");
    assert.deepEqual(data.activeMonths, []);
  });

  it("clears saved months when a seasonal channel changes type", () => {
    const data = ok(parseChannelPatch({ channelType: "monthly" }, SEASONAL_SAVED));
    assert.deepEqual(data.activeMonths, []);
  });

  it("clears saved months when the type is cleared to null", () => {
    const data = ok(parseChannelPatch({ channelType: null, activeMonths: null }, SEASONAL_SAVED));
    assert.equal(data.channelType, null);
    assert.deepEqual(data.activeMonths, []);
  });

  it("rejects an unknown type", () => {
    assert.match(error(parseChannelPatch({ channelType: "weekly" }, NONE)), /channelType must be one of/);
    assert.match(error(parseChannelPatch({ channelType: "Seasonal" }, NONE)), /channelType must be one of/);
  });

  it("rejects months outside 1–12 and non-integer months", () => {
    for (const activeMonths of [[13], [0], [1.5], ["5"], 5, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 1]]) {
      assert.match(
        error(parseChannelPatch({ channelType: "seasonal", activeMonths }, NONE)),
        /activeMonths must be/,
        `activeMonths=${JSON.stringify(activeMonths)}`,
      );
    }
  });

  it("de-duplicates and sorts months", () => {
    const data = ok(parseChannelPatch({ channelType: "seasonal", activeMonths: [7, 5, 5] }, NONE));
    assert.deepEqual(data.activeMonths, [5, 7]);
  });

  it("leaves type and months untouched on a description-only PATCH", () => {
    const data = ok(parseChannelPatch({ description: "Hajj pilgrimage payments" }, SEASONAL_SAVED));
    assert.equal(data.description, "Hajj pilgrimage payments");
    assert.equal(data.channelType, undefined);
    assert.equal(data.activeMonths, undefined);
  });

  it("allows changing only the months of a saved seasonal channel", () => {
    const data = ok(parseChannelPatch({ activeMonths: [6] }, SEASONAL_SAVED));
    assert.equal(data.channelType, undefined);
    assert.deepEqual(data.activeMonths, [6]);
  });

  it("rejects clearing the months of a saved seasonal channel", () => {
    assert.match(error(parseChannelPatch({ activeMonths: null }, SEASONAL_SAVED)), /at least one month/);
  });
});

describe("parseChannelPatch: existing fields keep their rules", () => {
  it("trims text, clears empty values and lowercases the email", () => {
    const data = ok(parseChannelPatch({ description: "  x  ", ownerName: "", ownerEmail: " A@B.COM " }, NONE));
    assert.deepEqual(data, { description: "x", ownerName: null, ownerEmail: "a@b.com" });
  });

  it("rejects a bad body, long text and an invalid email", () => {
    assert.equal(error(parseChannelPatch(null, NONE)), "Invalid body");
    assert.equal(error(parseChannelPatch([], NONE)), "Invalid body");
    assert.match(error(parseChannelPatch({ description: "x".repeat(301) }, NONE)), /at most 300/);
    assert.equal(error(parseChannelPatch({ ownerEmail: "nope" }, NONE)), "Owner email is not valid");
  });
});

describe("toChannelResponse", () => {
  const row: ChannelInfo = {
    source: "ips",
    description: null,
    ownerName: null,
    ownerEmail: null,
    channelType: null,
    activeMonths: [],
    updatedAt: new Date("2026-11-20T09:15:00Z"),
    updatedBy: null,
  };

  it("returns null for an unset type and no months", () => {
    const out = toChannelResponse(row);
    assert.equal(out.channelType, null);
    assert.equal(out.activeMonths, null);
  });

  it("returns saved months as a list", () => {
    assert.deepEqual(toChannelResponse({ ...row, channelType: "seasonal", activeMonths: [5, 6, 7] }).activeMonths, [5, 6, 7]);
  });
});

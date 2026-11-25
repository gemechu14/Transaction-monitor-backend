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

describe("parseChannelPatch: owners", () => {
  it("saves several owners, trimming text and lowercasing emails", () => {
    const data = ok(
      parseChannelPatch(
        { owners: [{ name: " Abebe Kebede ", email: " Abebe.K@B.COM " }, { name: "Ops team", email: null }, { email: "x@b.com" }] },
        NONE,
      ),
    );
    assert.deepEqual(data.owners, [
      { name: "Abebe Kebede", email: "abebe.k@b.com" },
      { name: "Ops team", email: null },
      { name: null, email: "x@b.com" },
    ]);
  });

  it("drops empty rows and clears the list with [] or null", () => {
    assert.deepEqual(ok(parseChannelPatch({ owners: [{ name: "", email: " " }, { name: "A" }] }, NONE)).owners, [{ name: "A", email: null }]);
    assert.deepEqual(ok(parseChannelPatch({ owners: [] }, NONE)).owners, []);
    assert.deepEqual(ok(parseChannelPatch({ owners: null }, NONE)).owners, []);
  });

  it("leaves owners untouched when not sent", () => {
    assert.equal(ok(parseChannelPatch({ description: "x" }, NONE)).owners, undefined);
  });

  it("rejects bad lists, invalid or repeated emails, long names and too many owners", () => {
    assert.match(error(parseChannelPatch({ owners: "Abebe" }, NONE)), /owners must be a list/);
    assert.match(error(parseChannelPatch({ owners: ["Abebe"] }, NONE)), /Owner 1 must be/);
    assert.equal(error(parseChannelPatch({ owners: [{ name: "A" }, { email: "nope" }] }, NONE)), "Owner 2: email is not valid");
    assert.match(error(parseChannelPatch({ owners: [{ email: "a@b.com" }, { email: "A@B.com" }] }, NONE)), /more than once/);
    assert.match(error(parseChannelPatch({ owners: [{ name: "x".repeat(121) }] }, NONE)), /at most 120/);
    const many = Array.from({ length: 11 }, (_, i) => ({ email: `o${i}@b.com` }));
    assert.match(error(parseChannelPatch({ owners: many }, NONE)), /at most 10 owners/);
  });

  it("rejects the old single-owner fields with a pointer to owners", () => {
    assert.match(error(parseChannelPatch({ ownerName: "Abebe" }, NONE)), /replaced by owners/);
  });
});

describe("parseChannelPatch: description", () => {
  it("trims text and clears empty values", () => {
    assert.equal(ok(parseChannelPatch({ description: "  x  " }, NONE)).description, "x");
    assert.equal(ok(parseChannelPatch({ description: "" }, NONE)).description, null);
  });

  it("rejects a bad body and long text", () => {
    assert.equal(error(parseChannelPatch(null, NONE)), "Invalid body");
    assert.equal(error(parseChannelPatch([], NONE)), "Invalid body");
    assert.match(error(parseChannelPatch({ description: "x".repeat(301) }, NONE)), /at most 300/);
  });
});

describe("toChannelResponse", () => {
  const row: ChannelInfo = {
    source: "ips",
    description: null,
    owners: [],
    channelType: null,
    activeMonths: [],
    updatedAt: new Date("2026-11-20T09:15:00Z"),
    updatedBy: null,
  };

  it("returns null for an unset type and no months", () => {
    const out = toChannelResponse(row);
    assert.equal(out.channelType, null);
    assert.equal(out.activeMonths, null);
    assert.deepEqual(out.owners, []);
  });

  it("returns saved months as a list", () => {
    assert.deepEqual(toChannelResponse({ ...row, channelType: "seasonal", activeMonths: [5, 6, 7] }).activeMonths, [5, 6, 7]);
  });
});

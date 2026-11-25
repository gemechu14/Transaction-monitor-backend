-- Channels can have several owners: move ownerName/ownerEmail into an "owners" list.
ALTER TABLE "ChannelInfo" ADD COLUMN "owners" JSONB NOT NULL DEFAULT '[]';

UPDATE "ChannelInfo"
SET "owners" = jsonb_build_array(jsonb_build_object('name', "ownerName", 'email', "ownerEmail"))
WHERE "ownerName" IS NOT NULL OR "ownerEmail" IS NOT NULL;

ALTER TABLE "ChannelInfo" DROP COLUMN "ownerName",
DROP COLUMN "ownerEmail";

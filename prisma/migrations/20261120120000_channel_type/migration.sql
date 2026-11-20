-- Channel type and, for seasonal channels, the months they are active.
-- Existing rows get no type (read as "normal") and no months.

-- CreateEnum
CREATE TYPE "ChannelType" AS ENUM ('normal', 'nightly', 'monthly', 'yearly', 'seasonal');

-- AlterTable
ALTER TABLE "ChannelInfo" ADD COLUMN     "activeMonths" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
ADD COLUMN     "channelType" "ChannelType";

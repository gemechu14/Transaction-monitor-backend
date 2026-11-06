-- CreateTable
CREATE TABLE "ChannelInfo" (
    "source" TEXT NOT NULL,
    "description" TEXT,
    "ownerName" TEXT,
    "ownerEmail" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "ChannelInfo_pkey" PRIMARY KEY ("source")
);

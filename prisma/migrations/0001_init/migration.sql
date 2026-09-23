-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Workspace" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "timezone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Settings" (
    "workspaceId" TEXT NOT NULL,
    "claudeKeyEnc" TEXT,
    "claudeKeyLast4" TEXT,
    "claudeVerifiedAt" TIMESTAMP(3),
    "draftModel" TEXT NOT NULL DEFAULT 'claude-sonnet-5',
    "checkerModel" TEXT NOT NULL DEFAULT 'claude-haiku-4-5-20251001',
    "creativity" TEXT NOT NULL DEFAULT 'balanced',
    "monthlyCapCents" INTEGER,
    "lastImagePlatforms" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lastGenerator" TEXT NOT NULL DEFAULT 'builtin',

    CONSTRAINT "Settings_pkey" PRIMARY KEY ("workspaceId")
);

-- CreateTable
CREATE TABLE "PromptLayer" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "textPrompt" TEXT NOT NULL,
    "imagePrompt" TEXT NOT NULL,
    "rules" JSONB NOT NULL,
    "imageDefaults" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PromptLayer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromptVersion" (
    "id" TEXT NOT NULL,
    "layerId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "textPrompt" TEXT NOT NULL,
    "imagePrompt" TEXT NOT NULL,
    "rules" JSONB NOT NULL,
    "imageDefaults" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromptVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrandKit" (
    "workspaceId" TEXT NOT NULL,
    "logoPrimaryUrl" TEXT,
    "logoReverseUrl" TEXT,
    "logoIconUrl" TEXT,
    "logoPosition" TEXT NOT NULL DEFAULT 'tl',
    "logoSize" TEXT NOT NULL DEFAULT 'M',
    "autoReverse" BOOLEAN NOT NULL DEFAULT true,
    "sigCompany" TEXT,
    "sigPersonal" TEXT,
    "sigPlacement" TEXT NOT NULL DEFAULT 'opposite',
    "sigSize" TEXT NOT NULL DEFAULT 'S',
    "backgrounds" JSONB NOT NULL,
    "textColors" JSONB NOT NULL,
    "headlineFont" TEXT NOT NULL DEFAULT 'Fraunces',
    "bodyFont" TEXT NOT NULL DEFAULT 'IBM Plex Sans',
    "customFonts" JSONB NOT NULL DEFAULT '[]',
    "bannedPhrases" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "BrandKit_pkey" PRIMARY KEY ("workspaceId")
);

-- CreateTable
CREATE TABLE "Integration" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "credentialsEnc" TEXT NOT NULL,
    "last4" TEXT,
    "status" TEXT NOT NULL,
    "meta" JSONB,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Integration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PublishingAccount" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "tokensEnc" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "displayName" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PublishingAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Brief" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "goal" TEXT NOT NULL,
    "tone" TEXT NOT NULL,
    "link" TEXT,
    "subreddit" TEXT,
    "postPlatforms" TEXT[],
    "imagePlatforms" TEXT[],
    "generator" TEXT NOT NULL DEFAULT 'builtin',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Brief_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Draft" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "briefId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "hasPost" BOOLEAN NOT NULL DEFAULT true,
    "title" TEXT,
    "subtitle" TEXT,
    "body" TEXT,
    "firstComment" TEXT,
    "hashtags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "variants" JSONB,
    "visualBrief" JSONB,
    "placeholders" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL,
    "warnings" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "promptVersionId" TEXT,
    "model" TEXT,
    "tokensIn" INTEGER,
    "tokensOut" INTEGER,
    "externalId" TEXT,
    "externalUrl" TEXT,
    "publishedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Draft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImageAsset" (
    "id" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "sizeKey" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "generator" TEXT NOT NULL,
    "spec" JSONB NOT NULL,
    "urls" TEXT[],
    "mimeType" TEXT NOT NULL DEFAULT 'image/png',
    "note" TEXT,
    "status" TEXT NOT NULL,
    "warnings" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImageAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduleItem" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "runAtUtc" TIMESTAMP(3) NOT NULL,
    "mode" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "externalUrl" TEXT,
    "jobId" TEXT,
    "remindJobId" TEXT,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduleItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PostingWindow" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "days" INTEGER[],
    "startMin" INTEGER NOT NULL,
    "endMin" INTEGER NOT NULL,

    CONSTRAINT "PostingWindow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationPref" (
    "workspaceId" TEXT NOT NULL,
    "leadMinutes" INTEGER NOT NULL DEFAULT 15,
    "slack" BOOLEAN NOT NULL DEFAULT true,
    "email" BOOLEAN NOT NULL DEFAULT true,
    "browser" BOOLEAN NOT NULL DEFAULT false,
    "events" TEXT[] DEFAULT ARRAY['ready', 'published', 'failed']::TEXT[],

    CONSTRAINT "NotificationPref_pkey" PRIMARY KEY ("workspaceId")
);

-- CreateTable
CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "keys" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageRecord" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "platform" TEXT,
    "model" TEXT NOT NULL,
    "promptVersionId" TEXT,
    "tokensIn" INTEGER NOT NULL,
    "tokensOut" INTEGER NOT NULL,
    "costMicroUsd" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UsageRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "PromptLayer_workspaceId_platform_key" ON "PromptLayer"("workspaceId", "platform");

-- CreateIndex
CREATE INDEX "PromptVersion_layerId_version_idx" ON "PromptVersion"("layerId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "Integration_workspaceId_type_key" ON "Integration"("workspaceId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "PublishingAccount_workspaceId_platform_key" ON "PublishingAccount"("workspaceId", "platform");

-- CreateIndex
CREATE INDEX "Brief_workspaceId_createdAt_idx" ON "Brief"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "Draft_workspaceId_status_idx" ON "Draft"("workspaceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduleItem_draftId_key" ON "ScheduleItem"("draftId");

-- CreateIndex
CREATE INDEX "ScheduleItem_workspaceId_runAtUtc_idx" ON "ScheduleItem"("workspaceId", "runAtUtc");

-- CreateIndex
CREATE UNIQUE INDEX "PostingWindow_workspaceId_platform_key" ON "PostingWindow"("workspaceId", "platform");

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");

-- CreateIndex
CREATE INDEX "UsageRecord_workspaceId_createdAt_idx" ON "UsageRecord"("workspaceId", "createdAt");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Settings" ADD CONSTRAINT "Settings_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromptVersion" ADD CONSTRAINT "PromptVersion_layerId_fkey" FOREIGN KEY ("layerId") REFERENCES "PromptLayer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrandKit" ADD CONSTRAINT "BrandKit_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Draft" ADD CONSTRAINT "Draft_briefId_fkey" FOREIGN KEY ("briefId") REFERENCES "Brief"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImageAsset" ADD CONSTRAINT "ImageAsset_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "Draft"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleItem" ADD CONSTRAINT "ScheduleItem_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "Draft"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationPref" ADD CONSTRAINT "NotificationPref_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;


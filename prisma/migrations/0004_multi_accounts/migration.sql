-- Several publishing accounts per platform (e.g. teammates' LinkedIn profiles).
ALTER TABLE "PublishingAccount" ADD COLUMN "accountKey" TEXT NOT NULL DEFAULT '';

-- Existing LinkedIn profiles are keyed by their person URN, so reconnecting the same
-- person updates the row instead of adding a second one.
UPDATE "PublishingAccount" SET "accountKey" = "meta"->>'personUrn'
WHERE "platform" = 'lip' AND "meta"->>'personUrn' IS NOT NULL;

DROP INDEX "PublishingAccount_workspaceId_platform_key";
CREATE UNIQUE INDEX "PublishingAccount_workspaceId_platform_accountKey_key" ON "PublishingAccount"("workspaceId", "platform", "accountKey");

-- Which account a draft posts as; NULL = the platform's default account.
ALTER TABLE "Draft" ADD COLUMN "accountId" TEXT;

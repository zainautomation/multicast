-- Blog posts: target keyword on the brief, URL slug on the draft.
ALTER TABLE "Brief" ADD COLUMN "keyword" TEXT;
ALTER TABLE "Draft" ADD COLUMN "slug" TEXT;

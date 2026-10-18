ALTER TABLE "registry"."transaction" ADD COLUMN "origin" jsonb;--> statement-breakpoint
ALTER TABLE "registry"."share_class" ADD COLUMN "seniority_rank" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "registry"."share_class" ADD COLUMN "liq_pref_multiple" numeric(24, 10) DEFAULT '1' NOT NULL;--> statement-breakpoint
ALTER TABLE "registry"."share_class" ADD COLUMN "liq_pref_cap_multiple" numeric(24, 10);--> statement-breakpoint
ALTER TABLE "registry"."share_class" ADD COLUMN "participation" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "registry"."share_class" ADD COLUMN "anti_dilution" text DEFAULT 'none' NOT NULL;
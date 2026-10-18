CREATE SCHEMA "captable";
--> statement-breakpoint
CREATE TABLE "captable"."settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"include_unallocated_pool" boolean DEFAULT true NOT NULL,
	"holders_see_full_table" boolean DEFAULT false NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "captable_settings_singleton" CHECK ("captable"."settings"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "captable"."equity_plan" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"profile" text NOT NULL,
	"kind" text NOT NULL,
	"class_code" text DEFAULT '' NOT NULL,
	"approved_on" date,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "captable"."exercise" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"grant_id" uuid NOT NULL,
	"date" date NOT NULL,
	"units" bigint NOT NULL,
	"registry_tx_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "captable"."grant" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"stakeholder_id" uuid NOT NULL,
	"units" bigint NOT NULL,
	"strike_price" numeric(24, 10) NOT NULL,
	"grant_date" date NOT NULL,
	"vesting_start" date NOT NULL,
	"schedule_id" uuid,
	"terminated_on" date,
	"leaver" text,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "captable"."pool_change" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"date" date NOT NULL,
	"delta" bigint NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"scenario_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "captable"."scenario" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"base_date" date NOT NULL,
	"base_seq" integer DEFAULT 0 NOT NULL,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"shared_with" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"promoted_tx_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "captable"."stakeholder_group" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"color" text DEFAULT 'indigo' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "captable"."stakeholder" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"kind" text DEFAULT 'person' NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"country" text DEFAULT '' NOT NULL,
	"group_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "captable"."unpriced_instrument" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stakeholder_id" uuid NOT NULL,
	"profile" text NOT NULL,
	"kind" text NOT NULL,
	"amount" bigint NOT NULL,
	"original_amount" bigint,
	"original_currency" text,
	"valuation_cap" bigint,
	"discount_pct" numeric(9, 6) DEFAULT '0' NOT NULL,
	"interest_rate_pct" numeric(9, 6) DEFAULT '0' NOT NULL,
	"interest" text DEFAULT 'simple' NOT NULL,
	"post_money" boolean DEFAULT true NOT NULL,
	"mfn" boolean DEFAULT false NOT NULL,
	"signed_on" date NOT NULL,
	"maturity_date" date,
	"conversion_tx_id" uuid,
	"cancelled_on" date,
	"notes" text DEFAULT '' NOT NULL,
	"file_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "captable"."valuation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"date" date NOT NULL,
	"price_per_share" numeric(24, 10) NOT NULL,
	"source" text NOT NULL,
	"method" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"inputs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"file_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "captable"."vesting_schedule" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"cliff_months" integer NOT NULL,
	"total_months" integer NOT NULL,
	"frequency_months" integer NOT NULL,
	"acceleration" text DEFAULT 'none' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "captable"."settings" ADD CONSTRAINT "settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "captable"."exercise" ADD CONSTRAINT "exercise_grant_id_grant_id_fk" FOREIGN KEY ("grant_id") REFERENCES "captable"."grant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "captable"."exercise" ADD CONSTRAINT "exercise_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "captable"."grant" ADD CONSTRAINT "grant_plan_id_equity_plan_id_fk" FOREIGN KEY ("plan_id") REFERENCES "captable"."equity_plan"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "captable"."grant" ADD CONSTRAINT "grant_stakeholder_id_stakeholder_id_fk" FOREIGN KEY ("stakeholder_id") REFERENCES "captable"."stakeholder"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "captable"."grant" ADD CONSTRAINT "grant_schedule_id_vesting_schedule_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "captable"."vesting_schedule"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "captable"."pool_change" ADD CONSTRAINT "pool_change_plan_id_equity_plan_id_fk" FOREIGN KEY ("plan_id") REFERENCES "captable"."equity_plan"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "captable"."pool_change" ADD CONSTRAINT "pool_change_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "captable"."scenario" ADD CONSTRAINT "scenario_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "captable"."stakeholder" ADD CONSTRAINT "stakeholder_group_id_stakeholder_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "captable"."stakeholder_group"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "captable"."unpriced_instrument" ADD CONSTRAINT "unpriced_instrument_stakeholder_id_stakeholder_id_fk" FOREIGN KEY ("stakeholder_id") REFERENCES "captable"."stakeholder"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "captable"."unpriced_instrument" ADD CONSTRAINT "unpriced_instrument_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "captable"."valuation" ADD CONSTRAINT "valuation_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "captable"."valuation" ADD CONSTRAINT "valuation_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "exercise_grant_idx" ON "captable"."exercise" USING btree ("grant_id");--> statement-breakpoint
CREATE INDEX "grant_plan_idx" ON "captable"."grant" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX "grant_stakeholder_idx" ON "captable"."grant" USING btree ("stakeholder_id");--> statement-breakpoint
CREATE INDEX "pool_change_plan_idx" ON "captable"."pool_change" USING btree ("plan_id","date");--> statement-breakpoint
CREATE INDEX "scenario_created_by_idx" ON "captable"."scenario" USING btree ("created_by");
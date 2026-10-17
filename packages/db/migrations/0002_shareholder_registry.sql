CREATE SCHEMA "registry";
--> statement-breakpoint
CREATE TABLE "registry"."certificate" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"holder_id" uuid NOT NULL,
	"class_code" text NOT NULL,
	"range_from" bigint,
	"range_to" bigint,
	"issued_on" date,
	"cancelled_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "registry"."chain_verification" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"ran_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ok" boolean NOT NULL,
	"checked" integer NOT NULL,
	"broken_at_seq" bigint,
	"message" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "registry"."encumbrance" (
	"id" text PRIMARY KEY NOT NULL,
	"holder_id" uuid NOT NULL,
	"class_code" text NOT NULL,
	"count" bigint NOT NULL,
	"ranges" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"pledgee" jsonb NOT NULL,
	"valid_from_tx" uuid NOT NULL,
	"valid_to_tx" uuid,
	"valid_from_date" date NOT NULL,
	"valid_to_date" date
);
--> statement-breakpoint
CREATE TABLE "registry"."holder_version" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"holder_id" uuid NOT NULL,
	"tx_id" uuid NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"national_id" text DEFAULT '' NOT NULL,
	"country" text DEFAULT '' NOT NULL,
	"address" text DEFAULT '' NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"members" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "registry"."holder" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "registry"."instrument" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"terms" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "registry"."lot" (
	"key" text PRIMARY KEY NOT NULL,
	"holder_id" uuid NOT NULL,
	"class_code" text NOT NULL,
	"count" bigint NOT NULL,
	"range_from" bigint,
	"range_to" bigint,
	"nominal_per_share" numeric(24, 10),
	"interim" boolean DEFAULT false NOT NULL,
	"certificate_id" uuid,
	"valid_from_tx" uuid NOT NULL,
	"valid_to_tx" uuid,
	"valid_from_date" date NOT NULL,
	"valid_to_date" date
);
--> statement-breakpoint
CREATE TABLE "registry"."movement" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tx_id" uuid NOT NULL,
	"class_code" text NOT NULL,
	"from_holder_id" uuid,
	"to_holder_id" uuid,
	"count" bigint NOT NULL,
	"range_from" bigint,
	"range_to" bigint,
	"nominal_amount" bigint,
	"price_per_share" numeric(24, 10),
	"consideration" bigint
);
--> statement-breakpoint
CREATE TABLE "registry"."import" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"file_id" uuid NOT NULL,
	"status" text DEFAULT 'extracting' NOT NULL,
	"source" jsonb,
	"result" jsonb,
	"error" text,
	"draft_tx_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "registry"."settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"country" text NOT NULL,
	"legal_form" text NOT NULL,
	"rule_pack" text NOT NULL,
	"national_number" text DEFAULT '' NOT NULL,
	"euid" text DEFAULT '' NOT NULL,
	"lei" text DEFAULT '' NOT NULL,
	"numbering" boolean DEFAULT true NOT NULL,
	"capital_mode" text DEFAULT 'quota' NOT NULL,
	"min_share_capital" bigint,
	"max_share_capital" bigint,
	"min_shares" bigint,
	"max_shares" bigint,
	"four_eyes" boolean DEFAULT false NOT NULL,
	"drafter_can_commit" boolean DEFAULT false NOT NULL,
	"commit_over_mcp" boolean DEFAULT false NOT NULL,
	"tokenize_import_ids" boolean DEFAULT true NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settings_singleton" CHECK ("registry"."settings"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "registry"."transaction" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seq" bigint,
	"type" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"decision_date" date,
	"effective_date" date NOT NULL,
	"registration_date" date,
	"entered_at" timestamp with time zone,
	"reverses_id" uuid,
	"rule_pack_version" text,
	"payload" jsonb NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"prev_hash" text,
	"hash" text,
	"created_by" uuid,
	"submitted_by" uuid,
	"submitted_at" timestamp with time zone,
	"committed_by" uuid,
	"approved_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "registry"."share_class" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"votes_per_share" numeric(24, 10) NOT NULL,
	"nominal_per_share" numeric(24, 10),
	"dividend_terms" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"liquidation_terms" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"conversion_clause" text DEFAULT '' NOT NULL,
	"redemption_clause" text DEFAULT '' NOT NULL,
	"restrictions" jsonb NOT NULL,
	"issued" bigint NOT NULL,
	"valid_from_tx" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "registry"."tx_document" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tx_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"sha256" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "registry"."holder_version" ADD CONSTRAINT "holder_version_holder_id_holder_id_fk" FOREIGN KEY ("holder_id") REFERENCES "registry"."holder"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registry"."import" ADD CONSTRAINT "import_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registry"."import" ADD CONSTRAINT "import_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registry"."settings" ADD CONSTRAINT "settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registry"."transaction" ADD CONSTRAINT "transaction_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registry"."transaction" ADD CONSTRAINT "transaction_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registry"."transaction" ADD CONSTRAINT "transaction_committed_by_users_id_fk" FOREIGN KEY ("committed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registry"."transaction" ADD CONSTRAINT "transaction_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registry"."tx_document" ADD CONSTRAINT "tx_document_tx_id_transaction_id_fk" FOREIGN KEY ("tx_id") REFERENCES "registry"."transaction"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registry"."tx_document" ADD CONSTRAINT "tx_document_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registry"."tx_document" ADD CONSTRAINT "tx_document_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "holder_version_holder_idx" ON "registry"."holder_version" USING btree ("holder_id","valid_from");--> statement-breakpoint
CREATE INDEX "lot_holder_idx" ON "registry"."lot" USING btree ("holder_id");--> statement-breakpoint
CREATE INDEX "lot_valid_idx" ON "registry"."lot" USING btree ("valid_from_date","valid_to_date");--> statement-breakpoint
CREATE INDEX "movement_tx_idx" ON "registry"."movement" USING btree ("tx_id");--> statement-breakpoint
CREATE UNIQUE INDEX "transaction_seq_unique" ON "registry"."transaction" USING btree ("seq");--> statement-breakpoint
CREATE UNIQUE INDEX "transaction_reverses_unique" ON "registry"."transaction" USING btree ("reverses_id");--> statement-breakpoint
CREATE INDEX "transaction_effective_idx" ON "registry"."transaction" USING btree ("effective_date","seq");--> statement-breakpoint
CREATE INDEX "transaction_status_idx" ON "registry"."transaction" USING btree ("status");--> statement-breakpoint
CREATE INDEX "tx_document_tx_idx" ON "registry"."tx_document" USING btree ("tx_id");
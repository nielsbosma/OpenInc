CREATE TABLE "signing_envelopes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid,
	"file_id" uuid NOT NULL,
	"title" text NOT NULL,
	"message" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"routing" text DEFAULT 'parallel' NOT NULL,
	"page_count" integer DEFAULT 1 NOT NULL,
	"document_hash" text,
	"sent_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"voided_at" timestamp with time zone,
	"void_reason" text,
	"sealed_file_id" uuid,
	"sealed_document_id" uuid,
	"sealed_hash" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signing_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"envelope_id" uuid NOT NULL,
	"recipient_id" uuid,
	"seq" integer NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ip" text,
	"user_agent" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"prev_hash" text NOT NULL,
	"hash" text NOT NULL,
	CONSTRAINT "signing_events_seq_unique" UNIQUE("envelope_id","seq")
);
--> statement-breakpoint
CREATE TABLE "signing_fields" (
	"id" uuid PRIMARY KEY NOT NULL,
	"envelope_id" uuid NOT NULL,
	"recipient_id" uuid NOT NULL,
	"type" text NOT NULL,
	"page" integer NOT NULL,
	"x" real NOT NULL,
	"y" real NOT NULL,
	"width" real NOT NULL,
	"height" real NOT NULL,
	"required" boolean DEFAULT true NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"value" text
);
--> statement-breakpoint
CREATE TABLE "signing_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"certificate_pem" text NOT NULL,
	"private_key" text NOT NULL,
	"fingerprint" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"retired_at" timestamp with time zone,
	CONSTRAINT "signing_keys_fingerprint_unique" UNIQUE("fingerprint")
);
--> statement-breakpoint
CREATE TABLE "signing_recipients" (
	"id" uuid PRIMARY KEY NOT NULL,
	"envelope_id" uuid NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"role" text DEFAULT 'signer' NOT NULL,
	"order" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'waiting' NOT NULL,
	"token_hash" text,
	"code_hash" text,
	"code_expires_at" timestamp with time zone,
	"code_attempts" integer DEFAULT 0 NOT NULL,
	"code_sent_at" timestamp with time zone,
	"verified_at" timestamp with time zone,
	"signed_at" timestamp with time zone,
	"declined_at" timestamp with time zone,
	"decline_reason" text,
	CONSTRAINT "signing_recipients_tokenHash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "signing_envelopes" ADD CONSTRAINT "signing_envelopes_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signing_envelopes" ADD CONSTRAINT "signing_envelopes_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signing_envelopes" ADD CONSTRAINT "signing_envelopes_sealed_file_id_files_id_fk" FOREIGN KEY ("sealed_file_id") REFERENCES "public"."files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signing_envelopes" ADD CONSTRAINT "signing_envelopes_sealed_document_id_documents_id_fk" FOREIGN KEY ("sealed_document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signing_envelopes" ADD CONSTRAINT "signing_envelopes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signing_events" ADD CONSTRAINT "signing_events_envelope_id_signing_envelopes_id_fk" FOREIGN KEY ("envelope_id") REFERENCES "public"."signing_envelopes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signing_fields" ADD CONSTRAINT "signing_fields_envelope_id_signing_envelopes_id_fk" FOREIGN KEY ("envelope_id") REFERENCES "public"."signing_envelopes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signing_fields" ADD CONSTRAINT "signing_fields_recipient_id_signing_recipients_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."signing_recipients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signing_recipients" ADD CONSTRAINT "signing_recipients_envelope_id_signing_envelopes_id_fk" FOREIGN KEY ("envelope_id") REFERENCES "public"."signing_envelopes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "signing_envelopes_status_idx" ON "signing_envelopes" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "signing_envelopes_sealed_hash_idx" ON "signing_envelopes" USING btree ("sealed_hash");--> statement-breakpoint
CREATE INDEX "signing_fields_envelope_idx" ON "signing_fields" USING btree ("envelope_id");--> statement-breakpoint
CREATE INDEX "signing_recipients_envelope_idx" ON "signing_recipients" USING btree ("envelope_id","order");
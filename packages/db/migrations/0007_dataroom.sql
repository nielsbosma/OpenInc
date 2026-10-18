CREATE TABLE "data_room_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_id" uuid NOT NULL,
	"link_id" uuid,
	"visitor_id" uuid,
	"session_id" uuid,
	"item_id" uuid,
	"document_id" uuid,
	"type" text NOT NULL,
	"page" integer,
	"page_count" integer,
	"duration_ms" integer,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "data_room_folders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_id" uuid NOT NULL,
	"parent_id" uuid,
	"name" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "data_room_folders_name_unique" UNIQUE NULLS NOT DISTINCT("room_id","parent_id","name")
);
--> statement-breakpoint
CREATE TABLE "data_room_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_id" uuid NOT NULL,
	"folder_id" uuid,
	"document_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"added_by" uuid,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "data_room_items_document_unique" UNIQUE("room_id","document_id")
);
--> statement-breakpoint
CREATE TABLE "data_room_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_id" uuid NOT NULL,
	"label" text NOT NULL,
	"token" text NOT NULL,
	"password_hash" text,
	"allowed_emails" text[] DEFAULT '{}' NOT NULL,
	"allowed_domains" text[] DEFAULT '{}' NOT NULL,
	"require_email" boolean DEFAULT true NOT NULL,
	"verify_email" boolean DEFAULT false NOT NULL,
	"allow_download" boolean DEFAULT false NOT NULL,
	"watermark" boolean DEFAULT true NOT NULL,
	"folder_ids" uuid[],
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "data_room_links_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "data_room_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"link_id" uuid NOT NULL,
	"visitor_id" uuid,
	"token_hash" text NOT NULL,
	"code_hash" text,
	"code_expires_at" timestamp with time zone,
	"code_attempts" integer DEFAULT 0 NOT NULL,
	"email_verified_at" timestamp with time zone,
	"password_ok_at" timestamp with time zone,
	"opened_at" timestamp with time zone,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "data_room_sessions_tokenHash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "data_room_visitors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_id" uuid NOT NULL,
	"email" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"company" text DEFAULT '' NOT NULL,
	"verified_at" timestamp with time zone,
	"nda_accepted_at" timestamp with time zone,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "data_room_visitors_email_unique" UNIQUE("room_id","email")
);
--> statement-breakpoint
CREATE TABLE "data_rooms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"welcome_message" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"owner_id" uuid,
	"default_allow_download" boolean DEFAULT false NOT NULL,
	"default_watermark" boolean DEFAULT true NOT NULL,
	"nda_text" text,
	"closes_at" timestamp with time zone,
	"alert_on_first_visit" boolean DEFAULT true NOT NULL,
	"alert_on_download" boolean DEFAULT true NOT NULL,
	"alert_on_failed_passwords" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "data_room_events" ADD CONSTRAINT "data_room_events_room_id_data_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."data_rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_room_events" ADD CONSTRAINT "data_room_events_link_id_data_room_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."data_room_links"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_room_events" ADD CONSTRAINT "data_room_events_visitor_id_data_room_visitors_id_fk" FOREIGN KEY ("visitor_id") REFERENCES "public"."data_room_visitors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_room_events" ADD CONSTRAINT "data_room_events_session_id_data_room_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."data_room_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_room_events" ADD CONSTRAINT "data_room_events_item_id_data_room_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."data_room_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_room_folders" ADD CONSTRAINT "data_room_folders_room_id_data_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."data_rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_room_folders" ADD CONSTRAINT "data_room_folders_parent_id_data_room_folders_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."data_room_folders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_room_items" ADD CONSTRAINT "data_room_items_room_id_data_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."data_rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_room_items" ADD CONSTRAINT "data_room_items_folder_id_data_room_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."data_room_folders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_room_items" ADD CONSTRAINT "data_room_items_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_room_items" ADD CONSTRAINT "data_room_items_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_room_links" ADD CONSTRAINT "data_room_links_room_id_data_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."data_rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_room_links" ADD CONSTRAINT "data_room_links_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_room_sessions" ADD CONSTRAINT "data_room_sessions_link_id_data_room_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."data_room_links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_room_sessions" ADD CONSTRAINT "data_room_sessions_visitor_id_data_room_visitors_id_fk" FOREIGN KEY ("visitor_id") REFERENCES "public"."data_room_visitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_room_visitors" ADD CONSTRAINT "data_room_visitors_room_id_data_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."data_rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_rooms" ADD CONSTRAINT "data_rooms_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_rooms" ADD CONSTRAINT "data_rooms_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "data_room_events_room_idx" ON "data_room_events" USING btree ("room_id","at");--> statement-breakpoint
CREATE INDEX "data_room_events_document_idx" ON "data_room_events" USING btree ("document_id","at");--> statement-breakpoint
CREATE INDEX "data_room_events_session_idx" ON "data_room_events" USING btree ("session_id","type");--> statement-breakpoint
CREATE INDEX "data_room_items_document_idx" ON "data_room_items" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "data_room_links_room_idx" ON "data_room_links" USING btree ("room_id");--> statement-breakpoint
CREATE INDEX "data_room_sessions_link_idx" ON "data_room_sessions" USING btree ("link_id","created_at");
CREATE TABLE "admin_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "TableAnswers" (
	"Id" integer PRIMARY KEY NOT NULL,
	"answer" text NOT NULL,
	"question" integer NOT NULL,
	"true_answer" integer,
	"numberanswer" integer NOT NULL,
	CONSTRAINT "valid_correct_marker" CHECK ("TableAnswers"."true_answer" is null or "TableAnswers"."true_answer" = 1)
);
--> statement-breakpoint
CREATE TABLE "test_attempts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"visitor_id" uuid NOT NULL,
	"full_name" text NOT NULL,
	"mode" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"snapshot" jsonb NOT NULL,
	"responses" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"total" integer NOT NULL,
	"correct_count" integer DEFAULT 0 NOT NULL,
	"time_limit" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_auth_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"failures" integer DEFAULT 0 NOT NULL,
	"reset_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "TableQuestions" (
	"Id" integer PRIMARY KEY NOT NULL,
	"question" text NOT NULL,
	"blockid" integer NOT NULL,
	"numberquestion" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "portal_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "TableAnswers" ADD CONSTRAINT "TableAnswers_question_TableQuestions_Id_fk" FOREIGN KEY ("question") REFERENCES "public"."TableQuestions"("Id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "answer_question_number" ON "TableAnswers" USING btree ("question","numberanswer");--> statement-breakpoint
CREATE UNIQUE INDEX "one_correct_answer" ON "TableAnswers" USING btree ("question") WHERE "TableAnswers"."true_answer" = 1;--> statement-breakpoint
CREATE INDEX "attempt_visitor" ON "test_attempts" USING btree ("visitor_id");--> statement-breakpoint
CREATE INDEX "attempt_date" ON "test_attempts" USING btree ("started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "question_block_number" ON "TableQuestions" USING btree ("blockid","numberquestion");
import { pgTable, integer, text, timestamp, uuid, jsonb, index, uniqueIndex, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { QuestionData } from "@/lib/types";

export const questions = pgTable("TableQuestions", {
  id: integer("Id").primaryKey(),
  text: text("question").notNull(),
  blockId: integer("blockid").notNull(),
  number: integer("numberquestion").notNull(),
}, (t) => [uniqueIndex("question_block_number").on(t.blockId, t.number)]);

export const answers = pgTable("TableAnswers", {
  id: integer("Id").primaryKey(),
  text: text("answer").notNull(),
  questionId: integer("question").notNull().references(() => questions.id, { onDelete: "cascade" }),
  correct: integer("true_answer"),
  number: integer("numberanswer").notNull(),
}, (t) => [
  uniqueIndex("answer_question_number").on(t.questionId, t.number),
  uniqueIndex("one_correct_answer").on(t.questionId).where(sql`${t.correct} = 1`),
  check("valid_correct_marker", sql`${t.correct} is null or ${t.correct} = 1`),
]);

export const attempts = pgTable("test_attempts", {
  id: uuid("id").primaryKey(),
  visitorId: uuid("visitor_id").notNull(),
  fullName: text("full_name").notNull(),
  mode: text("mode").$type<"general" | "selective">().notNull(),
  status: text("status").$type<"active" | "completed">().notNull().default("active"),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  snapshot: jsonb("snapshot").$type<QuestionData[]>().notNull(),
  responses: jsonb("responses").$type<Record<string, number>>().notNull().default({}),
  total: integer("total").notNull(),
  correctCount: integer("correct_count").notNull().default(0),
  timeLimit: integer("time_limit").notNull().default(0),
}, (t) => [index("attempt_visitor").on(t.visitorId), index("attempt_date").on(t.startedAt)]);

export const settings = pgTable("portal_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const adminSessions = pgTable("admin_sessions", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const authLimits = pgTable("admin_auth_limits", {
  key: text("key").primaryKey(),
  failures: integer("failures").notNull().default(0),
  resetAt: timestamp("reset_at", { withTimezone: true }).notNull(),
});

import { pgTable, integer, serial, text, timestamp, uuid, jsonb, index, uniqueIndex, check } from "npm:drizzle-orm@0.45.2/pg-core";
import { and, asc, count, desc, eq, gt, gte, ilike, lt, sql } from "./drizzle.ts";
import type { QuestionData } from "./types.ts";

export const exams = pgTable("exams", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [uniqueIndex("exams_name_unique").on(t.name)]);

export const questions = pgTable("TableQuestions", {
  examId: integer("exam_id").notNull().references(() => exams.id, { onDelete: "cascade" }),
  id: integer("Id").primaryKey(),
  text: text("question").notNull(),
  blockId: integer("blockid").notNull(),
  number: integer("numberquestion").notNull(),
}, (t) => [uniqueIndex("question_block_number").on(t.examId, t.blockId, t.number)]);

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
  examId: integer("exam_id").references(() => exams.id, { onDelete: "set null" }),
}, (t) => [index("attempt_visitor").on(t.visitorId), index("attempt_date").on(t.startedAt)]);

export const bankBackups = pgTable("bank_backups", {
  id: serial("id").primaryKey(),
  examName: text("exam_name").notNull(),
  description: text("description").notNull().default(""),
  questionCount: integer("question_count").notNull(),
  answerCount: integer("answer_count").notNull(),
  reason: text("reason").notNull().default(""),
  data: jsonb("data").$type<{ blockId: number; number: number; text: string; answers: { number: number; text: string; correct: boolean }[] }[]>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("bank_backups_created_idx").on(t.createdAt)]);

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

-- Автоматические копии банков вопросов: сохраняются перед удалением теста и перед импортом
CREATE TABLE IF NOT EXISTS bank_backups (
  id serial PRIMARY KEY,
  exam_name text NOT NULL,
  description text NOT NULL DEFAULT '',
  question_count integer NOT NULL,
  answer_count integer NOT NULL,
  reason text NOT NULL DEFAULT '',
  data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bank_backups_created_idx ON bank_backups (created_at);

-- Несколько независимых тестов (экзаменов): таблица exams, привязка вопросов и попыток
CREATE TABLE IF NOT EXISTS exams (
  id serial PRIMARY KEY,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS exams_name_unique ON exams (name);
ALTER TABLE "TableQuestions" ADD COLUMN IF NOT EXISTS exam_id integer;
ALTER TABLE test_attempts ADD COLUMN IF NOT EXISTS exam_id integer;
INSERT INTO exams (name, description) VALUES ('Учебный банк', 'Демонстрационные вопросы платформы') ON CONFLICT (name) DO NOTHING;
UPDATE "TableQuestions" SET exam_id = (SELECT id FROM exams WHERE name = 'Учебный банк') WHERE exam_id IS NULL;
UPDATE test_attempts SET exam_id = (SELECT id FROM exams WHERE name = 'Учебный банк') WHERE exam_id IS NULL;
ALTER TABLE "TableQuestions" ALTER COLUMN exam_id SET NOT NULL;
DO $$ BEGIN
  ALTER TABLE "TableQuestions" ADD CONSTRAINT questions_exam_fk FOREIGN KEY (exam_id) REFERENCES exams (id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE test_attempts ADD CONSTRAINT attempts_exam_fk FOREIGN KEY (exam_id) REFERENCES exams (id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DROP INDEX IF EXISTS question_block_number;
CREATE UNIQUE INDEX IF NOT EXISTS question_block_number ON "TableQuestions" (exam_id, blockid, numberquestion);

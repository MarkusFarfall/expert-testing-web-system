-- Названия тематических блоков на каждый тест (раньше были общие — зашиты в коде).
-- Пустое название означает «Тематический блок № N» (подставляет приложение).
CREATE TABLE IF NOT EXISTS exam_blocks (
  exam_id integer NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  block_id integer NOT NULL,
  title text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  PRIMARY KEY (exam_id, block_id)
);

-- Переносим прежние названия в тесты, которые уже наполнены вопросами,
-- чтобы ничего не изменилось для действующих банков.
INSERT INTO exam_blocks (exam_id, block_id, title, description)
SELECT DISTINCT q.exam_id, q.blockid,
  CASE q.blockid
    WHEN 1 THEN 'Промышленная деятельность'
    WHEN 2 THEN 'Происхождение товаров'
    WHEN 3 THEN 'Товароведческая экспертиза'
    WHEN 4 THEN 'Оценочная деятельность'
    WHEN 5 THEN 'Правовые основы экспертизы'
    WHEN 6 THEN 'Качество и цифровой аудит'
    ELSE ''
  END,
  CASE q.blockid
    WHEN 1 THEN 'Субъекты, регулирование и промышленная политика'
    WHEN 2 THEN 'Сертификация и правила определения происхождения'
    WHEN 3 THEN 'Качество, количество и идентификация товаров'
    WHEN 4 THEN 'Подходы, стандарты и определение стоимости'
    WHEN 5 THEN 'Права эксперта и оформление заключений'
    WHEN 6 THEN 'Проверка корпоративных сайтов и доступности'
    ELSE ''
  END
FROM "TableQuestions" q
WHERE q.blockid BETWEEN 1 AND 6
ON CONFLICT (exam_id, block_id) DO NOTHING;

-- Права для роли приложения (на своём сервере) и защита как у остальных таблиц.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'portal') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.exam_blocks TO portal;
    ALTER TABLE public.exam_blocks ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;

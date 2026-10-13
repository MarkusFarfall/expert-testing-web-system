export type Mode = "general" | "selective";
export type AnswerData = { id: number; text: string; number: number; correct?: boolean };
export type ExamData = { id: number; name: string; description: string; questionCount: number; blockCount: number };
export type BackupData = { id: number; examName: string; description: string; questionCount: number; answerCount: number; reason: string; createdAt: string };
export type QuestionData = { id: number; examId: number; text: string; blockId: number; number: number; blockTitle?: string; answers: AnswerData[] };
export type BlockData = { id: number; title: string; description: string; count: number };
export type Overview = { questionCount: number; blockCount: number; completedCount: number; blocks: BlockData[]; updatedAt: string; isDemo: boolean; exams: ExamData[] };
export type AttemptData = {
  id: string; fullName: string; mode: Mode; status: "active" | "completed";
  startedAt: string; finishedAt: string | null; questions: QuestionData[];
  responses: Record<string, number>; total: number; correctCount: number;
  percentage: number; timeLimit: number; examId: number | null; examName: string | null;
};
export type ResultRow = { id: string; fullName: string; mode: Mode; startedAt: string; finishedAt: string | null; total: number; correctCount: number; percentage: number; examName: string | null };
export type AdminStatus = { authenticated: boolean; setupRequired: boolean };
export const modeLabels: Record<Mode, string> = { general: "Общий", selective: "Выборочный" };
export const blockCatalog = [
  { id: 1, title: "Промышленная деятельность", description: "Субъекты, регулирование и промышленная политика" },
  { id: 2, title: "Происхождение товаров", description: "Сертификация и правила определения происхождения" },
  { id: 3, title: "Товароведческая экспертиза", description: "Качество, количество и идентификация товаров" },
  { id: 4, title: "Оценочная деятельность", description: "Подходы, стандарты и определение стоимости" },
  { id: 5, title: "Правовые основы экспертизы", description: "Права эксперта и оформление заключений" },
  { id: 6, title: "Качество и цифровой аудит", description: "Проверка корпоративных сайтов и доступности" },
];
/** Название темы: из базы (своё у каждого теста), иначе — «Тематический блок № N». */
export const getBlockTitle = (id: number, title?: string | null) => (title && title.trim()) || `Тематический блок № ${id}`;
export const formatDate = (value: string, time = false) => new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Kaliningrad", ...(time ? { hour: "2-digit", minute: "2-digit" } as const : {}) }).format(new Date(value));

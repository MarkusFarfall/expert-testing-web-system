import { FileQuestion } from "lucide-react";
import { EmptyState } from "@/components/ui";
export default function NotFound() {
  return <EmptyState icon={<FileQuestion size={34}/>} title="Страница не найдена" text="Возможно, адрес изменился или в ссылке есть опечатка. Вернитесь на главную страницу платформы." action={{ href: "/", label: "На главную" }}/>;
}

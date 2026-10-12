"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { ArrowUpRight, BookOpen, ChartNoAxesCombined, Check, ChevronRight, CircleHelp, Eye, FileText, GraduationCap, House, LayoutDashboard, LockKeyhole, Menu, ShieldCheck, X } from "lucide-react";
import { Emblem } from "@/components/brand";

const mainNav = [
  { href: "/", title: "Обзор платформы", icon: LayoutDashboard },
  { href: "/testing", title: "Пройти тестирование", icon: GraduationCap },
  { href: "/questions", title: "Банк вопросов", icon: BookOpen },
  { href: "/results", title: "Мои результаты", icon: ChartNoAxesCombined },
];
const infoNav = [
  { href: "/documents", title: "Реестр документов", icon: FileText },
  { href: "/help", title: "Помощь и поддержка", icon: CircleHelp },
];
export function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false), [accessible, setAccessible] = useState(false);
  useEffect(() => { setOpen(false); }, [pathname]);
  useEffect(() => { if (!open) return; const close = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); }; document.addEventListener("keydown", close); return () => document.removeEventListener("keydown", close); }, [open]);
  const active = pathname.startsWith("/test/") ? "/testing" : pathname.startsWith("/results/") ? "/results" : pathname;
  const title = [...mainNav, ...infoNav, { href: "/admin", title: "Администрирование" }].find((n) => n.href === active)?.title ?? "Тестирование экспертов";
  return <div className={`portal ${accessible ? "accessible-mode" : ""}`}>
    <a href="#main-content" className="skip-link">Перейти к содержимому</a>
    {open && <button className="sidebar-overlay" onClick={() => setOpen(false)} aria-label="Закрыть меню"/>}
    <aside className={`sidebar ${open ? "is-open" : ""}`} aria-label="Основная навигация">
      <Link href="/" className="brand" aria-label="КТПП — главная"><Emblem className="brand-emblem"/><span><strong>КТПП</strong><span className="brand-caption">Калининградская<br/>торгово-промышленная палата</span></span></Link>
      <div className="sidebar-body"><div className="sidebar-section-label">ПЛАТФОРМА ЭКСПЕРТА</div>
        <nav className="nav-list">{mainNav.map((item) => <Link key={item.href} href={item.href} className={`nav-item ${active === item.href ? "active" : ""}`} aria-current={active === item.href ? "page" : undefined}><item.icon size={19} strokeWidth={1.7}/><span>{item.title}</span>{active === item.href && <span className="nav-active-dot"/>}</Link>)}</nav>
        <div className="sidebar-section-label info-label">ИНФОРМАЦИЯ</div>
        <nav className="nav-list">{infoNav.map((item) => <Link key={item.href} href={item.href} className={`nav-item ${active === item.href ? "active" : ""}`} aria-current={active === item.href ? "page" : undefined}><item.icon size={19} strokeWidth={1.7}/><span>{item.title}</span></Link>)}</nav>
      </div>
      <div className="sidebar-bottom"><div className="trust-card"><span className="trust-icon"><ShieldCheck size={23} strokeWidth={1.6}/></span><strong>Единый стандарт.<br/>Надёжный результат.</strong><p>Профессиональные знания<br/>для профессиональных решений.</p><span className="trust-divider"/><div><span className="status-dot"/>Данные хранятся на сервере</div></div><Link className={`admin-link ${active === "/admin" ? "active" : ""}`} href="/admin"><LockKeyhole size={16}/>Администратору<ArrowUpRight size={15}/></Link><div className="sidebar-copyright">© {new Date().getFullYear()} Калининградская ТПП</div></div>
    </aside>
    <div className="main-area"><header className="topbar"><div className="topbar-left"><button className="icon-button mobile-menu" onClick={() => setOpen(!open)} aria-label={open ? "Закрыть меню" : "Открыть меню"} aria-expanded={open}>{open ? <X size={23}/> : <Menu size={23}/>}</button><div><span className="topbar-eyebrow">ЦИФРОВЫЕ СЕРВИСЫ</span><p>Портал профессионального тестирования</p></div></div><div className="topbar-actions"><span className="online-status"><span className="status-dot"/>Платформа работает</span><span className="topbar-separator"/><button className={`icon-button accessibility-button ${accessible ? "selected" : ""}`} onClick={() => setAccessible(!accessible)} aria-label="Версия с увеличенным шрифтом" aria-pressed={accessible} title="Увеличить шрифт"><Eye size={20}/>{accessible && <Check size={12}/>}</button><Link href="/help" className="icon-button" aria-label="Помощь" title="Помощь"><CircleHelp size={20}/></Link><span className="language-tag">РУС</span></div></header>
      <main id="main-content" className="main-content"><div className="breadcrumbs"><Link href="/" aria-label="Главная"><House size={14}/></Link><ChevronRight size={12}/><span>Цифровые сервисы</span><ChevronRight size={12}/><span className="breadcrumb-current">{pathname === "/" ? "Тестирование экспертов" : title}</span></div><div className="page-enter" key={pathname}>{children}</div></main>
      <footer className="footer"><span>КТПП · Система «Экспертиза»</span><div><span className="footer-location">Калининград, Россия</span><Link href="/documents?document=privacy">Обработка данных</Link><Link href="/admin">Администратору</Link><Link href="/help">Обратная связь<ArrowUpRight size={12}/></Link></div></footer>
    </div>
  </div>;
}

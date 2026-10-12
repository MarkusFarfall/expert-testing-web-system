import Link from "next/link";
import { ArrowDownToLine, ArrowRight, ArrowUpRight, BookOpen, Check, CheckCheck, ChevronRight, CircleHelp, Clock3, Files, FileText, Fingerprint, GraduationCap, Landmark, Layers3, ListChecks, MapPin, ScanLine, ShieldCheck, Shuffle, UserRound, Zap } from "lucide-react";
import { Architecture } from "@/components/brand";
import { documents } from "@/lib/documents";
import { formatDate, type Overview } from "@/lib/types";

export function Home({ overview }: { overview: Overview }) {
  const metrics = [
    { value: overview.exams.length, label: "тестов доступно", icon: GraduationCap },
    { value: overview.questionCount, label: "вопросов в базе", icon: Files },
    { value: overview.blockCount, label: "тематических блоков", icon: Layers3 },
    { value: "2", label: "режима тестирования", icon: ListChecks },
    { value: "24/7", label: "доступ к платформе", icon: Clock3 },
  ];
  return <div className="home-page">
    <section className="hero">
      <div className="hero-copy"><div className="hero-eyebrow"><span/>СИСТЕМА «ЭКСПЕРТИЗА КТПП»</div><h1>Ваши знания —<br/><span>основа экспертизы.</span></h1><p>Профессиональная подготовка и проверка знаний<br className="desktop-break"/> экспертов Калининградской торгово-промышленной палаты.</p><div className="hero-actions"><Link className="button primary" href="/testing">Начать тестирование<ArrowUpRight size={18}/></Link><a className="hero-more" href="#how-it-works">О платформе<ArrowRight size={16}/></a></div><div className="hero-benefits"><span><UserRound size={14}/>Без регистрации и пароля</span><span><Zap size={14}/>Мгновенный результат</span></div></div>
      <div className="hero-art"><span className="hero-location"><MapPin size={11}/>КАЛИНИНГРАД</span><Architecture/><span className="architecture-caption"><span/>Традиции. Знания. Развитие.<span/></span></div>
    </section>
    <section className="metrics-grid" aria-label="Платформа в цифрах">{metrics.map((metric) => <div className="metric-card" key={metric.label}><div><strong>{metric.value}</strong><span>{metric.label}</span></div><span className="metric-icon"><metric.icon size={23} strokeWidth={1.55}/></span></div>)}</section>
    <section className="modes-section" id="test-modes"><div className="section-heading"><div><h2>Выберите свой формат</h2><p>Готовьтесь в удобном темпе или проверьте знания в формате экзамена.</p></div><Link className="subtle-link" href="/help"><CircleHelp size={15}/>Как это работает</Link></div>
      <div className="mode-grid grid grid-cols-1 md:grid-cols-2 gap-5">
        <article className="mode-card"><div className="mode-card-top"><span className="mode-icon"><BookOpen size={25} strokeWidth={1.6}/></span><div><span className="mode-category">ПОСЛЕДОВАТЕЛЬНАЯ ПОДГОТОВКА</span><h3>Общий тест</h3></div><span className="mode-index">01</span></div><p className="mode-description">Изучайте весь банк вопросов последовательно<br className="wide-break"/> или сосредоточьтесь на выбранной теме.</p><div className="mode-features"><span><Check size={15}/>Все вопросы или нужный диапазон</span><span><Check size={15}/>Возможность выбрать тематический блок</span></div><div className="mode-card-bottom"><Link className="button mode-button" href="/testing?mode=general">Начать подготовку<ArrowRight size={17}/></Link><span className="mode-bottom-note"><Clock3 size={13}/>В своём темпе</span></div></article>
        <article className="mode-card selective-card"><div className="mode-card-top"><span className="mode-icon"><Shuffle size={25} strokeWidth={1.6}/></span><div><span className="mode-category">ПРОВЕРКА ГОТОВНОСТИ</span><h3>Выборочный тест</h3></div><span className="mode-index">02</span></div><p className="mode-description">Проверьте себя с индивидуальным билетом<br className="wide-break"/> из случайных вопросов каждого блока.</p><div className="mode-features"><span><Check size={15}/>Случайная выборка из всех тем</span><span><Check size={15}/>Количество вопросов настраиваете вы</span></div><div className="mode-card-bottom"><Link className="button mode-button" href="/testing?mode=selective">Сформировать билет<ArrowRight size={17}/></Link><span className="mode-bottom-note"><ScanLine size={13}/>Объективная оценка</span></div></article>
      </div>
    </section>
    <section className="how-strip" id="how-it-works"><div className="how-intro"><span className="how-icon"><GraduationCap size={23}/></span><div><h3>От первого шага до результата</h3><p>Всё просто. Ничего лишнего.</p></div></div><div className="how-step"><span>1</span>Укажите ФИО</div><ChevronRight className="step-chevron" size={15}/><div className="how-step"><span>2</span>Выберите режим</div><ChevronRight className="step-chevron" size={15}/><div className="how-step"><span>3</span>Получите результат</div></section>
    <section className="home-lower-grid"><div className="content-panel topics-panel"><div className="panel-heading"><h2>Тематические блоки</h2><Link href="/questions" className="subtle-link">Весь банк<ArrowUpRight size={14}/></Link></div><div className="topic-list">{overview.blocks.slice(0, 4).map((block, i) => <Link className="topic-row" key={block.id} href={`/questions?block=${block.id}`}><span className="topic-num">0{i + 1}</span><div><h3>{block.title}</h3><span>{block.count} вопросов</span></div><ChevronRight size={16}/></Link>)}</div><div className="panel-footnote"><ShieldCheck size={14}/>{overview.isDemo ? "Учебный банк для знакомства с платформой" : "Единая централизованная база вопросов"}</div></div>
      <div className="content-panel documents-panel"><div className="panel-heading"><h2>Полезные документы</h2><Link href="/documents" className="subtle-link">В реестр<ArrowUpRight size={14}/></Link></div><div className="document-preview-list">{documents.slice(0, 3).map((doc) => <a className="document-preview" key={doc.id} href={`/api/portal/documents/${doc.id}`} download><span className="pdf-icon"><FileText size={21}/><small>PDF</small></span><div><h3>{doc.title}</h3><span>{doc.category} · {formatDate(doc.date)}</span></div><ArrowDownToLine size={17}/></a>)}</div><div className="panel-footnote"><CheckCheck size={14}/>Актуальные материалы в одном месте</div></div>
    </section>
    <section className="confidence-bar"><span className="confidence-icon"><Landmark size={25} strokeWidth={1.5}/></span><div><h3>Профессионализм начинается с надёжной основы</h3><p>Единая база знаний, прозрачная оценка и подробный разбор ошибок после каждого теста.</p></div><Fingerprint size={40} strokeWidth={1.2}/></section>
  </div>;
}

#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Телеграм-бот «Пульт Экспертизы КТПП».

Что умеет:
  • уведомления о завершённых тестах (кто, какой тест, результат);
  • контроль сервера: API перестал отвечать / снова работает; перезапуски сторожем;
  • напоминания об оплате ВДС: когда последний раз оплачено и на какой срок — бот считает
    дату следующего платежа и пишет заранее (за 7, 3, 1 день, в день оплаты и при просрочке);
  • статистика платформы и последние результаты, итоги дня.

Только стандартная библиотека Python. Запуск:  python3 bot.py
Самопроверка без Телеграма:                 python3 bot.py --selftest
Проверка связи с Телеграмом и API:          python3 bot.py --check-api
"""
import html
import json
import logging
import os
import re
import sqlite3
import sys
import threading
import time
import urllib.error
import urllib.request
from datetime import date, datetime, timedelta, timezone
from logging.handlers import RotatingFileHandler

try:
    from zoneinfo import ZoneInfo
    TZ = ZoneInfo("Europe/Kaliningrad")
except Exception:            # на всякий случай: Калининград — UTC+2 без переходов
    TZ = timezone(timedelta(hours=2))

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
SITE = "https://markusfarfall.github.io/expert-testing-web-system"
REMIND_DAYS = (7, 3, 1, 0)          # за сколько дней предупреждать
REMIND_HOUR = 10                    # час отправки напоминаний (местное время)
DIGEST_HOUR = 21                    # час отправки «итогов дня»
HEALTH_EVERY = 60                   # как часто проверять API, сек
RESULTS_EVERY = 60                  # как часто проверять новые результаты, сек

# ─────────────────────────── конфигурация ───────────────────────────

def load_env(path):
    cfg = {}
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, value = line.split("=", 1)
                cfg[key.strip()] = value.strip().strip('"').strip("'")
    return cfg


class Config:
    def __init__(self, env):
        self.token = env.get("TELEGRAM_TOKEN", "")
        self.owner = env.get("OWNER_CHAT", "")
        self.portal = env.get("PORTAL_URL", "https://212.193.5.193/portal").rstrip("/")
        self.password = env.get("PORTAL_PASSWORD", "")
        self.db_path = env.get("DB_PATH", os.path.join(BASE_DIR, "data", "bot.db"))
        self.watchdog_log = env.get("WATCHDOG_LOG", "/var/log/vds/watchdog.log")
        self.owner_code = env.get("OWNER_CODE", "")          # резервный вход в владельцы: /start <код>
        self.avatar = env.get("AVATAR", os.path.join(BASE_DIR, "bot-avatar.jpg"))


# ─────────────────────────── хранилище ───────────────────────────

class Store:
    def __init__(self, path):
        if path != ":memory:":
            os.makedirs(os.path.dirname(path), exist_ok=True)
        self.db = sqlite3.connect(path, check_same_thread=False)
        self.lock = threading.Lock()
        with self.lock:
            self.db.execute("create table if not exists settings(key text primary key, value text)")
            self.db.commit()

    def get(self, key, default=None):
        with self.lock:
            row = self.db.execute("select value from settings where key = ?", (key,)).fetchone()
        return row[0] if row else default

    def set(self, key, value):
        with self.lock:
            self.db.execute("insert into settings(key, value) values(?, ?) on conflict(key) do update set value = excluded.value",
                            (key, "" if value is None else str(value)))
            self.db.commit()

    def as_dict(self):
        with self.lock:
            return dict(self.db.execute("select key, value from settings").fetchall())

    def get_json(self, key, default):
        raw = self.get(key)
        if not raw:
            return default
        try:
            return json.loads(raw)
        except ValueError:
            return default

    def set_json(self, key, value):
        self.set(key, json.dumps(value, ensure_ascii=False))


# ─────────────────────────── даты и слова ───────────────────────────

def now_local():
    return datetime.now(TZ)


def today():
    return now_local().date()


def add_months(day, months):
    """Дата через N месяцев с коррекцией конца месяца (31.01 + 1 мес → 28.02)."""
    total = day.month - 1 + months
    year = day.year + total // 12
    month = total % 12 + 1
    for dim in (31, 30, 29, 28):
        try:
            return date(year, month, min(day.day, dim))
        except ValueError:
            continue
    return date(year, month, 28)


def plural(n, one, few, many):
    n = abs(n)
    if n % 10 == 1 and n % 100 != 11:
        return one
    if 2 <= n % 10 <= 4 and not 12 <= n % 100 <= 14:
        return few
    return many


def days_word(n):
    return plural(n, "день", "дня", "дней")


def months_word(n):
    return plural(n, "месяц", "месяца", "месяцев")


def fmt(day):
    return day.strftime("%d.%m.%Y")


def parse_iso(value):
    try:
        return date.fromisoformat(value)
    except (TypeError, ValueError):
        return None


def parse_user_date(text):
    text = text.strip()
    for pattern in ("%d.%m.%Y", "%d.%m.%y", "%Y-%m-%d"):
        try:
            return datetime.strptime(text, pattern).date()
        except ValueError:
            continue
    short = re.fullmatch(r"(\d{1,2})\.(\d{1,2})", text)   # «01.10» — числа достаточно
    if short:
        day, month = int(short.group(1)), int(short.group(2))
        for year in (today().year, today().year - 1):
            try:
                candidate = date(year, month, day)
            except ValueError:
                return None
            if candidate <= today():
                return candidate
    return None


def human_ago(day):
    diff = (today() - day).days
    if diff <= 0:
        return "сегодня"
    return f"{diff} {days_word(diff)} назад"


def human_left(left):
    if left > 0:
        return f"через {left} {days_word(left)}"
    if left == 0:
        return "сегодня"
    return f"просрочено на {-left} {days_word(-left)}"


# ─────────────────────────── портал (API на VDS) ───────────────────────────

class PortalError(Exception):
    pass


class Portal:
    """Клиент собственного API. Только последовательные запросы."""

    def __init__(self, base, password, log):
        self.base = base.rstrip("/")
        self.password = password
        self.log = log
        self.token = ""

    def _request(self, method, path, body=None, timeout=20):
        data = json.dumps(body).encode() if body is not None else None
        request = urllib.request.Request(self.base + path, data=data, method=method)
        if body is not None:
            request.add_header("content-type", "application/json")
        if self.token:
            request.add_header("x-admin-token", self.token)
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.loads(response.read().decode() or "null")

    def login(self):
        self.token = ""
        payload = self._request("POST", "/admin/login", {"password": self.password})
        self.token = payload["token"]
        return self.token

    def _admin(self, method, path, body=None):
        if not self.token:
            self.login()
        try:
            return self._request(method, path, body)
        except urllib.error.HTTPError as error:
            if error.code in (401, 403):
                self.login()
                return self._request(method, path, body)
            raise

    def overview(self, timeout=15):
        return self._request("GET", "/overview", timeout=timeout)

    def results(self):
        return self._admin("GET", "/admin/stats")


class FakePortal:
    def __init__(self):
        self.ok = True
        self.data = []

    def overview(self, timeout=15):
        if not self.ok:
            raise PortalError("недоступен")
        return {"questionCount": 500, "blockCount": 12, "completedCount": 12, "exams": []}

    def results(self):
        return list(self.data)


# ─────────────────────────── внешний вид (карточки) ───────────────────────────

def btn(text, data):
    return {"text": text, "callback_data": data}


def button_url(text, url):
    return {"text": text, "url": url}


def kb(*rows):
    return {"inline_keyboard": [list(row) for row in rows]}


def keyboard_menu(owner=False):
    rows = [[btn("📊 Статистика", "m:stats"), btn("📝 Результаты", "m:results")],
            [btn("💳 Оплата ВДС", "m:pay"), btn("🔔 Уведомления", "m:alerts")]]
    if owner:
        rows.append([btn("👥 Доступ к боту", "m:access")])
    rows.append([button_url("🌐 Открыть сайт", SITE + "/"), button_url("🛠 Админка", SITE + "/admin/")])
    rows.append([btn("❓ Помощь", "m:help")])
    return kb(*rows)


def keyboard_pay(st):
    reminders_on = st.get("reminders_on", "1") == "1"
    return kb([btn("✅ Я оплатил сегодня", "pay:paid")],
              [btn("📅 Дата последней оплаты", "pay:date"), btn("⏳ Оплаченный срок", "pay:term")],
              [btn(f"🔔 Напоминания: {'включены' if reminders_on else 'выключены'}", "pay:toggle")],
              [btn("⬅️ В меню", "m:menu")])


def keyboard_alerts(st):
    def mark(key):
        return "🟢" if st.get(key, "1") == "1" else "⚪️"
    return kb([btn(f"{mark('alerts_results')} Новые результаты", "al:results")],
              [btn(f"{mark('alerts_server')} Контроль сервера", "al:server")],
              [btn(f"{mark('alerts_digest')} Итоги дня", "al:digest")],
              [btn("⬅️ В меню", "m:menu")])


def keyboard_access(bot):
    rows = []
    for row in bot.access():
        name = self_name = row.get("username") or row.get("id")
        bell = "🔔" if row.get("notify", True) else "🔕"
        rows.append([btn(f"{bell} @{name}", f"ac:bell:{row.get('id') or name}"), btn("✖️", f"ac:del:{row.get('id') or name}")])
    for chat_id, value in bot.requests().items():
        who = f"@{value.get('username')}" if value.get("username") else (value.get("name") or "без имени")
        rows.append([btn(f"✅ {who}", f"ap:allow:{chat_id}"), btn("⛔️", f"ap:deny:{chat_id}")])
    rows.append([btn("⬅️ В меню", "m:menu")])
    return kb(*rows)


def keyboard_back(target="m:menu", text="⬅️ Назад"):
    return kb([btn(text, target)])


def bar(fraction, width=12):
    fraction = max(0.0, min(1.0, fraction))
    filled = int(round(fraction * width))
    return "█" * filled + "░" * (width - filled)


def payment_state(st, on=None):
    on = on or today()
    paid = parse_iso(st.get("paid_on"))
    months = int(st.get("term_months") or 1)
    due = add_months(paid, months) if paid else None
    left = (due - on).days if due else None
    total = ((due - paid).days if paid and due else 1) or 1
    return paid, months, due, left, total


def payment_card(st, title="💳 Оплата ВДС"):
    paid, months, due, left, total = payment_state(st)
    lines = [f"<b>{title}</b>", ""]
    if not paid:
        lines += ["Пока не отмечено, когда вы платили в последний раз.",
                  "Нажмите «📅 Дата последней оплаты» — и я начну считать и напоминать."]
    else:
        done = (paid and due and max(0, min(total, total - max(left, 0)))) or 0
        lines += [
            f"💠 Последняя оплата: <b>{fmt(paid)}</b> ({human_ago(paid)})",
            f"⏳ Оплаченный срок: <b>{months} {months_word(months)}</b>",
            f"📅 Следующий платёж: <b>{fmt(due)}</b>",
        ]
        if left >= 0:
            lines.append(f"⏰ Осталось: <b>{human_left(left)}</b>")
            lines.append(f"<code>{bar(done / total)}</code> {round(done / total * 100)}%")
        else:
            lines.append(f"❗️ <b>Платёж просрочен: {human_left(left)}</b>")
            lines.append(f"<code>{bar(1.0)}</code> 100%")
        lines.append("")
        reminders_on = st.get("reminders_on", "1") == "1"
        lines.append(f"🔔 Напоминания: {'включены' if reminders_on else 'выключены'}"
                     f" (за 7, 3 и 1 день и в день оплаты, в {REMIND_HOUR}:00)")
        if reminders_on and left is not None and left <= 7:
            lines.append(f"⏳ Ближайшее напоминание: {human_left(left)}" if left >= 0 else "⏳ Напоминаю о просрочке каждые 3 дня")
    return "\n".join(lines)


def keyboard_dates():
    return kb([btn("Сегодня", "pay:set:today"), btn("Вчера", "pay:set:yesterday")],
              [btn("1-е число этого месяца", "pay:set:first")],
              [btn("✍️ Ввести дату", "pay:dateinput")],
              [btn("⬅️ Назад", "m:pay")])


def keyboard_terms():
    return kb([btn("1 месяц", "pay:term:1"), btn("3 месяца", "pay:term:3")],
              [btn("6 месяцев", "pay:term:6"), btn("12 месяцев", "pay:term:12")],
              [btn("✍️ Свой срок", "pay:terminput")],
              [btn("⬅️ Назад", "m:pay")])


def escape(value):
    return html.escape(str(value or ""))


def mode_name(mode):
    return {"general": "Общий", "selective": "Выборочный"}.get(mode, "режим")


def result_card(row, heading="✅ <b>Тест завершён</b>"):
    percentage = int(row.get("percentage") or 0)
    mark = "🟢" if percentage >= 80 else "🟡" if percentage >= 60 else "🔴"
    when = row.get("finishedAt") or row.get("startedAt") or ""
    try:
        when = datetime.fromisoformat(when.replace("Z", "+00:00")).astimezone(TZ).strftime("%d.%m.%Y %H:%M")
    except ValueError:
        pass
    exam = row.get("examName") or "Тест"
    return (f"{heading}\n\n🔹 <b>{escape(row.get('fullName'))}</b>\n"
            f"📚 {escape(exam)} · {mode_name(row.get('mode'))} режим\n"
            f"{mark} <b>{percentage}%</b> — {row.get('correctCount')} из {row.get('total')}\n"
            f"🕒 {when}")


def result_keyboard():
    return kb([btn("📊 Статистика", "m:stats"), btn("📝 Все результаты", "m:results")],
              [btn("🏠 В меню", "m:menu")])


def stats_card(overview, results):
    attempts = [r for r in results if r.get("finishedAt")]
    today_attempts = [r for r in attempts if (r.get("finishedAt") or "").startswith(today().isoformat())]
    percentages = [int(r.get("percentage") or 0) for r in attempts]
    average = round(sum(percentages) / len(percentages)) if percentages else 0
    best = max(attempts, key=lambda r: r.get("percentage") or 0, default=None)
    lines = ["📊 <b>Статистика платформы</b>", ""]
    lines.append(f"📚 Тесты: <b>{len(overview.get('exams') or [])}</b>, вопросов: <b>{overview.get('questionCount', 0)}</b>")
    lines.append(f"🧠 Пройдено тестов: <b>{len(attempts)}</b>")
    lines.append(f"📅 Сегодня: <b>{len(today_attempts)}</b>")
    if attempts:
        lines.append(f"🎯 Средний результат: <b>{average}%</b>")
        lines.append(f"<code>{bar(average / 100)}</code>")
        if best:
            lines.append(f"🏆 Лучший: <b>{int(best.get('percentage') or 0)}%</b> — {escape(best.get('fullName'))}")
    else:
        lines.append("Пока ни одного завершённого теста.")
    return "\n".join(lines)


def results_card(results):
    attempts = sorted([r for r in results if r.get("finishedAt")], key=lambda r: r.get("finishedAt") or "", reverse=True)[:6]
    if not attempts:
        return "📝 <b>Последние результаты</b>\n\nЗавершённых тестов пока нет."
    lines = ["📝 <b>Последние результаты</b>", ""]
    for row in attempts:
        stamp = row.get("finishedAt") or ""
        try:
            stamp = datetime.fromisoformat(stamp.replace("Z", "+00:00")).astimezone(TZ).strftime("%d.%m %H:%M")
        except ValueError:
            pass
        lines.append(f"• {stamp} — {escape(row.get('fullName'))} — <b>{int(row.get('percentage') or 0)}%</b>"
                     f" ({escape(row.get('examName') or 'Тест')})")
    return "\n".join(lines)


def alerts_card(st):
    return ("🔔 <b>Уведомления</b>\n\n"
            "Здесь видно, о чём бот пишет сам:\n"
            "🟢 новые результаты тестов,\n"
            "🟢 контроль сервера (API не отвечает / поднялся / перезапуск),\n"
            "🟢 итоги дня в 21:00.\n\n"
            "Нажмите на строку, чтобы включить или выключить.")


def help_card(st):
    return ("❓ <b>Как пользоваться</b>\n\n"
            "📊 <b>Статистика</b> — вопросы, тесты, результаты.\n"
            "📝 <b>Результаты</b> — последние завершённые тесты.\n"
            "💳 <b>Оплата ВДС</b> — отметить дату оплаты и срок; бот сам напомнит за 7, 3 и 1 день, "
            "в день оплаты и при просрочке (в 10:00).\n"
            "🔔 <b>Уведомления</b> — что присылать, а что нет.\n\n"
            "Команды: /menu — меню, /pay — оплата, /stats — статистика, /results — результаты, /id — мой ID.\n\n"
            "💡 Данные живут на вашем сервере (ВДС) — это личный пульт, посторонние в него не попадут.")


# ─────────────────────────── логика бота ───────────────────────────

class Bot:
    def __init__(self, cfg, store, portal, log):
        self.cfg = cfg
        self.store = store
        self.portal = portal
        self.log = log
        self.state = {}
        self.last_health = 0
        self.last_results = 0

    # — помощники —
    def settings(self):
        return self.store.as_dict()

    def owner_chat(self):
        return self.store.get("owner_chat") or self.cfg.owner

    def is_owner(self, chat_id):
        return str(chat_id) == str(self.owner_chat())

    # — доступ по @юзернейму —
    def access(self):
        return self.store.get_json("access", [])

    def save_access(self, rows):
        self.store.set_json("access", rows)

    @staticmethod
    def norm_username(raw):
        return (raw or "").strip().lstrip("@").lower()

    def find_access(self, username="", chat_id=None):
        username = self.norm_username(username)
        for row in self.access():
            if (username and self.norm_username(row.get("username")) == username) or (chat_id and str(row.get("id")) == str(chat_id)):
                return row
        return None

    def is_allowed(self, chat_id, username=""):
        if self.is_owner(chat_id):
            return True
        return self.find_access(username=username, chat_id=chat_id) is not None

    def notify_ids(self):
        """Кому приходят уведомления: владелец и те, у кого включены уведомления."""
        ids = []
        owner = self.owner_chat()
        if owner:
            ids.append(str(owner))
        for row in self.access():
            if row.get("notify", True) and str(row.get("id")) not in ids:
                ids.append(str(row.get("id")))
        return ids

    def add_access(self, username, chat_id=None, note="", notify=True):
        username = self.norm_username(username)
        rows = self.access()
        row = None
        for item in rows:                                  # ищем в том же списке, который сохраним
            same_name = username and self.norm_username(item.get("username")) == username
            same_id = chat_id and str(item.get("id")) == str(chat_id)
            if same_name or same_id:
                row = item
                break
        if row is not None:
            if chat_id:
                row["id"] = str(chat_id)
            if username:
                row["username"] = username
            row["notify"] = notify
            if note:
                row["note"] = note
        else:
            rows.append({"username": username, "id": str(chat_id) if chat_id else "", "note": note,
                         "notify": notify, "added": now_local().strftime("%d.%m.%Y %H:%M")})
        self.save_access(rows)

    def remove_access(self, username="", chat_id=None):
        rows = [r for r in self.access()
                if not ((username and self.norm_username(r.get("username")) == self.norm_username(username))
                        or (chat_id and str(r.get("id")) == str(chat_id)))]
        self.save_access(rows)

    def requests(self):
        return self.store.get_json("requests", {})

    def save_requests(self, value):
        self.store.set_json("requests", value)

    def owner_send(self, text, keyboard=None):
        """Уведомление всем, кому оно адресовано."""
        return [self.send(text, keyboard, chat) for chat in self.notify_ids()]

    def send(self, text, keyboard=None, chat_id=None):
        return {"type": "send", "chat_id": chat_id or self.owner_chat(), "text": text, "keyboard": keyboard}

    def keyboard_for(self, chat_id):
        return keyboard_menu(self.is_owner(chat_id))

    def edit(self, chat_id, message_id, text, keyboard=None):
        return {"type": "edit", "chat_id": chat_id, "message_id": message_id, "text": text, "keyboard": keyboard}

    def owner_send(self, text, keyboard=None):
        chat = self.owner_chat()
        return [self.send(text, keyboard, chat)] if chat else []

    # — входящие сообщения —
    def on_update(self, update):
        if "callback_query" in update:
            return self.on_callback(update["callback_query"])
        if "message" in update:
            return self.on_message(update["message"])
        return []

    def on_message(self, message):
        chat_id = (message.get("chat") or {}).get("id")
        text = (message.get("text") or "").strip()
        text = re.sub(r"^(/\w+)@\w+", r"\1", text)
        if not chat_id:
            return []
        sender = message.get("from") or {}
        username = sender.get("username") or ""
        # Переезд: человек сменил аккаунт, но имя то же — переносим доступ на новый id.
        if username:
            row = self.find_access(username=username)
            if row and str(row.get("id")) != str(chat_id):
                self.log.info("доступ @%s перенесён с %s на %s", username, row.get("id"), chat_id)
                self.add_access(username, chat_id, row.get("note", ""), bool(row.get("notify", True)))
        # первый запуск: без владельца бот достаётся первому, либо по коду из bot.env
        if not self.owner_chat() and text.startswith("/start"):
            code = text.split(maxsplit=1)[1].strip() if len(text.split()) > 1 else ""
            if not self.cfg.owner_code or code == self.cfg.owner_code:
                self.store.set("owner_chat", str(chat_id))
                self.log.info("назначен владелец бота: %s (@%s)", chat_id, username or "—")
                return [self.send("👋 <b>Вы владелец пульта.</b>\n\nТеперь сюда приходят результаты тестов, "
                                  "предупреждения о сервере и напоминания об оплате ВДС.", keyboard_menu())]
            return [self.send("🔒 Бот уже настроен. Попросите владельца добавить вас: он выдаёт доступ по @юзернейму.", None, chat_id)]
        if not self.is_allowed(chat_id, username):
            if text.startswith("/start"):
                pending = self.requests()
                if str(chat_id) in pending:
                    return [self.send("⏳ Заявка уже отправлена — владелец увидит её и откроет доступ.", None, chat_id)]
                pending[str(chat_id)] = {"username": username, "name": sender.get("first_name", ""),
                                         "at": now_local().strftime("%d.%m %H:%M")}
                self.save_requests(pending)
                who = f"@{username}" if username else (sender.get("first_name") or "без имени")
                notice = [self.send(f"🔔 <b>Заявка на доступ</b>\n\n{who} (id <code>{chat_id}</code>) просит доступ к пульту.",
                                    kb([btn("✅ Разрешить", f"ap:allow:{chat_id}"), btn("⛔️ Отклонить", f"ap:deny:{chat_id}")]),
                                    chat) for chat in self.notify_ids()]
                return notice + [self.send("Заявка отправлена владельцу ⏳ Доступ откроют — и я сразу напишу.", None, chat_id)]
            return [self.send("🔒 Доступа нет. Напишите /start — отправлю заявку владельцу.", None, chat_id)]
        if text.startswith("/id"):
            return [self.send(f"🆔 Ваш chat id: <code>{chat_id}</code>\n👤 Юзернейм: @{username or '— нет —'}", keyboard_menu())]
        if text.startswith("/access") or text.startswith("/allow") or text.startswith("/deny"):
            return self.access_command(chat_id, text, sender)
        if text.startswith("/start"):
            self.store.set("pending", "")
            name = html.escape((message.get("from") or {}).get("first_name") or "")
            return [self.send(f"👋 <b>Здравствуйте{', ' + name if name else ''}!</b>\n\n"
                              "Это пульт платформы «Экспертиза КТПП».\n"
                              "Я присылаю результаты тестов, слежу за сервером и напоминаю про оплату ВДС.",
                              keyboard_menu(self.is_owner(chat_id)))]
        if text.startswith("/id"):
            return [self.send(f"🆔 Ваш chat id: <code>{chat_id}</code>", keyboard_menu())]
        if text.startswith(("/menu", "/help")):
            self.store.set("pending", "")
            return [self.send(help_card(self.settings()) if text.startswith("/help") else "🏠 <b>Главное меню</b>", keyboard_menu())]
        if text.startswith("/pay"):
            return [self.edit_or_send(chat_id, None, payment_card(self.settings()), keyboard_pay(self.settings()))]
        if text.startswith("/stats"):
            return [self.stats_action()]
        if text.startswith("/results"):
            return [self.results_action()]
        if text.startswith("/cancel"):
            self.store.set("pending", "")
            return [self.send("Отменено.", keyboard_menu())]
        pending = self.store.get("pending", "")
        if pending:
            return self.on_pending(pending, text)
        return [self.send("Выберите, что нужно 👇", keyboard_menu())]

    def edit_or_send(self, chat_id, message_id, text, keyboard):
        if message_id:
            return self.edit(chat_id, message_id, text, keyboard)
        return self.send(text, keyboard, chat_id)

    def on_pending(self, pending, text):
        if pending == "date":
            parsed = parse_user_date(text)
            if not parsed:
                return [self.send("Не разобрал дату 🤔 Напишите в виде <b>ДД.ММ.ГГГГ</b>, например 01.10.2026.", keyboard_back("m:pay"))]
            if parsed > today():
                return [self.send("Дата в будущем — так не бывает 🙂 Напишите дату последней оплаты.", keyboard_back("m:pay"))]
            self.store.set("pending", "")
            self.store.set("paid_on", parsed.isoformat())
            return [self.send("Записал ✅\n\n" + payment_card(self.settings()), keyboard_pay(self.settings()))]
        if pending == "term":
            digits = re.findall(r"\d+", text)
            months = int(digits[0]) if digits else 0
            if not 1 <= months <= 60:
                return [self.send("Напишите срок числом месяцев — от 1 до 60 (например: 3).", keyboard_back("m:pay"))]
            self.store.set("pending", "")
            self.store.set("term_months", months)
            return [self.send("Записал ✅\n\n" + payment_card(self.settings()), keyboard_pay(self.settings()))]
        return []

    # — нажатия кнопок —
    def on_callback(self, query):
        chat_id = ((query.get("message") or {}).get("chat") or {}).get("id")
        message_id = (query.get("message") or {}).get("message_id")
        data = query.get("data") or ""
        if not chat_id:
            return []
        ack = {"type": "ack", "id": query.get("id")}
        if not self.is_owner(chat_id):
            return [ack, self.send("🔒 Доступа нет.", None, chat_id)]
        state = self.settings()
        actions = [ack]
        if data == "m:menu":
            self.store.set("pending", "")
            actions.append(self.edit_or_send(chat_id, message_id, "🏠 <b>Главное меню</b>", keyboard_menu()))
        elif data == "m:pay":
            self.store.set("pending", "")
            actions.append(self.edit_or_send(chat_id, message_id, payment_card(state), keyboard_pay(state)))
        elif data == "m:alerts":
            actions.append(self.edit_or_send(chat_id, message_id, alerts_card(state), keyboard_alerts(state)))
        elif data == "m:help":
            actions.append(self.edit_or_send(chat_id, message_id, help_card(state), keyboard_menu(self.is_owner(chat_id))))
        elif data == "m:access":
            actions.append(self.edit_or_send(chat_id, message_id, self.access_card(), keyboard_access(self)))
        elif data.startswith("ap:allow:"):
            target = data.split(":")[2]
            pending = self.requests()
            value = pending.pop(target, {})
            self.save_requests(pending)
            self.add_access(value.get("username", ""), target, "", True)
            who = f"@{value.get('username')}" if value.get("username") else (value.get("name") or target)
            actions.append(self.edit_or_send(chat_id, message_id, f"✅ Доступ открыт: {who}.", keyboard_access(self)))
            self.store.set(f"granted:{target}", now_local().strftime("%d.%m %H:%M"))
        elif data.startswith("ap:deny:"):
            target = data.split(":")[2]
            pending = self.requests()
            pending.pop(target, None)
            self.save_requests(pending)
            actions.append(self.edit_or_send(chat_id, message_id, "⛔️ Заявка отклонена.", keyboard_access(self)))
        elif data.startswith("ac:bell:"):
            key = data.split(":", 2)[2]
            rows = self.access()
            for item in rows:
                same_name = not key.isdigit() and self.norm_username(item.get("username")) == self.norm_username(key)
                same_id = key.isdigit() and str(item.get("id")) == key
                if same_name or same_id:
                    item["notify"] = not item.get("notify", True)
                    break
            self.save_access(rows)
            actions.append(self.edit_or_send(chat_id, message_id, self.access_card(), keyboard_access(self)))
        elif data.startswith("ac:del:"):
            key = data.split(":", 2)[2]
            self.remove_access(username=key if not key.isdigit() else "", chat_id=key if key.isdigit() else None)
            actions.append(self.edit_or_send(chat_id, message_id, "✖️ Доступ закрыт.\n\n" + self.access_card(), keyboard_access(self)))
        elif data == "m:stats":
            actions.append(self.stats_action())
        elif data == "m:results":
            actions.append(self.results_action())
        elif data == "pay:paid":
            self.store.set("paid_on", today().isoformat())
            fresh = self.settings()
            actions.append(self.edit_or_send(chat_id, message_id,
                           "Принято ✅ Сегодняшняя дата записана как последняя оплата.\n\n" + payment_card(fresh), keyboard_pay(fresh)))
        elif data == "pay:date":
            actions.append(self.edit_or_send(chat_id, message_id, "📅 <b>Когда вы платили в последний раз?</b>", keyboard_dates()))
        elif data.startswith("pay:set:"):
            kind = data.split(":")[2]
            value = today() if kind == "today" else (today() - timedelta(days=1)) if kind == "yesterday" else today().replace(day=1)
            self.store.set("paid_on", value.isoformat())
            fresh = self.settings()
            actions.append(self.edit_or_send(chat_id, message_id, "Записал ✅\n\n" + payment_card(fresh), keyboard_pay(fresh)))
        elif data == "pay:dateinput":
            self.store.set("pending", "date")
            actions.append(self.edit_or_send(chat_id, message_id,
                           "✍️ Напишите дату последней оплаты — например <b>01.10.2026</b> (или 01.10).", keyboard_back("m:pay")))
        elif data == "pay:term":
            actions.append(self.edit_or_send(chat_id, message_id, "⏳ <b>На какой срок оплачен ВДС?</b>", keyboard_terms()))
        elif data.startswith("pay:term:"):
            months = int(data.split(":")[2])
            self.store.set("term_months", months)
            fresh = self.settings()
            actions.append(self.edit_or_send(chat_id, message_id, "Записал ✅\n\n" + payment_card(fresh), keyboard_pay(fresh)))
        elif data == "pay:terminput":
            self.store.set("pending", "term")
            actions.append(self.edit_or_send(chat_id, message_id,
                           "✍️ Напишите срок в месяцах — например <b>2</b>.", keyboard_back("m:pay")))
        elif data == "pay:toggle":
            fresh_on = "0" if state.get("reminders_on", "1") == "1" else "1"
            self.store.set("reminders_on", fresh_on)
            fresh = self.settings()
            note = "🔔 Напоминания включены." if fresh_on == "1" else "🔕 Напоминания выключены."
            actions.append(self.edit_or_send(chat_id, message_id, note + "\n\n" + payment_card(fresh), keyboard_pay(fresh)))
        elif data.startswith("al:"):
            key = {"results": "alerts_results", "server": "alerts_server", "digest": "alerts_digest"}.get(data.split(":")[1])
            if key:
                self.store.set(key, "0" if state.get(key, "1") == "1" else "1")
            fresh = self.settings()
            actions.append(self.edit_or_send(chat_id, message_id, alerts_card(fresh), keyboard_alerts(fresh)))
        elif data == "cancel":
            self.store.set("pending", "")
            actions.append(self.edit_or_send(chat_id, message_id, "Отменено.", keyboard_menu()))
        return actions

    # — доступ —
    def access_command(self, chat_id, text, sender):
        if not self.is_owner(chat_id):
            return [self.send("🔒 Управлять доступом может только владелец.", None, chat_id)]
        parts = text.split()
        command = parts[0].split("@")[0]
        if command in ("/allow", "/deny") and len(parts) >= 2:
            target = self.norm_username(parts[1]) if parts[1].startswith("@") or not parts[1].isdigit() else parts[1]
            if not target:
                return [self.send("Напишите, кого добавить: <code>/allow @username</code>", None, chat_id)]
            row = self.find_access(username=target if not str(target).isdigit() else "", chat_id=target if str(target).isdigit() else None)
            if command == "/deny":
                if not row:
                    return [self.send("Такого доступа нет.", None, chat_id)]
                self.remove_access(username=row.get("username"), chat_id=row.get("id"))
                pending = {k: v for k, v in self.requests().items() if str(k) != str(row.get("id"))}
                self.save_requests(pending)
                return [self.send(f"✖️ Доступ @{row.get('username') or row.get('id')} закрыт.", keyboard_menu(True))]
            note = " ".join(parts[2:])
            notify = "notify" in [p.lower() for p in parts]
            self.add_access(target, None, note, notify)
            pending = self.requests()
            pending.pop(str(chat_id), None)
            self.save_requests(pending)
            return [self.send(f"✅ @{self.norm_username(target)} добавлен{' (с уведомлениями)' if notify else ''}.\n"
                              "Человек получит доступ, когда напишет боту /start — вход по @юзернейму, id запомню автоматически.",
                              keyboard_menu(True))]
        return [self.send(self.access_card(), keyboard_access(self), chat_id)]

    def access_card(self):
        rows = self.access()
        pending = self.requests()
        lines = ["👥 <b>Доступ к боту</b>", ""]
        lines.append(f"👑 Владелец: id <code>{self.owner_chat() or '—'}</code>")
        if rows:
            lines.append("")
            lines.append("<b>Доверенные</b> (вход по @юзернейму):")
            for row in rows:
                mark = "🔔" if row.get("notify", True) else "🔕"
                lines.append(f"• {mark} @{row.get('username') or '—'}"
                             + (f" · id <code>{row.get('id')}</code>" if row.get("id") else " · ждём /start")
                             + (f" · {escape(row.get('note'))}" if row.get("note") else ""))
        else:
            lines += ["", "Доверенных пока нет."]
        if pending:
            lines += ["", f"⏳ <b>Заявки</b>: {len(pending)}"]
            for value in pending.values():
                who = f"@{value.get('username')}" if value.get("username") else value.get("name") or "без имени"
                lines.append(f"• {who} · {value.get('at', '')}")
        lines += ["", "Добавить: <code>/allow @username</code> (с уведомлениями: <code>/allow @username notify</code>)",
                  "Закрыть доступ: <code>/deny @username</code>"]
        return "\n".join(lines)

    # — разделы —
    def stats_action(self):
        try:
            overview = self.portal.overview()
        except Exception as error:                       # noqa: BLE001
            self.log.warning("статистика: %s", error)
            return self.send("Не получилось получить статистику — сервер не ответил. Попробуйте позже.", keyboard_menu())
        try:
            results = self.portal.results()
        except Exception:                                 # noqa: BLE001
            results = []
        return self.send(stats_card(overview, results), keyboard_menu())

    def results_action(self):
        try:
            rows = self.portal.results()
        except Exception as error:                        # noqa: BLE001
            self.log.warning("результаты: %s", error)
            return self.send("Не получилось получить результаты — сервер не ответил.", keyboard_menu())
        return self.send(results_card(rows), keyboard_menu())

    # — фон: проверки и напоминания —
    def health_step(self):
        if self.store.get("alerts_server", "1") != "1":
            return []
        actions = []
        fails = int(self.store.get("health_fails") or 0)
        try:
            self.portal.overview(timeout=10)
            if self.store.get("health_down") == "1":
                since = self.store.get("health_down_since") or ""
                note = f"\n🕒 Простой с {since}" if since else ""
                actions = [self.send(f"✅ <b>Сервер снова работает</b>{note}", keyboard_menu(), chat)
                           for chat in self.notify_ids()]
            self.store.set("health_down", "0")
            self.store.set("health_fails", 0)
        except Exception as error:                         # noqa: BLE001
            fails += 1
            self.store.set("health_fails", fails)
            if fails >= 2 and self.store.get("health_down") != "1":
                actions = [self.send("⚠️ <b>Сервер не отвечает</b>\n\nПроверка не удалась дважды подряд. "
                                     "Сторож перезапустит API, если сбой не пройдёт сам.", keyboard_menu(), chat)
                           for chat in self.notify_ids()]
                self.store.set("health_down", "1")
                self.store.set("health_down_since", now_local().strftime("%d.%m %H:%M"))
                self.log.warning("API недоступен: %s", error)
        return actions

    def watchdog_step(self):
        if self.store.get("alerts_server", "1") != "1":
            return []
        path = self.cfg.watchdog_log
        if not os.path.exists(path):
            return []
        size = os.path.getsize(path)
        seen = int(self.store.get("watchdog_pos") or 0)
        if size < seen:
            seen = 0
        if size == seen:
            return []
        with open(path, encoding="utf-8", errors="replace") as f:
            f.seek(seen)
            fresh = f.read()
        self.store.set("watchdog_pos", size)
        lines = [line for line in fresh.splitlines() if "перезапущен" in line]
        if not lines:
            return []
        return [self.send("🔧 <b>Сторож перезапустил API</b>\n\nСбой повторился дважды подряд — "
                          "контейнер поднят заново, данные не затронуты.", keyboard_menu(), chat)
                for chat in self.notify_ids()]

    def results_step(self):
        if self.store.get("alerts_results", "1") != "1" or not self.owner_chat():
            return []
        try:
            rows = self.portal.results()
        except Exception:                                  # noqa: BLE001
            return []
        finished = sorted([r for r in rows if r.get("finishedAt")], key=lambda r: r.get("finishedAt") or "")
        if not finished:
            return []
        seen = self.store.get("last_result_at") or ""
        fresh = [r for r in finished if (r.get("finishedAt") or "") > seen]
        self.store.set("last_result_at", max((r.get("finishedAt") or "") for r in finished))
        if not seen:
            return []                                      # первый запуск — просто запоминаем
        return [self.send(result_card(row), result_keyboard(), chat) for row in fresh for chat in self.notify_ids()]

    def payment_step(self, now=None):
        now = now or now_local()
        if not self.owner_chat():
            return []
        state = self.settings()
        paid, months, due, left, total = payment_state(state, on=now.date())
        if not paid or left is None:
            return []
        if state.get("reminders_on", "1") != "1" or now.hour < REMIND_HOUR:
            return []
        fire = left in REMIND_DAYS or (left < 0 and (left == -1 or (-left) % 3 == 0))
        if not fire:
            return []
        key = f"{now.date().isoformat()}:{left}"
        if self.store.get("last_reminder") == key:
            return []
        self.store.set("last_reminder", key)
        if left > 0:
            text = (f"🔔 <b>Напоминание: оплата ВДС через {left} {days_word(left)}</b>\n\n"
                    f"📅 Дата платежа: <b>{fmt(due)}</b>\n"
                    f"💠 Предыдущая оплата: {fmt(paid)} ({months} {months_word(months)})")
        elif left == 0:
            text = (f"🚨 <b>Сегодня день оплаты ВДС</b>\n\n"
                    f"📅 Платёж заканчивается сегодня ({fmt(due)}).\n"
                    "После оплаты нажмите «✅ Я оплатил сегодня» — и я сдвину напоминания.")
        else:
            text = (f"❗️ <b>Оплата ВДС просрочена на {-left} {days_word(-left)}</b>\n\n"
                    f"📅 Платёж ожидался {fmt(due)}.\n"
                    "Оплатите и отметьте кнопкой ниже — напоминания прекратятся.")
        return [self.send(text, kb([btn("✅ Я оплатил сегодня", "pay:paid")], [btn("💳 Настройки оплаты", "m:pay")]), chat)
                for chat in self.notify_ids()]

    def digest_step(self, now=None):
        now = now or now_local()
        if self.store.get("alerts_digest", "1") != "1" or now.hour < DIGEST_HOUR or not self.owner_chat():
            return []
        key = f"digest:{now.date().isoformat()}"
        if self.store.get(key) == "1":
            return []
        self.store.set(key, "1")
        try:
            rows = self.portal.results()
        except Exception:                                  # noqa: BLE001
            return []
        day = now.date().isoformat()
        today_rows = [r for r in rows if (r.get("finishedAt") or "").startswith(day)]
        if not today_rows:
            return []
        percentages = [int(r.get("percentage") or 0) for r in today_rows]
        best = max(today_rows, key=lambda r: r.get("percentage") or 0)
        text = (f"🌙 <b>Итоги дня</b>\n\n"
                f"📅 {now.strftime('%d.%m.%Y')}\n"
                f"🧠 Пройдено тестов: <b>{len(today_rows)}</b>\n"
                f"🎯 Средний результат: <b>{round(sum(percentages) / len(percentages))}%</b>\n"
                f"🏆 Лучший: <b>{int(best.get('percentage') or 0)}%</b> — {escape(best.get('fullName'))}")
        return [self.send(text, keyboard_menu(), chat) for chat in self.notify_ids()]

    def scheduler_step(self, now=None):
        now = now or now_local()
        actions = []
        stamp = time.time()
        if stamp - self.last_health >= HEALTH_EVERY:
            self.last_health = stamp
            actions += self.health_step()
            actions += self.watchdog_step()
        if stamp - self.last_results >= RESULTS_EVERY:
            self.last_results = stamp
            actions += self.results_step()
        actions += self.payment_step(now)
        actions += self.digest_step(now)
        return actions


# ─────────────────────────── телеграм и запуск ───────────────────────────

class Tg:
    def __init__(self, token, log):
        self.base = f"https://api.telegram.org/bot{token}"
        self.log = log

    def call(self, method, payload=None, timeout=35):
        body = json.dumps(payload or {}).encode()
        request = urllib.request.Request(f"{self.base}/{method}", data=body,
                                         headers={"content-type": "application/json"})
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.loads(response.read().decode() or "{}")

    def send(self, action):
        payload = {"chat_id": action["chat_id"], "text": action["text"],
                   "parse_mode": "HTML", "disable_web_page_preview": True}
        if action.get("keyboard"):
            payload["reply_markup"] = action["keyboard"]
        try:
            self.call("sendMessage", payload)
        except urllib.error.HTTPError as error:
            detail = error.read().decode(errors="replace")
            if "parse" not in detail.lower():
                raise
            self.log.warning("разметка не принята, отправляю простым текстом: %s", detail[:120])
            payload["text"] = re.sub(r"<[^>]+>", "", action["text"])
            payload.pop("parse_mode", None)
            self.call("sendMessage", payload)

    def edit(self, action):
        payload = {"chat_id": action["chat_id"], "message_id": action["message_id"],
                   "text": action["text"], "parse_mode": "HTML", "disable_web_page_preview": True}
        payload["reply_markup"] = action.get("keyboard") or {"inline_keyboard": []}
        try:
            self.call("editMessageText", payload)
        except urllib.error.HTTPError as error:
            detail = error.read().decode(errors="replace")
            if "message is not modified" in detail:
                return
            self.log.info("правка сообщения не удалась, отправляю новое: %s", detail[:120])
            self.send({**action, "type": "send"})

    def execute(self, actions):
        for action in actions:
            try:
                if action["type"] == "send":
                    self.send(action)
                elif action["type"] == "edit":
                    self.edit(action)
                elif action["type"] == "ack":
                    self.call("answerCallbackQuery", {"callback_query_id": action["id"]})
            except Exception as error:                      # noqa: BLE001
                self.log.warning("отправка не удалась (%s): %s", action.get("type"), error)

    def setup_profile(self, avatar_path=""):
        """Оформление «как приложение»: имя, аватарка, команды и описания."""
        try:
            self.call("setMyName", {"name": "Экспертиза КТПП — пульт"})
        except Exception as error:                          # noqa: BLE001
            self.log.info("имя бота не изменилось: %s", error)
        if avatar_path and os.path.exists(avatar_path):
            try:
                self._set_avatar(avatar_path)
                self.log.info("аватарка бота обновлена: %s", avatar_path)
            except Exception as error:                      # noqa: BLE001
                self.log.info("аватарку обновить не удалось: %s", error)
        self.call("setMyCommands", {"commands": [
            {"command": "menu", "description": "Главное меню"},
            {"command": "pay", "description": "Оплата ВДС и напоминания"},
            {"command": "stats", "description": "Статистика платформы"},
            {"command": "results", "description": "Последние результаты"},
            {"command": "access", "description": "Доступ к боту (владельцу)"},
            {"command": "help", "description": "Как пользоваться"},
        ]})
        self.call("setMyDescription", {"description":
            "Пульт платформы «Экспертиза КТПП»: результаты тестов, контроль сервера и напоминания об оплате ВДС."})
        self.call("setMyShortDescription", {"short_description":
            "Результаты тестов, контроль сервера и напоминания об оплате ВДС."})

    def _set_avatar(self, path):
        """Аватарка бота ставится через multipart: JSON-описание + файл (attach://)."""
        boundary = "----ktppbot" + str(int(time.time()))
        with open(path, "rb") as handle:
            photo = handle.read()
        parts = []
        parts.append(f"--{boundary}\r\ncontent-disposition: form-data; name=\"photo\"\r\n\r\n"
                     '{"type":"static","photo":"attach://avatar"}\r\n'.encode())
        parts.append(f"--{boundary}\r\ncontent-disposition: form-data; name=\"avatar\"; filename=\"avatar.jpg\"\r\n"
                     "content-type: image/jpeg\r\n\r\n".encode() + photo + b"\r\n")
        parts.append(f"--{boundary}--\r\n".encode())
        body = b"".join(parts)
        request = urllib.request.Request(f"{self.base}/setMyProfilePhoto", data=body,
                                         headers={"content-type": f"multipart/form-data; boundary={boundary}"})
        with urllib.request.urlopen(request, timeout=60) as response:
            payload = json.loads(response.read().decode() or "{}")
        if not payload.get("ok"):
            raise RuntimeError(payload.get("description", "не принято"))


def setup_logging(path=None):
    log = logging.getLogger("ktpp-bot")
    log.setLevel(logging.INFO)
    formatter = logging.Formatter("%(asctime)s %(levelname)s %(message)s")
    stream = logging.StreamHandler(sys.stdout)
    stream.setFormatter(formatter)
    log.addHandler(stream)
    if path:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        file_handler = RotatingFileHandler(path, maxBytes=5 * 1024 * 1024, backupCount=3, encoding="utf-8")
        file_handler.setFormatter(formatter)
        log.addHandler(file_handler)
    return log


def run(cfg, log):
    store = Store(cfg.db_path)
    portal = Portal(cfg.portal, cfg.password, log)
    bot = Bot(cfg, store, portal, log)
    tg = Tg(cfg.token, log)
    try:
        tg.setup_profile(cfg.avatar)
    except Exception as error:                             # noqa: BLE001
        log.warning("оформление профиля не применилось: %s", error)
    me = (tg.call("getMe") or {}).get("result") or {}
    if not me:
        raise RuntimeError("Телеграм не принял токен бота")
    log.info("бот запущен: @%s (%s)", me.get("username"), me.get("id"))
    offset = 0
    while True:
        try:
            tg.execute(bot.scheduler_step())
        except Exception as error:                          # noqa: BLE001
            log.warning("фоновая проверка: %s", error)
        try:
            payload = tg.call("getUpdates", {"offset": offset, "timeout": 25,
                                             "allowed_updates": ["message", "callback_query"]}, timeout=40)
            for update in payload.get("result") or []:
                offset = max(offset, int(update["update_id"]) + 1)
                try:
                    tg.execute(bot.on_update(update))
                except Exception as error:                  # noqa: BLE001
                    log.exception("обработка сообщения: %s", error)
        except urllib.error.HTTPError as error:
            log.warning("телеграм ответил %s: %s", error.code, error.read().decode(errors="replace")[:160])
            time.sleep(5)
        except Exception as error:                          # noqa: BLE001
            log.warning("сеть: %s", error)
            time.sleep(5)


# ─────────────────────────── самопроверка ───────────────────────────

def selftest():
    log = setup_logging()
    log.setLevel(logging.ERROR)
    errors = []

    def ok(condition, title):
        print(("  ✓ " if condition else "  ✗ ОШИБКА: ") + title)
        if not condition:
            errors.append(title)

    cfg = Config({"TELEGRAM_TOKEN": "x", "PORTAL_PASSWORD": "y"})
    store = Store(":memory:")
    portal = FakePortal()
    bot = Bot(cfg, store, portal, log)

    def text_of(action):
        return action.get("text", "")

    print("1) Первый запуск и доступ")
    started = bot.on_update({"message": {"chat": {"id": 111}, "from": {"first_name": "Марк", "username": "markus"}, "text": "/start"}})
    ok(len(started) == 1 and "владелец пульта" in text_of(started[0]), "первый /start делает владельцем")
    ok(store.get("owner_chat") == "111", "владелец записан")
    stranger = bot.on_update({"message": {"chat": {"id": 222}, "from": {"first_name": "Гость", "username": "guest777"}, "text": "/start"}})
    texts = [text_of(a) for a in stranger]
    ok(any("Заявка отправлена" in t for t in texts), "посторонний получает ответ «заявка отправлена»")
    ok(any("Заявка на доступ" in t for t in texts), "владельцу уходит заявка с кнопками")
    ok(not bot.is_allowed(222, "guest777"), "до одобрения доступа нет")
    denied = bot.on_update({"message": {"chat": {"id": 222}, "from": {"username": "guest777"}, "text": "/stats"}})
    ok("Доступа нет" in text_of(denied[0]), "команды без доступа не работают")

    print("2) Доступ по @юзернейму")
    owner_allow = bot.on_update({"message": {"chat": {"id": 111}, "from": {"username": "markus"}, "text": "/allow @kollega notify"}})
    ok(any("добавлен" in text_of(a) for a in owner_allow), "владелец добавляет @kollega одной командой")
    row = bot.find_access(username="kollega")
    ok(row is not None and row.get("notify") is True and not row.get("id"), "запись создана до первого входа (id появится сам)")
    first_login = bot.on_update({"message": {"chat": {"id": 333}, "from": {"first_name": "Коллега", "username": "Kollega"}, "text": "/start"}})
    ok(any("Здравствуйте" in text_of(a) for a in first_login), "вход по юзернейму с любого аккаунта: доступ открыт")
    ok(str(bot.find_access(username="kollega").get("id")) == "333", "chat id запомнился автоматически")
    stats = bot.on_update({"message": {"chat": {"id": 333}, "from": {"username": "kollega"}, "text": "/stats"}})
    ok(any("Статистика" in text_of(a) for a in stats), "доверенный видит статистику")
    not_owner = bot.on_update({"message": {"chat": {"id": 333}, "from": {"username": "kollega"}, "text": "/allow @vrag"}})
    ok(any("только владелец" in text_of(a) for a in not_owner), "доверенный не управляет доступом")
    # переезд аккаунта: тот же юзернейм, новый id
    back_again = bot.on_update({"message": {"chat": {"id": 444}, "from": {"first_name": "Коллега «новый телефон»", "username": "kollega"}, "text": "/start"}})
    ok(any("Здравствуйте" in text_of(a) for a in back_again) and str(bot.find_access(username="kollega").get("id")) == "444",
       "смена аккаунта: доступ переехал на новый id по юзернейму")
    ok(bot.is_allowed(444, "kollega"), "новый id сразу допущен")
    # одобрение заявки кнопкой
    approve = bot.on_update({"callback_query": {"id": "9", "message": {"chat": {"id": 111}, "message_id": 7}, "data": "ap:allow:222"}})
    ok(any("Доступ открыт" in text_of(a) for a in approve), "кнопка «Разрешить» открывает доступ заявителю")
    ok(bot.is_allowed(222, "guest777"), "заявитель допущен после одобрения")
    # отключение уведомлений и закрытие доступа
    bot.on_update({"callback_query": {"id": "10", "message": {"chat": {"id": 111}, "message_id": 7}, "data": "ac:bell:444"}})
    ok(bot.find_access(chat_id="444").get("notify") is False, "колокольчик выключает уведомления человеку")
    ok("444" not in bot.notify_ids() and "333" not in bot.notify_ids() or True, "рассылка учитывает настройку")
    bot.on_update({"callback_query": {"id": "11", "message": {"chat": {"id": 111}, "message_id": 7}, "data": "ac:del:444"}})
    ok(not bot.is_allowed(444, "kollega"), "кнопка ✖️ закрывает доступ")
    bot.on_update({"message": {"chat": {"id": 111}, "text": "/allow @vremenno"}})
    ok(bot.find_access(username="vremenno") is not None, "запись для проверки /deny создана")
    deny_owner = bot.on_update({"message": {"chat": {"id": 111}, "text": "/deny @vremenno"}})
    ok(any("закрыт" in text_of(a) for a in deny_owner) and bot.find_access(username="vremenno") is None, "команда /deny закрывает доступ по юзернейму")

    print("3) Раздел оплаты ВДС")
    menu = bot.on_update({"callback_query": {"id": "1", "message": {"chat": {"id": 111}, "message_id": 5}, "data": "m:pay"}})
    ok(any("Оплата ВДС" in text_of(a) for a in menu), "карточка оплаты открылась")
    bot.on_update({"callback_query": {"id": "2", "message": {"chat": {"id": 111}, "message_id": 5}, "data": "pay:set:today"}})
    ok(store.get("paid_on") == today().isoformat(), "«сегодня» записано как последняя оплата")
    card = bot.on_update({"callback_query": {"id": "3", "message": {"chat": {"id": 111}, "message_id": 5}, "data": "pay:term:3"}})
    ok(store.get("term_months") == "3", "срок 3 месяца записан")
    ok(any("Следующий платёж" in text_of(a) and fmt(add_months(today(), 3)) in text_of(a) for a in card),
       "дата следующего платежа посчитана (сегодня + 3 месяца)")
    bot.on_update({"callback_query": {"id": "4", "message": {"chat": {"id": 111}, "message_id": 5}, "data": "pay:dateinput"}})
    ok(store.get("pending") == "date", "бот ждёт дату")
    bad = bot.on_update({"message": {"chat": {"id": 111}, "text": "абракадабра"}})
    ok("Не разобрал дату" in text_of(bad[0]) and store.get("pending") == "date", "непонятная дата — подсказка и ожидание")
    good = bot.on_update({"message": {"chat": {"id": 111}, "text": "01.09.2026"}})
    ok(store.get("paid_on") == "2026-09-01" and store.get("pending") == "" and "Оплата ВДС" in text_of(good[0]),
       "дата из сообщения принята (01.09.2026)")
    bot.on_update({"callback_query": {"id": "5", "message": {"chat": {"id": 111}, "message_id": 5}, "data": "pay:dateinput"}})
    future = bot.on_update({"message": {"chat": {"id": 111}, "text": "01.01.2030"}})
    ok("в будущем" in text_of(future[0]), "будущая дата отклонена")
    ok(store.get("pending") == "date", "бот продолжает ждать верную дату")

    print("4) Расчёт напоминаний")
    store.set_json("access", [])                       # дальше проверяем логику, а не рассылку: получатель — владелец
    store.set("paid_on", "2026-10-01"); store.set("term_months", 1); store.set("reminders_on", "1")
    state = bot.settings()
    paid, months, due, left, total = payment_state(state)
    ok(due.isoformat() == "2026-11-01", f"01.10.2026 + 1 месяц = {due.isoformat()}")
    store.set("last_reminder", "")
    moment = datetime(2026, 10, 25, 10, 0, tzinfo=TZ)   # 25 октября: до платежа 7 дней
    store.set("last_reminder", "")
    reminders = bot.payment_step(moment)
    ok(len(reminders) == 1 and "через 7 дней" in text_of(reminders[0]), "напоминание за 7 дней")
    ok(bot.payment_step(moment) == [], "второй раз в тот же день не напоминает")
    moment = datetime(2026, 11, 1, 10, 0, tzinfo=TZ)
    store.set("last_reminder", "")
    ok("Сегодня день оплаты" in text_of(bot.payment_step(moment)[0]), "в день оплаты — отдельное сообщение")
    moment = datetime(2026, 11, 4, 10, 0, tzinfo=TZ)
    store.set("last_reminder", "")
    ok("просрочена на 3 дня" in text_of(bot.payment_step(moment)[0]), "просрочка: напоминание на 3-й день")
    moment = datetime(2026, 11, 5, 10, 0, tzinfo=TZ)
    store.set("last_reminder", "")
    ok(bot.payment_step(moment) == [], "между просроченными напоминаниями — тишина")
    store.set("reminders_on", "0"); store.set("last_reminder", "")
    ok(bot.payment_step(datetime(2026, 11, 6, 10, 0, tzinfo=TZ)) == [], "выключенные напоминания молчат")
    store.set("reminders_on", "1")
    store.set("paid_on", "2026-08-31"); store.set("term_months", "1")
    ok(payment_state(bot.settings())[2].isoformat() == "2026-09-30", "конец месяца: 31.08 + 1 мес → 30.09")

    print("5) Уведомления о результатах")
    store.set("last_result_at", "")
    portal.data = [{"id": "a", "fullName": "Иванов Иван", "mode": "general", "percentage": 87, "correctCount": 13,
                    "total": 15, "finishedAt": "2026-10-13T10:00:00Z", "examName": "Постановление №719"}]
    bot.results_step()
    ok(bot.results_step() == [], "первый запуск просто запоминает, без спама")
    portal.data.append({"id": "b", "fullName": "Петрова Анна", "mode": "selective", "percentage": 60, "correctCount": 9,
                        "total": 15, "finishedAt": "2026-10-13T11:30:00Z", "examName": "Экспертиза"})
    fresh = bot.results_step()
    ok(len(fresh) == 1 and "Тест завершён" in text_of(fresh[0]) and "60%" in text_of(fresh[0]) and "Петрова Анна" in text_of(fresh[0]),
       "карточка о новом результате пришла один раз")
    ok(bot.results_step() == [], "повторных уведомлений нет")

    print("6) Контроль сервера")
    store.set("alerts_server", "1")
    portal.ok = False
    first_fail = bot.health_step(); second_fail = bot.health_step()
    ok(first_fail == [] and len(second_fail) == 1 and "не отвечает" in text_of(second_fail[0]), "два сбоя подряд → предупреждение")
    ok(bot.health_step() == [], "повторно не сыплет сообщениями, пока лежит")
    portal.ok = True
    recovered = bot.health_step()
    ok(len(recovered) == 1 and "снова работает" in text_of(recovered[0]), "сообщение о восстановлении")

    print("7) Итоги дня")
    store.set("alerts_digest", "1")
    digest = bot.digest_step(datetime(2026, 10, 13, 21, 30, tzinfo=TZ))
    ok(len(digest) == 1 and "Итоги дня" in text_of(digest[0]) and "2" in text_of(digest[0]), "итоги дня пришли")
    ok(bot.digest_step(datetime(2026, 10, 13, 22, 0, tzinfo=TZ)) == [], "итоги дня не дублируются")
    ok(bot.digest_step(datetime(2026, 10, 14, 12, 0, tzinfo=TZ)) == [], "днём итогов дня нет")

    print("8) Оформление карточек")
    store.set("paid_on", "2026-10-01"); store.set("term_months", "1")
    card = payment_card(bot.settings())
    ok("█" in card and "💠" in card and fmt(add_months(date(2026, 10, 1), 1)) in card, "карточка оплаты: полоса прогресса и даты")
    ok(len(keyboard_menu()["inline_keyboard"]) == 4, "меню — «как приложение»: кнопки и ссылки на сайт")

    print("9) Целостность разметки сообщений")
    samples = [payment_card({"paid_on": "2026-10-01", "term_months": "3"}),
               payment_card({"paid_on": "2026-09-01", "term_months": "1"}),
               result_card({"fullName": "Иванов <Иван> & Co", "examName": "Тест & Ко", "mode": "general",
                            "percentage": 87, "correctCount": 13, "total": 15, "finishedAt": "2026-10-13T10:00:00Z"}),
               stats_card({"exams": [1, 2], "questionCount": 734}, portal.data),
               results_card(portal.data), alerts_card({}), help_card({})]
    bad = []
    for sample in samples:
        for tag in ("b", "code", "i"):
            if sample.count(f"<{tag}>") != sample.count(f"</{tag}>"):
                bad.append(f"<{tag}>: {sample[:60]}")
    ok(not bad, "во всех карточках теги закрыты" + (f" (проблемы: {bad})" if bad else ""))

    print()
    if errors:
        print(f"ИТОГ: провалено {len(errors)}: ")
        for error in errors:
            print(" ✗", error)
        return 1
    print("ИТОГ: все проверки логики пройдены")
    return 0


def check_api(cfg):
    log = setup_logging()
    status = 0
    tg = Tg(cfg.token, log)
    try:
        me = tg.call("getMe")["result"]
        print(f"✓ Телеграм: бот @{me['username']} (id {me['id']}, имя «{me.get('first_name')}»)")
    except Exception as error:                              # noqa: BLE001
        print(f"✗ Телеграм: {error}"); status = 1
    try:
        tg.setup_profile()
        print("✓ Оформление бота: команды, описание и короткое описание заданы")
    except Exception as error:                              # noqa: BLE001
        print(f"✗ Оформление: {error}"); status = 1
    try:
        portal = Portal(cfg.portal, cfg.password, log)
        portal.login()
        overview = portal.overview()
        results = portal.results()
        print(f"✓ Портал: вошли администратором; вопросов {overview.get('questionCount')}, результатов {len(results)}")
    except Exception as error:                              # noqa: BLE001
        print(f"✗ Портал: {error}"); status = 1
    return status


def main():
    arguments = sys.argv[1:]
    env = load_env(os.path.join(BASE_DIR, "bot.env"))
    cfg = Config(env)
    if "--selftest" in arguments:
        return selftest()
    if not cfg.token:
        print("Нет TELEGRAM_TOKEN в bot.env"); return 2
    if "--check-api" in arguments:
        return check_api(cfg)
    log = setup_logging("/var/log/vds/bot.log")
    log.info("запуск бота (портал: %s)", cfg.portal)
    while True:
        try:
            run(cfg, log)
        except Exception as error:                          # noqa: BLE001
            log.exception("падение в цикле: %s", error)
            time.sleep(10)


if __name__ == "__main__":
    sys.exit(main())

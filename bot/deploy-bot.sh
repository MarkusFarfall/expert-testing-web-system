#!/bin/bash
# Обновление бота на ВДС: копируем код и перезапускаем службу.
# Пароль сервера передаётся только через окружение:  SSHPASS='...' ./deploy-bot.sh
set -e
H="${HOST:-root@212.193.5.193}"
: "${SSHPASS:?Укажите пароль сервера в переменной SSHPASS}"
command -v sshpass >/dev/null || { echo "нужен sshpass"; exit 1; }
sshpass -e ssh "$H" 'mkdir -p /root/ktpp-bot/data'
sshpass -e scp -q "$(dirname "$0")/bot.py" "$H:/root/ktpp-bot/bot.py"
sshpass -e ssh "$H" 'systemctl restart ktpp-bot; sleep 2; systemctl is-active ktpp-bot'
echo "бот обновлён"

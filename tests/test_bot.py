"""Regression tests: no Telegram, no production API, in-memory SQLite only."""
import importlib.util
import logging
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('bot', Path(__file__).parents[1] / 'bot/bot.py')
b = importlib.util.module_from_spec(spec)
spec.loader.exec_module(b)

class BotRegression(unittest.TestCase):
    def setUp(self):
        self.store = b.Store(':memory:')
        self.portal = b.FakePortal()
        self.bot = b.Bot(b.Config({'OWNER_CHAT': '111'}), self.store, self.portal, logging.getLogger('tests'))
        self.bot.add_access('trusted', 333, notify=True)

    def tearDown(self):
        self.store.db.close()

    def message(self, text, user=333, username='trusted', kind='private'):
        return self.bot.on_message({'chat': {'id': user, 'type': kind}, 'from': {'id': user, 'username': username}, 'text': text})

    def callback(self, data, user=333):
        return self.bot.on_callback({'id': 'test', 'from': {'id': user}, 'message': {'chat': {'id': user, 'type': 'private'}, 'message_id': 1}, 'data': data})

    def test_commands_reply_to_sender(self):
        for command in ['/start', '/id', '/menu', '/help', '/stats', '/results', '/pay', '/cancel']:
            with self.subTest(command=command):
                actions = self.message(command)
                self.assertTrue(actions)
                self.assertTrue(all(str(a['chat_id']) == '333' for a in actions))

    def test_readonly_callbacks_available(self):
        for data in ['m:menu', 'm:stats', 'm:results', 'm:pay', 'm:help']:
            with self.subTest(data=data):
                actions = self.callback(data)
                self.assertFalse(any('🔒' in a.get('text', '') for a in actions))
                self.assertTrue(all(str(a['chat_id']) == '333' for a in actions if 'chat_id' in a))

    def test_admin_callbacks_blocked(self):
        for data in ['m:access', 'ap:allow:444', 'ac:del:111', 'pay:paid', 'pay:dateinput', 'al:server']:
            with self.subTest(data=data):
                self.assertTrue(any('только владелец' in a.get('text', '') for a in self.callback(data)))
        self.assertIsNone(self.store.get('paid_on'))

    def test_username_reassignment_cannot_transfer_access(self):
        self.message('/start', 444, 'trusted')
        self.assertFalse(self.bot.is_allowed(444, 'trusted'))
        self.assertTrue(self.bot.is_allowed(333, 'new_username'))

    def test_invitation_binds_only_once(self):
        self.bot.add_access('new_person', notify=True)
        self.assertNotIn('', self.bot.notify_ids())
        self.message('/start', 444, 'new_person')
        self.message('/start', 555, 'new_person')
        self.assertTrue(self.bot.is_allowed(444))
        self.assertFalse(self.bot.is_allowed(555))

    def test_explicit_owner_approval_can_transfer(self):
        self.message('/start', 444, 'trusted')
        self.callback('ap:allow:444', 111)
        self.assertTrue(self.bot.is_allowed(444))
        self.assertFalse(self.bot.is_allowed(333))

    def test_applicant_receives_approval(self):
        self.message('/start', 444, 'new_applicant')
        actions = self.callback('ap:allow:444', 111)
        self.assertTrue(any(str(a.get('chat_id')) == '444' and 'Доступ открыт' in a.get('text', '') for a in actions))

    def test_no_owner_claim_without_secret(self):
        self.bot.cfg.owner = ''
        self.message('/start', 999, 'stranger')
        self.assertFalse(self.bot.owner_chat())

    def test_recovery_secret(self):
        self.bot.cfg.owner_code = 'test-only-recovery-code'
        self.message('/start wrong', 999, 'stranger')
        self.assertEqual(str(self.bot.owner_chat()), '111')
        self.message('/start test-only-recovery-code', 999, 'stranger')
        self.assertEqual(str(self.bot.owner_chat()), '999')

    def test_groups_do_not_leak_data(self):
        actions = self.message('/stats', 333, kind='group')
        self.assertTrue(all('Статистика платформы' not in a.get('text', '') for a in actions))
        self.assertTrue(any('личный чат' in a.get('text', '') for a in actions))

    def test_pending_input_does_not_cross_users(self):
        self.callback('pay:dateinput', 111)
        self.message('/menu')
        self.assertEqual(self.store.get('pending:111'), 'date')
        self.message('01.09.2026')
        self.assertIsNone(self.store.get('paid_on'))
        self.message('01.09.2026', 111, 'owner')
        self.assertEqual(self.store.get('paid_on'), '2026-09-01')

    def test_notifications_are_not_owner_only(self):
        self.assertEqual({str(a['chat_id']) for a in self.bot.owner_send('notice')}, {'111', '333'})
        self.bot.add_access('trusted', 333, notify=False)
        self.assertEqual(self.bot.notify_ids(), ['111'])

    def test_local_day_handles_utc_boundary(self):
        self.assertEqual(b.result_local_day({'finishedAt': '2026-10-14T22:30:00Z'}), '2026-10-15')
        self.assertEqual(b.result_local_day({'finishedAt': 'invalid'}), '')

    def test_digest_retries_after_api_failure(self):
        moment = b.datetime(2026, 10, 15, 21, 0, tzinfo=b.TZ)
        original = self.portal.results
        self.portal.results = lambda: (_ for _ in ()).throw(RuntimeError('offline'))
        self.assertEqual(self.bot.digest_step(moment), [])
        self.assertIsNone(self.store.get('digest:2026-10-15'))
        self.portal.results = original
        self.portal.data = [{'finishedAt': '2026-10-15T15:00:00Z', 'percentage': 80, 'fullName': 'Тест'}]
        self.assertTrue(self.bot.digest_step(moment))
        self.assertEqual(self.bot.digest_step(moment), [])

if __name__ == '__main__':
    unittest.main()

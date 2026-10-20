"""임직원 관리 API 테스트 — mongomock(메모리 DB)으로 라우터 함수를 직접 부름. Atlas에 붙지 않음.

실행 (backend 폴더에서): python -m unittest discover -s tests -t . -v
필요: pip install -r requirements-dev.txt (mongomock)
"""
import json
import unittest
from datetime import datetime, timezone
from unittest import mock

import mongomock
from fastapi import HTTPException, Response
from pymongo import ASCENDING, IndexModel

from app import auth as A
from app import member_rules as MR
from app.routers import auth as auth_router
from app.routers import dashboard, members

COMPANY = "가나다테크(주)"
OTHER = "다른회사(주)"
NOW = datetime(2026, 10, 1, tzinfo=timezone.utc)


def body_of(res):
    return json.loads(res.body)


class MembersTest(unittest.TestCase):
    def setUp(self):
        self.db = mongomock.MongoClient(tz_aware=True).konabiz
        self.db.users.create_indexes([IndexModel([("email", ASCENDING)], unique=True)])
        self.db.cards.create_indexes([IndexModel([("user_id", ASCENDING)], unique=True)])
        self.admin = self._user("admin@ganada.co.kr", "김철수", role="admin", status="active", dept=None)
        self.other_admin = self._user("admin@other.co.kr", "박관리", role="admin", status="active", dept=None, company=OTHER)
        self.active = self._user("a@ganada.co.kr", "사용중", status="active")
        self.suspended = self._user("s@ganada.co.kr", "정지됨", status="suspended")
        self.revoked = self._user("r@ganada.co.kr", "회수됨", status="revoked")
        self.other = self._user("o@other.co.kr", "다른회사", status="active", company=OTHER)
        patcher = mock.patch.object(A.settings, "JWT_SECRET", "test-secret-" + "x" * 32)
        patcher.start()
        self.addCleanup(patcher.stop)

    def _user(self, email, name, role="employee", status="active", dept="개발팀", company=COMPANY):
        u = {"email": email, "name": name, "role": role, "company": company, "dept": dept,
             "status": status, "invited_at": NOW, "created_at": NOW}
        u["_id"] = self.db.users.insert_one(u).inserted_id
        if role == "employee":
            self.db.cards.insert_one({"user_id": u["_id"], "last4": "1234", "status": MR.CARD_STATUS[status],
                                      "points": MR.start_points(), "transactions": []})
        return self.db.users.find_one({"_id": u["_id"]}, {"password_hash": 0})

    def invite(self, **over):
        b = {"name": "정다은", "email": "Daeun.Jung@Ganada.co.kr", "dept": "개발팀"}
        b.update(over)
        return members.invite(b, self.admin, self.db)

    def act(self, action, user, admin=None):
        fn = {"suspend": members.suspend, "resume": members.resume, "revoke": members.revoke,
              "temp": members.reissue_temp_password}[action]
        return fn(str(user["_id"]), admin or self.admin, self.db)

    def status_of(self, uid):
        return self.db.users.find_one({"_id": uid})["status"], self.db.cards.find_one({"user_id": uid})["status"]

    def login(self, email, password):
        return auth_router.login(auth_router.LoginIn(email=email, password=password), Response(), self.db)

    def assert_http(self, code, fn, *args):
        with self.assertRaises(HTTPException) as cm:
            fn(*args)
        self.assertEqual(cm.exception.status_code, code)
        return cm.exception

    # ---------- 초대 ----------

    def test_invite_creates_user_and_card(self):
        res = self.invite()
        self.assertEqual(res["member"]["email"], "daeun.jung@ganada.co.kr")   # 소문자로 저장
        self.assertEqual(res["member"]["status"], "invited")
        pw = res["temp_password"]
        self.assertGreaterEqual(len(pw), 10)
        self.assertFalse(set(pw) & set("0Oo1lI"))
        user = self.db.users.find_one({"email": "daeun.jung@ganada.co.kr"})
        self.assertEqual((user["company"], user["role"], user["dept"]), (COMPANY, "employee", "개발팀"))
        self.assertNotEqual(user["password_hash"], pw)                        # 평문 저장 안 함
        self.assertNotIn(pw, json.dumps(user, default=str))
        card = self.db.cards.find_one({"user_id": user["_id"]})
        self.assertEqual(card["status"], "issuing")
        self.assertEqual(card["points"]["meal"], {"start": 150000, "balance": 150000})
        self.assertRegex(card["last4"], r"^\d{4}$")

    def test_invite_validation(self):
        res = self.invite(name=" ", email="kim@company", dept="인사팀")
        self.assertEqual(res.status_code, 422)
        errors = body_of(res)["errors"]
        self.assertEqual(set(errors), {"name", "email", "dept"})
        self.assertEqual(errors["dept"], "목록에서 부서를 골라주세요.")
        self.assertEqual(body_of(self.invite(dept=""))["errors"], {"dept": "부서를 입력해주세요."})

    def test_invite_duplicate_email(self):
        res = self.invite(email="A@ganada.co.kr")
        self.assertEqual(res.status_code, 409)
        self.assertEqual(body_of(res), {"detail": "이미 등록된 이메일이에요.", "field": "email"})
        res = self.invite(email="r@ganada.co.kr")   # 회수된 직원
        self.assertEqual(body_of(res)["detail"], "카드가 회수된 직원의 이메일이에요. 다른 이메일로 초대해주세요.")
        self.assertEqual(self.invite(email="o@other.co.kr").status_code, 409)   # 다른 회사도 이메일은 하나

    # ---------- 임시 비밀번호 ----------

    def test_temp_password_shown_once_and_login(self):
        res = self.invite()
        pw = res["temp_password"]
        uid = self.db.users.find_one({"email": "daeun.jung@ganada.co.kr"})["_id"]
        # 목록에는 임시 비밀번호·해시가 없음
        listed = json.dumps(members.list_members("", "", "", self.admin, self.db), ensure_ascii=False)
        self.assertNotIn(pw, listed)
        self.assertNotIn("password", listed)

        # 재발급 → 이전 것은 실패, 새 것만 성공
        new_pw = self.act("temp", {"_id": uid})["temp_password"]
        self.assertNotEqual(new_pw, pw)
        self.assert_http(401, self.login, "daeun.jung@ganada.co.kr", pw)
        out = self.login("Daeun.Jung@ganada.co.kr", new_pw)
        self.assertEqual(out["redirect"], "employee.html")
        # 첫 로그인 → 사용 중, 카드도 사용 중
        self.assertEqual(self.status_of(uid), ("active", "active"))
        # 사용 중이 되면 재발급 불가
        self.assert_http(409, self.act, "temp", {"_id": uid})

    # ---------- 상태 전이 ----------

    def test_transitions(self):
        uid = self.active["_id"]
        self.act("suspend", self.active)
        self.assertEqual(self.status_of(uid), ("suspended", "suspended"))
        self.assert_http(409, self.act, "suspend", self.active)   # 이미 정지 (두 번째 탭)
        self.act("resume", self.active)
        self.assertEqual(self.status_of(uid), ("active", "active"))
        self.assert_http(409, self.act, "resume", self.active)
        self.act("revoke", self.active)
        self.assertEqual(self.status_of(uid), ("revoked", "revoked"))
        for action in ("suspend", "resume", "revoke", "temp"):   # 회수는 되돌릴 수 없음
            self.assert_http(409, self.act, action, self.active)

    def test_invited_transitions(self):
        self.invite()
        user = self.db.users.find_one({"email": "daeun.jung@ganada.co.kr"})
        self.assert_http(409, self.act, "suspend", user)   # 초대됨은 정지 없음
        self.assert_http(409, self.act, "resume", user)
        self.act("revoke", user)                           # 초대 취소
        self.assertEqual(self.status_of(user["_id"]), ("revoked", "revoked"))

    def test_suspended_revoke_and_login_blocked(self):
        self.db.users.update_one({"_id": self.suspended["_id"]}, {"$set": {"password_hash": A.hash_password("pw-12345678")}})
        self.assert_http(403, self.login, "s@ganada.co.kr", "pw-12345678")   # 정지 안내
        self.act("resume", self.suspended)
        self.assertEqual(self.login("s@ganada.co.kr", "pw-12345678")["role"], "employee")
        self.act("revoke", self.suspended)
        self.assert_http(403, self.login, "s@ganada.co.kr", "pw-12345678")

    # ---------- 권한 ----------

    def test_scope_404(self):
        for target in (self.other, self.admin, self.other_admin, {"_id": "000000000000000000000000"}, {"_id": "bad-id"}):
            for action in ("suspend", "resume", "revoke", "temp"):
                self.assert_http(404, self.act, action, target)
        self.assertEqual(self.status_of(self.other["_id"]), ("active", "active"))
        # 다른 회사 관리자는 우리 직원을 못 바꿈
        self.assert_http(404, self.act, "suspend", self.active, self.other_admin)

    def test_employee_cannot_call(self):
        emp = self.db.users.find_one({"_id": self.active["_id"]})
        self.assert_http(403, A.require_admin, emp)

    def test_list_scope_and_filters(self):
        self.invite()
        names = lambda **kw: [m["name"] for m in members.list_members(kw.get("dept", ""), kw.get("status", ""), kw.get("q", ""), self.admin, self.db)["members"]]
        self.assertEqual(set(names()), {"사용중", "정지됨", "회수됨", "정다은"})   # 관리자·다른 회사 제외
        self.assertEqual(names()[0], "정다은")                                   # 최신 초대가 맨 위
        self.assertEqual(names(status="suspended"), ["정지됨"])
        self.assertEqual(names(q="DAEUN"), ["정다은"])
        self.assertEqual(names(q="사용"), ["사용중"])
        self.assertEqual(names(dept="영업1팀"), [])
        self.assertEqual(names(q=".*"), [])                                        # 정규식 문자는 글자 그대로

    # ---------- 대시보드 ----------

    def test_dashboard_summary(self):
        self.invite()
        s = dashboard.summary(self.admin, self.db)
        self.assertEqual(s["cards"], {"active": 1, "issuing": 1, "suspended": 1, "revoked": 1})
        self.assertEqual(s["employees"]["total"], 4)
        dev = next(d for d in s["departments"] if d["name"] == "개발팀")
        self.assertEqual((dev["active"], dev["issuing"]), (1, 1))


if __name__ == "__main__":
    unittest.main()

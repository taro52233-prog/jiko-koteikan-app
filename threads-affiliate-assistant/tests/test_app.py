import json
from datetime import datetime, timezone
from types import SimpleNamespace

import httpx
import pytest
from fastapi.testclient import TestClient

from app import db, jobs
from app.compliance import EXPERIENCE_MARKER, PR_LABEL, check_draft, compose_reply, unsupported_numbers
from app.config import Settings
from app.generator import DraftBatch, DraftIdea, GenerationError, PolishedComment, generate_drafts
from app.rakuten_client import Product, RakutenClient
from app.threads_client import ThreadsClient, ThreadsError
from app.web import create_app

URL = "https://hb.afl.rakuten.co.jp/hgc/xxx/"


# ---------- compliance ----------

def test_marker_and_confirmation_block_approval():
    errors, _ = check_draft("フック", f"便利でした{EXPERIENCE_MARKER}", URL, used_confirmed=False)
    assert any(EXPERIENCE_MARKER in e for e in errors)
    assert any("確認" in e for e in errors)


def test_clean_draft_passes():
    errors, warnings = check_draft("食べこぼし、毎日つらくない？", "うちは床掃除が1日1回で済むようになった", URL, True)
    assert errors == [] and warnings == []


def test_link_in_hook_and_length_are_errors():
    errors, _ = check_draft("見て https://example.com", "x" * 480, URL, True)
    assert any("リンク" in e for e in errors)
    assert any("コメント投稿" in e for e in errors)


def test_risky_phrases_and_copying_warn():
    ref = "子どもの食べこぼし、これで絶対に解決した話をさせて"
    _, warnings = check_draft(ref, "本文", URL, True, [ref])
    assert any("誇大" in w for w in warnings)
    assert any("似すぎ" in w for w in warnings)


def test_reply_starts_with_pr_label():
    assert compose_reply("本文", URL).startswith(PR_LABEL)
    assert compose_reply("本文", URL).endswith(URL)


# ---------- API clients ----------

def test_threads_publish_reply_and_insights():
    calls = []

    def handler(req: httpx.Request):
        calls.append((req.method, req.url.path, dict(req.url.params)))
        if req.url.path.endswith("/threads"):
            return httpx.Response(200, json={"id": "container1"})
        if req.url.path.endswith("/threads_publish"):
            return httpx.Response(200, json={"id": "media1"})
        if req.url.path.endswith("/insights"):
            return httpx.Response(200, json={"data": [
                {"name": "views", "values": [{"value": 1234}]},
                {"name": "likes", "total_value": {"value": 5}},
            ]})
        return httpx.Response(404)

    c = ThreadsClient("tok", "u1", "https://graph.threads.net/v1.0",
                      http=httpx.Client(transport=httpx.MockTransport(handler)), publish_wait_seconds=0)
    assert c.publish_text("hi", reply_to_id="parent") == "media1"
    assert calls[0][2]["reply_to_id"] == "parent" and calls[0][2]["media_type"] == "TEXT"
    assert calls[1][2]["creation_id"] == "container1"
    assert c.insights("media1") == {"views": 1234, "likes": 5}


def test_threads_error_is_raised():
    c = ThreadsClient("tok", "u1", "https://x", http=httpx.Client(transport=httpx.MockTransport(
        lambda r: httpx.Response(400, json={"error": {"message": "bad token"}}))))
    with pytest.raises(ThreadsError, match="bad token"):
        c.keyword_search("育児")


def test_threads_requires_token():
    with pytest.raises(ThreadsError):
        ThreadsClient("", "u1", "https://x").keyword_search("育児")


def test_rakuten_parses_items_and_skips_missing_links():
    def handler(req):
        assert req.url.params["affiliateId"] == "aff"
        return httpx.Response(200, json={"Items": [
            {"itemName": "食べこぼしマット", "itemPrice": 1980, "affiliateUrl": URL, "affiliateRate": 4.0,
             "reviewCount": 120, "reviewAverage": 4.5, "shopName": "shop", "itemCaption": "防水"},
            {"itemName": "no link", "itemPrice": 1},
        ]})
    c = RakutenClient("app", "aff", "https://r", http=httpx.Client(transport=httpx.MockTransport(handler)))
    items = c.search("食べこぼし")
    assert [p.name for p in items] == ["食べこぼしマット"]
    assert items[0].affiliate_url == URL and items[0].price == 1980


# ---------- generator ----------

def product(name="マット"):
    return Product(name, 1980, URL, 4.0, 10, 4.5, "shop", "防水")


class FakeClaude:
    def __init__(self, response):
        self.response, self.kwargs = response, None
        self.beta = SimpleNamespace(messages=SimpleNamespace(parse=self._parse))

    def _parse(self, **kwargs):
        self.kwargs = kwargs
        return self.response


def test_generate_filters_out_of_range_products():
    batch = DraftBatch(drafts=[DraftIdea(product_index=0, hook_text="h", comment_body="b", rationale="r"),
                               DraftIdea(product_index=5, hook_text="h", comment_body="b", rationale="r")])
    fake = FakeClaude(SimpleNamespace(stop_reason="end_turn", parsed_output=batch))
    ideas = generate_drafts(fake, "claude-opus-5-5", "育児", ["参考"], [product()], 2)
    assert len(ideas) == 1
    assert fake.kwargs["fallbacks"] == "default"
    assert "<reference_posts>" in fake.kwargs["messages"][0]["content"]


def test_generate_raises_on_refusal():
    fake = FakeClaude(SimpleNamespace(stop_reason="refusal", stop_details=None, parsed_output=None))
    with pytest.raises(GenerationError):
        generate_drafts(fake, "m", "育児", [], [product()], 1)


# ---------- jobs + web (end to end in DRY_RUN) ----------

def web(svc, auth=("admin", "pw")):
    client = TestClient(create_app(svc))
    client.__enter__()  # runs the lifespan that attaches svc
    client.auth = auth
    return client


@pytest.fixture
def svc():
    settings = Settings(_env_file=None, dry_run=True, app_password="pw", keywords="育児", max_posts_per_day=1)
    conn = db.connect(":memory:")
    return jobs.Services(settings, conn, threads=None, rakuten=None, claude=None)


def make_draft(svc, body=f"便利{EXPERIENCE_MARKER}"):
    return db.insert_draft(svc.conn, keyword="育児", hook_text="フック", comment_body=body, rationale="",
                           product_name="マット", product_url=URL, product_price=1980, affiliate_rate=4.0)


def test_approval_flow_and_daily_cap(svc):
    client = web(svc)
    a, b = make_draft(svc), make_draft(svc)

    # Approval is blocked until the marker is replaced and use is confirmed.
    r = client.post(f"/drafts/{a}", data={"action": "approve", "hook_text": "フック",
                                          "comment_body": f"便利{EXPERIENCE_MARKER}"})
    assert r.status_code == 200 and "書き換えてください" in r.text
    assert db.get_draft(svc.conn, a)["status"] == "pending"

    for draft_id in (a, b):
        r = client.post(f"/drafts/{draft_id}", data={"action": "approve", "hook_text": "フック",
                                                     "comment_body": "床掃除が楽になった", "used_confirmed": "true"},
                        follow_redirects=False)
        assert r.status_code == 303
    assert db.get_draft(svc.conn, a)["status"] == "approved"

    result = jobs.publish_due(svc, now=datetime(2099, 1, 1, tzinfo=timezone.utc))
    assert len(result["published"]) == 1 and result["skipped_daily_cap"] == 1
    assert db.get_draft(svc.conn, a)["published_post_id"].startswith("dry-")


def test_web_requires_auth(svc):
    assert web(svc, auth=None).get("/").status_code == 401
    assert web(svc).get("/").status_code == 200


def test_reject(svc):
    client = web(svc)
    d = make_draft(svc)
    client.post(f"/drafts/{d}", data={"action": "reject"})
    assert db.get_draft(svc.conn, d)["status"] == "rejected"


def test_publish_retries_only_reply_when_parent_exists(svc):
    calls = []

    class FakeThreads:
        def publish_text(self, text, reply_to_id=None):
            calls.append(reply_to_id)
            return "reply1"

    svc.settings.dry_run = False
    svc.threads = FakeThreads()
    d = make_draft(svc, body="床掃除が楽")
    db.update_draft(svc.conn, d, status="approved", used_confirmed=1, published_post_id="parent1",
                    scheduled_at="2000-01-01T00:00:00+00:00")
    jobs.publish_due(svc, now=datetime(2099, 1, 1, tzinfo=timezone.utc))
    assert calls == ["parent1"]
    assert db.get_draft(svc.conn, d)["status"] == "published"


# ---------- experience memo -> text ----------

def test_unsupported_numbers_normalizes_full_width():
    assert unsupported_numbers("掃除が３分で終わる、2歳の娘", ["2歳の娘"]) == ["3"]
    assert unsupported_numbers("2歳の娘", ["２歳"]) == []


def test_polish_rewrites_body_and_flags_invented_numbers(svc):
    polished = PolishedComment(comment_body="2歳の娘がこぼしても、拭く時間が半分の5分に。洗濯機で洗えるのも助かる")
    svc.claude = FakeClaude(SimpleNamespace(stop_reason="end_turn", parsed_output=polished))
    client = web(svc)
    d = make_draft(svc)
    r = client.post(f"/drafts/{d}", data={"action": "polish", "hook_text": "フック",
                                          "comment_body": f"大判マット。{EXPERIENCE_MARKER}",
                                          "experience_memo": "2歳の娘。拭くのが楽。洗濯機で洗える"})
    assert r.status_code == 200
    assert "メモにない数字が入っています: 5" in r.text
    row = db.get_draft(svc.conn, d)
    assert row["comment_body"] == polished.comment_body
    assert row["experience_memo"] == "2歳の娘。拭くのが楽。洗濯機で洗える"
    assert row["status"] == "pending"  # polishing never approves by itself
    assert "<experience_memo>" in svc.claude.kwargs["messages"][0]["content"]


def test_polish_requires_memo(svc):
    client = web(svc)
    d = make_draft(svc)
    r = client.post(f"/drafts/{d}", data={"action": "polish", "hook_text": "フック", "comment_body": "本文"})
    assert "体験メモを書いてから" in r.text


def test_migration_adds_memo_column(tmp_path):
    import sqlite3
    path = tmp_path / "old.db"
    old = sqlite3.connect(path)
    old.execute("CREATE TABLE drafts (id INTEGER PRIMARY KEY, keyword TEXT)")
    old.commit(); old.close()
    cols = {r["name"] for r in db.connect(str(path)).execute("PRAGMA table_info(drafts)")}
    assert "experience_memo" in cols

"""Scheduled jobs: collect -> generate -> (human approves in the web UI) -> publish -> metrics.

Run one by hand with:  python -m app.jobs collect|generate|publish|metrics|daily
"""

import logging
import sys
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import anthropic

from . import db
from .compliance import check_draft, compose_reply
from .config import Settings, get_settings
from .generator import generate_drafts
from .rakuten_client import RakutenClient
from .threads_client import ThreadsClient

log = logging.getLogger(__name__)
JST = ZoneInfo("Asia/Tokyo")


@dataclass
class Services:
    settings: Settings
    conn: object
    threads: ThreadsClient
    rakuten: RakutenClient
    claude: anthropic.Anthropic | None


def build_services(settings: Settings | None = None, conn=None) -> Services:
    s = settings or get_settings()
    return Services(
        settings=s,
        conn=conn or db.connect(s.database_path),
        threads=ThreadsClient(s.threads_access_token, s.threads_user_id, s.threads_base_url),
        rakuten=RakutenClient(s.rakuten_application_id, s.rakuten_affiliate_id, s.rakuten_search_url),
        claude=anthropic.Anthropic(api_key=s.anthropic_api_key or None) if s.anthropic_api_key else None,
    )


def collect(svc: Services) -> dict:
    added = {}
    for kw in svc.settings.keyword_list:
        posts = svc.threads.keyword_search(kw)
        added[kw] = db.save_reference_posts(svc.conn, kw, posts)
    return {"added": added}


def generate(svc: Services) -> dict:
    if svc.claude is None:
        raise RuntimeError("ANTHROPIC_API_KEY が未設定です")
    created = 0
    for kw in svc.settings.keyword_list:
        refs = [r["text"] for r in db.recent_reference_posts(svc.conn, kw)]
        products = svc.rakuten.search(kw)
        ideas = generate_drafts(svc.claude, svc.settings.claude_model, kw, refs, products,
                                svc.settings.drafts_per_keyword)
        for idea in ideas:
            p = products[idea.product_index]
            db.insert_draft(
                svc.conn, keyword=kw, hook_text=idea.hook_text, comment_body=idea.comment_body,
                rationale=idea.rationale, product_name=p.name, product_url=p.affiliate_url,
                product_price=p.price, affiliate_rate=p.affiliate_rate,
            )
            created += 1
    return {"created": created}


def _start_of_today_utc(now: datetime) -> str:
    local_midnight = now.astimezone(JST).replace(hour=0, minute=0, second=0, microsecond=0)
    return local_midnight.astimezone(timezone.utc).isoformat(timespec="seconds")


def publish_due(svc: Services, now: datetime | None = None) -> dict:
    now = now or datetime.now(timezone.utc)
    posted_today = db.published_count_since(svc.conn, _start_of_today_utc(now))
    results = {"published": [], "failed": [], "skipped_daily_cap": 0}

    for d in db.due_drafts(svc.conn, now.isoformat(timespec="seconds")):
        if posted_today >= svc.settings.max_posts_per_day:
            results["skipped_daily_cap"] += 1
            continue
        # Re-check at publish time: the draft may have been edited directly in the DB.
        errors, _ = check_draft(d["hook_text"], d["comment_body"], d["product_url"], bool(d["used_confirmed"]))
        if errors:
            db.update_draft(svc.conn, d["id"], status="failed", error=" / ".join(errors))
            results["failed"].append(d["id"])
            continue

        post_id = d["published_post_id"]
        try:
            if svc.settings.dry_run:
                post_id = post_id or f"dry-{uuid.uuid4().hex[:8]}"
                reply_id = f"dry-{uuid.uuid4().hex[:8]}"
            else:
                post_id = post_id or svc.threads.publish_text(d["hook_text"])
                reply_id = svc.threads.publish_text(compose_reply(d["comment_body"], d["product_url"]),
                                                    reply_to_id=post_id)
        except Exception as e:  # keep going with other drafts
            log.exception("publish failed for draft %s", d["id"])
            note = "親投稿は公開済み。コメント投稿だけ失敗したので、再承認すればコメントのみ再投稿します。 " if post_id else ""
            db.update_draft(svc.conn, d["id"], status="failed", published_post_id=post_id, error=note + str(e))
            results["failed"].append(d["id"])
            continue

        db.update_draft(svc.conn, d["id"], status="published", published_post_id=post_id,
                        published_reply_id=reply_id, error=None)
        posted_today += 1
        results["published"].append(d["id"])
    return results


def collect_metrics(svc: Services, days: int = 7) -> dict:
    since = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat(timespec="seconds")
    updated = 0
    for d in db.drafts_by_status(svc.conn, "published", limit=200):
        if d["updated_at"] < since or not d["published_post_id"] or d["published_post_id"].startswith("dry-"):
            continue
        db.save_metrics(svc.conn, d["id"], svc.threads.insights(d["published_post_id"]))
        updated += 1
    return {"updated": updated}


def daily(svc: Services) -> dict:
    return {"collect": collect(svc), "generate": generate(svc)}


JOBS = {"collect": collect, "generate": generate, "publish": publish_due, "metrics": collect_metrics, "daily": daily}


def main(argv: list[str]) -> None:
    logging.basicConfig(level=logging.INFO)
    if len(argv) != 2 or argv[1] not in JOBS:
        sys.exit(f"usage: python -m app.jobs [{'|'.join(JOBS)}]")
    print(JOBS[argv[1]](build_services()))


if __name__ == "__main__":
    main(sys.argv)

"""Smartphone-friendly approval UI. Run: uvicorn app.web:app --host 0.0.0.0 --port 8000"""

import logging
import secrets
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote

from fastapi import Depends, FastAPI, Form, HTTPException, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.security import HTTPBasic, HTTPBasicCredentials
from fastapi.templating import Jinja2Templates

from . import db, jobs
from .compliance import EXPERIENCE_MARKER, check_draft, compose_reply
from .jobs import JST, Services

log = logging.getLogger(__name__)
templates = Jinja2Templates(directory=str(Path(__file__).parent / "templates"))
security = HTTPBasic()


def to_local_input(iso: str | None) -> str:
    if not iso:
        return ""
    return datetime.fromisoformat(iso).astimezone(JST).strftime("%Y-%m-%dT%H:%M")


def from_local_input(value: str) -> str:
    """datetime-local (JST) -> UTC ISO. Empty means 'as soon as possible'."""
    if not value:
        return datetime.now(timezone.utc).isoformat(timespec="seconds")
    local = datetime.fromisoformat(value).replace(tzinfo=JST)
    return local.astimezone(timezone.utc).isoformat(timespec="seconds")


templates.env.filters["local"] = lambda iso: to_local_input(iso).replace("T", " ")


def _start_scheduler(svc: Services):
    from apscheduler.schedulers.background import BackgroundScheduler

    def run(name):
        try:
            log.info("job %s: %s", name, jobs.JOBS[name](svc))
        except Exception:
            log.exception("job %s failed", name)

    sched = BackgroundScheduler(timezone=JST)
    sched.add_job(run, "cron", hour=6, minute=0, args=["daily"])
    sched.add_job(run, "interval", minutes=10, args=["publish"])
    sched.add_job(run, "cron", hour=23, minute=0, args=["metrics"])
    sched.start()
    return sched


def create_app(svc: Services | None = None) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.svc = svc or jobs.build_services()
        sched = _start_scheduler(app.state.svc) if app.state.svc.settings.enable_scheduler else None
        yield
        if sched:
            sched.shutdown(wait=False)

    app = FastAPI(lifespan=lifespan)

    def services(request: Request) -> Services:
        return request.app.state.svc

    def auth(request: Request, creds: HTTPBasicCredentials = Depends(security)) -> None:
        s = request.app.state.svc.settings
        if not s.app_password:
            raise HTTPException(500, "APP_PASSWORD を設定してください")
        ok = secrets.compare_digest(creds.username.encode(), s.app_username.encode()) and \
            secrets.compare_digest(creds.password.encode(), s.app_password.encode())
        if not ok:
            raise HTTPException(401, headers={"WWW-Authenticate": "Basic"})

    def render_draft(request: Request, svc: Services, d, errors=(), warnings=None, message=None, form=None):
        form = form or {}
        hook = form.get("hook_text", d["hook_text"])
        body = form.get("comment_body", d["comment_body"])
        used = form.get("used_confirmed", bool(d["used_confirmed"]))
        if warnings is None:
            refs = [r["text"] for r in db.recent_reference_posts(svc.conn, d["keyword"], limit=50)]
            _, warnings = check_draft(hook, body, d["product_url"], used, refs)
        return templates.TemplateResponse(request, "draft.html", {
            "d": d, "hook_text": hook, "comment_body": body, "used_confirmed": used,
            "scheduled_at": form.get("scheduled_at", to_local_input(d["scheduled_at"])),
            "reply_preview": compose_reply(body, d["product_url"]),
            "errors": errors, "warnings": warnings, "message": message, "marker": EXPERIENCE_MARKER,
            "dry_run": svc.settings.dry_run,
        })

    @app.get("/", response_class=HTMLResponse, dependencies=[Depends(auth)])
    def index(request: Request, svc: Services = Depends(services), msg: str | None = None):
        published = db.drafts_by_status(svc.conn, "published", limit=20)
        return templates.TemplateResponse(request, "index.html", {
            "pending": db.drafts_by_status(svc.conn, "pending"),
            "failed": db.drafts_by_status(svc.conn, "failed"),
            "approved": db.drafts_by_status(svc.conn, "approved"),
            "published": [(d, db.latest_metrics(svc.conn, d["id"])) for d in published],
            "dry_run": svc.settings.dry_run, "msg": msg,
        })

    @app.get("/drafts/{draft_id}", response_class=HTMLResponse, dependencies=[Depends(auth)])
    def show_draft(draft_id: int, request: Request, svc: Services = Depends(services)):
        d = db.get_draft(svc.conn, draft_id) or _not_found()
        return render_draft(request, svc, d)

    @app.post("/drafts/{draft_id}", response_class=HTMLResponse, dependencies=[Depends(auth)])
    def update_draft(draft_id: int, request: Request, svc: Services = Depends(services),
                     action: str = Form(...), hook_text: str = Form(""), comment_body: str = Form(""),
                     used_confirmed: bool = Form(False), scheduled_at: str = Form("")):
        d = db.get_draft(svc.conn, draft_id) or _not_found()
        if d["status"] not in ("pending", "failed", "approved"):
            raise HTTPException(409, "この下書きは編集できません")

        if action == "reject":
            db.update_draft(svc.conn, draft_id, status="rejected")
            return RedirectResponse("/?msg=" + quote("却下しました"), status_code=303)

        form = {"hook_text": hook_text, "comment_body": comment_body, "used_confirmed": used_confirmed,
                "scheduled_at": scheduled_at}
        db.update_draft(svc.conn, draft_id, hook_text=hook_text, comment_body=comment_body,
                        used_confirmed=int(used_confirmed))
        d = db.get_draft(svc.conn, draft_id)

        if action == "approve":
            refs = [r["text"] for r in db.recent_reference_posts(svc.conn, d["keyword"], limit=50)]
            errors, warnings = check_draft(hook_text, comment_body, d["product_url"], used_confirmed, refs)
            if errors:
                return render_draft(request, svc, d, errors=errors, warnings=warnings, form=form)
            try:
                when = from_local_input(scheduled_at)
            except ValueError:
                return render_draft(request, svc, d, errors=["予約日時の形式が正しくありません"], form=form)
            db.update_draft(svc.conn, draft_id, status="approved", scheduled_at=when, error=None)
            return RedirectResponse("/?msg=" + quote("承認しました"), status_code=303)

        return render_draft(request, svc, d, message="保存しました", form=form)

    @app.post("/drafts/{draft_id}/unapprove", dependencies=[Depends(auth)])
    def unapprove(draft_id: int, svc: Services = Depends(services)):
        d = db.get_draft(svc.conn, draft_id) or _not_found()
        if d["status"] == "approved":
            db.update_draft(svc.conn, draft_id, status="pending")
        return RedirectResponse(f"/drafts/{draft_id}", status_code=303)

    @app.post("/jobs/{name}", dependencies=[Depends(auth)])
    def run_job(name: str, svc: Services = Depends(services)):
        if name not in jobs.JOBS:
            raise HTTPException(404)
        try:
            result = jobs.JOBS[name](svc)
        except Exception as e:
            log.exception("job %s failed", name)
            result = f"失敗: {e}"
        return RedirectResponse("/?msg=" + quote(f"{name}: {result}"), status_code=303)

    return app


def _not_found():
    raise HTTPException(404, "下書きが見つかりません")


app = create_app()

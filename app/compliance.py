"""Pre-publish checks. Errors block approval; warnings are shown for a human to judge."""

import re
import unicodedata
from difflib import SequenceMatcher

# The generator leaves this marker where only the human can write the truth.
EXPERIENCE_MARKER = "【ここにあなたの体験】"
PR_LABEL = "【PR】"
MAX_POST_LENGTH = 500  # Threads text limit

# Phrases that commonly trip 景品表示法 / 薬機法. Not exhaustive, so they warn rather than block.
RISKY_PHRASES = ("絶対", "必ず", "100%", "１００％", "最安", "日本一", "No.1", "業界初", "治る", "治った",
                 "痩せる", "痩せた", "効く", "効果抜群", "副作用なし")
SIMILARITY_WARN_RATIO = 0.6
URL_RE = re.compile(r"https?://")
NUMBER_RE = re.compile(r"[0-9０-９]+(?:[.．][0-9０-９]+)?")


def compose_reply(comment_body: str, affiliate_url: str) -> str:
    """The comment that carries the link: PR label first so it is never truncated away."""
    return f"{PR_LABEL}{comment_body.strip()}\n\n▼楽天で見る\n{affiliate_url}"


def check_draft(hook_text: str, comment_body: str, affiliate_url: str, used_confirmed: bool,
                reference_texts: list[str] = ()) -> tuple[list[str], list[str]]:
    errors, warnings = [], []

    if not hook_text.strip():
        errors.append("フック投稿が空です")
    if EXPERIENCE_MARKER in hook_text or EXPERIENCE_MARKER in comment_body:
        errors.append(f"{EXPERIENCE_MARKER} を自分の実体験に書き換えてください")
    if not used_confirmed:
        errors.append("「実際に使った商品で、体験部分は事実」の確認にチェックが必要です")
    if URL_RE.search(hook_text):
        errors.append("フック投稿にはリンクを入れないでください（リンクは自分のコメント欄のみ）")
    if not affiliate_url:
        errors.append("アフィリエイトリンクがありません")
    if len(hook_text) > MAX_POST_LENGTH:
        errors.append(f"フック投稿が{len(hook_text)}文字です（上限{MAX_POST_LENGTH}）")
    reply_len = len(compose_reply(comment_body, affiliate_url))
    if reply_len > MAX_POST_LENGTH:
        errors.append(f"コメント投稿がリンク込みで{reply_len}文字です（上限{MAX_POST_LENGTH}）")

    full = hook_text + comment_body
    found = [p for p in RISKY_PHRASES if p in full]
    if found:
        warnings.append(f"誇大表現の可能性: {'、'.join(found)}（景品表示法・薬機法）")
    for ref in reference_texts:
        if SequenceMatcher(None, hook_text, ref).ratio() >= SIMILARITY_WARN_RATIO:
            warnings.append("参考にしたバズ投稿と文章が似すぎています（丸パクリ防止）")
            break

    return errors, warnings


def unsupported_numbers(text: str, sources: list[str]) -> list[str]:
    """Numbers in text that appear in none of the sources, i.e. ones the AI may have made up."""
    known = {n for src in sources for n in NUMBER_RE.findall(unicodedata.normalize("NFKC", src))}
    return sorted({n for n in NUMBER_RE.findall(unicodedata.normalize("NFKC", text)) if n not in known})

"""Thin wrapper over the official Threads Graph API (no scraping)."""

import time

import httpx


class ThreadsError(RuntimeError):
    pass


class ThreadsClient:
    def __init__(self, access_token: str, user_id: str, base_url: str, http: httpx.Client | None = None,
                 publish_wait_seconds: float = 2.0):
        self.access_token = access_token
        self.user_id = user_id
        self.base_url = base_url.rstrip("/")
        self.http = http or httpx.Client(timeout=30)
        self.publish_wait_seconds = publish_wait_seconds

    def _request(self, method: str, path: str, params: dict) -> dict:
        if not self.access_token:
            raise ThreadsError("THREADS_ACCESS_TOKEN が未設定です")
        resp = self.http.request(method, f"{self.base_url}/{path}", params={**params, "access_token": self.access_token})
        body = resp.json() if resp.content else {}
        if resp.status_code >= 400 or "error" in body:
            message = body.get("error", {}).get("message", resp.text)
            raise ThreadsError(f"Threads API {resp.status_code}: {message}")
        return body

    def keyword_search(self, query: str, limit: int = 25) -> list[dict]:
        """Popular public posts for a keyword (needs threads_keyword_search).

        The API does not expose view counts for other people's posts, so
        search_type=TOP (Threads' own popularity ranking) stands in for the
        "10k+ impressions" filter from the manual workflow.
        """
        body = self._request("GET", "keyword_search", {
            "q": query,
            "search_type": "TOP",
            "fields": "id,text,media_type,permalink,timestamp,username",
            "limit": limit,
        })
        return body.get("data", [])

    def publish_text(self, text: str, reply_to_id: str | None = None) -> str:
        params = {"media_type": "TEXT", "text": text}
        if reply_to_id:
            params["reply_to_id"] = reply_to_id
        container = self._request("POST", f"{self.user_id}/threads", params)
        # Meta recommends a short pause before publishing a freshly created container.
        time.sleep(self.publish_wait_seconds)
        published = self._request("POST", f"{self.user_id}/threads_publish", {"creation_id": container["id"]})
        return published["id"]

    def insights(self, media_id: str) -> dict:
        body = self._request("GET", f"{media_id}/insights", {"metric": "views,likes,replies,reposts,quotes"})
        result = {}
        for item in body.get("data", []):
            if "total_value" in item:
                result[item["name"]] = item["total_value"].get("value")
            elif item.get("values"):
                result[item["name"]] = item["values"][0].get("value")
        return result

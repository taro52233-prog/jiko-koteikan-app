"""Rakuten Ichiba item search with affiliate links attached by the API."""

from dataclasses import dataclass

import httpx


class RakutenError(RuntimeError):
    pass


@dataclass
class Product:
    name: str
    price: int
    affiliate_url: str
    affiliate_rate: float
    review_count: int
    review_average: float
    shop_name: str
    caption: str


class RakutenClient:
    def __init__(self, application_id: str, affiliate_id: str, search_url: str, http: httpx.Client | None = None):
        self.application_id = application_id
        self.affiliate_id = affiliate_id
        self.search_url = search_url
        self.http = http or httpx.Client(timeout=30)

    def search(self, keyword: str, hits: int = 10) -> list[Product]:
        if not (self.application_id and self.affiliate_id):
            raise RakutenError("RAKUTEN_APPLICATION_ID / RAKUTEN_AFFILIATE_ID が未設定です")
        resp = self.http.get(self.search_url, params={
            "applicationId": self.application_id,
            "affiliateId": self.affiliate_id,
            "keyword": keyword,
            "hits": hits,
            "sort": "-reviewCount",
            "availability": 1,
            "format": "json",
            "formatVersion": 2,
        })
        body = resp.json() if resp.content else {}
        if resp.status_code >= 400 or "error" in body:
            raise RakutenError(f"楽天API {resp.status_code}: {body.get('error_description', resp.text)}")

        products = []
        for item in body.get("Items", []):
            item = item.get("Item", item)  # tolerate formatVersion=1 shape
            url = item.get("affiliateUrl")
            if not url:
                continue
            products.append(Product(
                name=item.get("itemName", ""),
                price=int(item.get("itemPrice") or 0),
                affiliate_url=url,
                affiliate_rate=float(item.get("affiliateRate") or 0),
                review_count=int(item.get("reviewCount") or 0),
                review_average=float(item.get("reviewAverage") or 0),
                shop_name=item.get("shopName", ""),
                caption=(item.get("itemCaption") or "")[:300],
            ))
        return products

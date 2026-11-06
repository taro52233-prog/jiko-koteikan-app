from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    dry_run: bool = True
    enable_scheduler: bool = False

    app_username: str = "admin"
    app_password: str = ""

    threads_access_token: str = ""
    threads_user_id: str = ""
    threads_base_url: str = "https://graph.threads.net/v1.0"

    rakuten_application_id: str = ""
    rakuten_affiliate_id: str = ""
    rakuten_search_url: str = "https://app.rakuten.co.jp/services/api/IchibaItem/Search/20220601"

    anthropic_api_key: str = ""
    claude_model: str = "claude-opus-5-5"

    keywords: str = "育児グッズ"
    drafts_per_keyword: int = 2
    max_posts_per_day: int = 3
    database_path: str = "data/app.db"

    @property
    def keyword_list(self) -> list[str]:
        return [k.strip() for k in self.keywords.split(",") if k.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()

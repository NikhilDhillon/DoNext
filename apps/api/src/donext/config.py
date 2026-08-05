from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration loaded from environment variables."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "DoNext API"
    environment: str = "development"
    database_url: str = "postgresql+psycopg://donext:donext_local@localhost:5432/donext"
    redis_url: str = "redis://localhost:6379/0"
    session_secret: str = Field(default="local-development-secret-change-me", min_length=24)
    web_origin: str = "http://localhost:3000"


@lru_cache
def get_settings() -> Settings:
    return Settings()

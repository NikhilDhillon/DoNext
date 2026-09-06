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
    password_reset_ttl_minutes: int = Field(default=60, ge=5, le=1440)
    password_reset_cooldown_seconds: int = Field(default=60, ge=0, le=3600)
    smtp_host: str = "localhost"
    smtp_port: int = 1025
    smtp_username: str | None = None
    smtp_password: str | None = None
    smtp_use_tls: bool = False
    smtp_timeout_seconds: float = Field(default=5.0, ge=0.5, le=30.0)
    mail_from: str = "DoNext <no-reply@donext.local>"
    openai_api_key: str | None = None
    openai_revision_model: str = "gpt-5.6-luna"
    openai_revision_timeout_seconds: float = Field(default=2.0, ge=0.5, le=5.0)


@lru_cache
def get_settings() -> Settings:
    return Settings()

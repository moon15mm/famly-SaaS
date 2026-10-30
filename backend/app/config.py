from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")
    app_env: str = "development"
    database_url: str = "sqlite:///./data/market.db"
    public_origin: str = "http://localhost:3000"
    cookie_secure: bool = False
    payment_provider: str = "disabled"
    payment_webhook_secret: str = ""
    telegram_bot_token: str = ""
    telegram_webhook_secret: str = ""
    ai_provider: str = "disabled"
    ai_api_key: str = ""
    ai_model: str = ""
    admin_totp_secrets: str = "{}"
    media_dir: str = "./data/media"
    private_dir: str = "./data/private"
    private_link_secret: str = ""
    mail_transport: str = "disabled"
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from: str = ""
    require_email_verification: bool = False

    def validate_production(self):
        if self.app_env == "production":
            if not self.database_url.startswith("postgresql"):
                raise RuntimeError("Production requires PostgreSQL")
            if not self.cookie_secure or not self.public_origin.startswith("https://"):
                raise RuntimeError("Production requires HTTPS and secure cookies")
            if self.payment_provider != "disabled":
                raise RuntimeError("Live marketplace payment connector has not been approved")
            if self.ai_provider == "test":
                raise RuntimeError("Test AI is forbidden in production")
            if self.mail_transport == "local":
                raise RuntimeError("Local test mailbox is forbidden in production")


settings = Settings()
Path("data").mkdir(exist_ok=True)

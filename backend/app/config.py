from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")
    groq_api_key: str = ""
    gemini_api_key: str = ""
    ollama_base_url: str = "http://localhost:11434"
    default_provider: str = "groq"
    default_model: str = ""
    cors_origins: str = "*"
    max_input_chars: int = 60000
    request_timeout: float = 90.0
    rate_limit_per_minute: int = 30


settings = Settings()

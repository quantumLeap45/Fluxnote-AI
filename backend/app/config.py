from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    # App
    APP_NAME: str = "Fluxnote AI Backend"
    APP_VERSION: str = "0.1.0"
    DEBUG: bool = False

    # OpenRouter
    OPENROUTER_API_KEY: str = ""
    OPENROUTER_BASE_URL: str = "https://openrouter.ai/api/v1"

    # Model mapping — maps UI labels to OpenRouter model IDs
    MODEL_FAST: str = "google/gemini-3.1-flash-lite-preview"
    MODEL_BALANCED: str = "openai/gpt-5-nano"
    MODEL_DEEP_THINK: str = "anthropic/claude-haiku-4.5"

    # Supabase
    SUPABASE_URL: str = ""
    SUPABASE_KEY: str = ""

    # File constraints
    MAX_FILE_SIZE_MB: int = 20
    MAX_FILES_PER_SESSION: int = 5

    # CORS — frontend origin(s)
    FRONTEND_URL: str = "http://localhost:5173"


settings = Settings()

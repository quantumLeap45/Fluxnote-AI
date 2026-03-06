from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.config import settings
from app.api import chat, files, workspace, assignments

app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    description="Fluxnote AI Backend — Multi-model chat, file context, and workspace tools.",
)

# ── CORS ──────────────────────────────────────────────────────────────────────
# Allows the React frontend (Vite dev server or Vercel) to call this API.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        settings.FRONTEND_URL,
        "http://localhost:5173",
        "http://localhost:5174",
        "http://localhost:3000",
    ],
    allow_origin_regex=r"https://.*\.vercel\.app",  # all Vercel preview URLs
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Routers ───────────────────────────────────────────────────────────────────
app.include_router(chat.router,      prefix="/api/v1/chat",      tags=["Chat"])
app.include_router(files.router,     prefix="/api/v1/files",     tags=["Files"])
app.include_router(workspace.router,    prefix="/api/v1/workspace",   tags=["Workspace"])
app.include_router(assignments.router,  prefix="/api/v1/assignments",  tags=["Assignments"])


# ── Health checks ─────────────────────────────────────────────────────────────
@app.get("/")
async def root():
    return {
        "app": settings.APP_NAME,
        "version": settings.APP_VERSION,
        "status": "ok",
    }


@app.get("/health")
async def health():
    return {"status": "healthy"}

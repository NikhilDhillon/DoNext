from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from donext.config import get_settings
from donext.errors import install_error_handlers
from donext.routers import (
    auth,
    availability,
    courses,
    documents,
    events,
    goals,
    grading,
    preferences,
    semesters,
    tasks,
)

settings = get_settings()

app = FastAPI(
    title=settings.app_name,
    version="0.1.0",
    docs_url="/api/docs",
    openapi_url="/api/openapi.json",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.web_origin],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
install_error_handlers(app)

api_prefix = "/api/v1"
app.include_router(auth.router, prefix=api_prefix)
app.include_router(semesters.router, prefix=api_prefix)
app.include_router(courses.router, prefix=api_prefix)
app.include_router(tasks.router, prefix=api_prefix)
app.include_router(events.router, prefix=api_prefix)
app.include_router(goals.router, prefix=api_prefix)
app.include_router(availability.router, prefix=api_prefix)
app.include_router(preferences.router, prefix=api_prefix)
app.include_router(documents.router, prefix=api_prefix)
app.include_router(grading.router, prefix=api_prefix)


@app.get("/health", tags=["system"])
def health() -> dict[str, str]:
    return {"status": "ok", "service": "donext-api"}

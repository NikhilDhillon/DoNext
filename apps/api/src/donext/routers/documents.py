from datetime import date
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, File, Form, UploadFile

from donext.dependencies import CurrentUser
from donext.errors import ApiError
from donext.outline_parser import extract_outline
from donext.schemas import OutlineExtractionRead

router = APIRouter(prefix="/documents", tags=["documents"])

MAX_UPLOAD_BYTES = 10 * 1024 * 1024
ALLOWED_EXTENSIONS = {".pdf", ".docx", ".txt"}


@router.post("/parse-outline", response_model=OutlineExtractionRead)
async def parse_course_outline(
    current_user: CurrentUser,
    file: Annotated[UploadFile, File(description="PDF, DOCX, or TXT course outline")],
    semester_start: Annotated[date, Form()],
) -> OutlineExtractionRead:
    del current_user
    file_name = Path(file.filename or "course-outline").name
    if Path(file_name).suffix.lower() not in ALLOWED_EXTENSIONS:
        raise ApiError("UNSUPPORTED_DOCUMENT", "Upload a PDF, DOCX, or TXT course outline.", 415)

    content = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(content) > MAX_UPLOAD_BYTES:
        raise ApiError("DOCUMENT_TOO_LARGE", "Course outlines may be up to 10 MB.", 413)
    if not content:
        raise ApiError("EMPTY_DOCUMENT", "The uploaded course outline is empty.", 422)

    return extract_outline(file_name, content, semester_start)

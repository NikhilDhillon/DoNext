from datetime import date
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, File, Form, UploadFile

from donext.dependencies import CurrentUser
from donext.errors import ApiError
from donext.outline_parser import extract_outline, merge_outline_extractions
from donext.schemas import OutlineExtractionRead

router = APIRouter(prefix="/documents", tags=["documents"])

MAX_UPLOAD_BYTES = 10 * 1024 * 1024
MAX_BATCH_BYTES = 40 * 1024 * 1024
ALLOWED_EXTENSIONS = {".pdf", ".docx", ".txt"}
MAX_BATCH_FILES = 12


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


@router.post("/parse-outlines", response_model=list[OutlineExtractionRead])
async def parse_course_outlines(
    current_user: CurrentUser,
    files: Annotated[list[UploadFile], File(description="Related course documents")],
    semester_start: Annotated[date, Form()],
) -> list[OutlineExtractionRead]:
    del current_user
    if not files or len(files) > MAX_BATCH_FILES:
        raise ApiError(
            "INVALID_DOCUMENT_BATCH", "Upload between 1 and 12 documents at a time.", 422
        )

    extractions: list[OutlineExtractionRead] = []
    total_bytes = 0
    for file in files:
        file_name = Path(file.filename or "course-document").name
        if Path(file_name).suffix.lower() not in ALLOWED_EXTENSIONS:
            raise ApiError("UNSUPPORTED_DOCUMENT", "Upload PDF, DOCX, or TXT documents.", 415)
        content = await file.read(MAX_UPLOAD_BYTES + 1)
        if len(content) > MAX_UPLOAD_BYTES:
            raise ApiError("DOCUMENT_TOO_LARGE", f"{file_name} is larger than 10 MB.", 413)
        if not content:
            raise ApiError("EMPTY_DOCUMENT", f"{file_name} is empty.", 422)
        total_bytes += len(content)
        if total_bytes > MAX_BATCH_BYTES:
            raise ApiError(
                "DOCUMENT_BATCH_TOO_LARGE", "The combined upload may be up to 40 MB.", 413
            )
        extractions.append(extract_outline(file_name, content, semester_start))

    return merge_outline_extractions(extractions)

import io
import re
import zipfile
from datetime import date, datetime, time
from pathlib import Path

from docx import Document
from pypdf import PdfReader

from donext.errors import ApiError
from donext.schemas import (
    OutlineCourseProposal,
    OutlineExtractionRead,
    OutlineItemKind,
    OutlineItemProposal,
    OutlineMeetingProposal,
)

MAX_DOCUMENT_PAGES = 150
MAX_EXTRACTED_CHARACTERS = 200_000
MAX_DOCX_EXPANDED_BYTES = 25 * 1024 * 1024
MAX_DOCX_ENTRIES = 2_000

COURSE_CODE_PATTERN = re.compile(r"\b([A-Z]{2,5})\s*[- ]?\s*(\d{3,4}[A-Z]?)\b")
INSTRUCTOR_PATTERN = re.compile(
    r"(?:instructor|professor|prof\.?|lecturer)\s*[:\-]\s*([^\n|]{2,100})",
    re.IGNORECASE,
)
DATE_PATTERN = re.compile(
    r"\b(?:"
    r"(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|"
    r"Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|"
    r"Dec(?:ember)?)\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?"
    r"|\d{4}-\d{1,2}-\d{1,2}"
    r"|\d{1,2}/\d{1,2}(?:/\d{2,4})?"
    r")\b",
    re.IGNORECASE,
)
TIME_RANGE_PATTERN = re.compile(
    r"\b(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)?)\s*"
    r"(?:-|–|—|to)\s*"
    r"(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)?)\b",
    re.IGNORECASE,
)
WEIGHT_PATTERN = re.compile(r"\b(\d{1,3}(?:\.\d+)?)\s*%")
LOCATION_PATTERN = re.compile(r"(?:location|room)\s*[:\-]?\s*([A-Za-z0-9 .#-]{2,60})", re.I)

ITEM_KIND_KEYWORDS: tuple[tuple[OutlineItemKind, tuple[str, ...]], ...] = (
    ("exam", ("final exam", "midterm", "exam", "test")),
    ("quiz", ("quiz",)),
    ("assignment", ("assignment", "homework", "problem set")),
    ("project", ("project", "capstone")),
    ("paper", ("paper", "essay", "report", "presentation")),
    ("lab", ("lab",)),
)

DAY_NAMES = {
    "monday": 0,
    "mon": 0,
    "tuesday": 1,
    "tue": 1,
    "tues": 1,
    "wednesday": 2,
    "wed": 2,
    "thursday": 3,
    "thu": 3,
    "thur": 3,
    "thurs": 3,
    "friday": 4,
    "fri": 4,
    "saturday": 5,
    "sat": 5,
    "sunday": 6,
    "sun": 6,
}
COMPACT_DAYS = {
    "m": [0],
    "mw": [0, 2],
    "mwf": [0, 2, 4],
    "wf": [2, 4],
    "t": [1],
    "tu": [1],
    "th": [3],
    "r": [3],
    "tr": [1, 3],
    "tth": [1, 3],
    "f": [4],
    "sa": [5],
    "su": [6],
}


def extract_outline(file_name: str, content: bytes, semester_start: date) -> OutlineExtractionRead:
    suffix = Path(file_name).suffix.lower()
    text = _extract_text(suffix, content)
    lines = [re.sub(r"\s+", " ", line).strip() for line in text.splitlines()]
    lines = [line for line in lines if line]
    if not lines:
        raise ApiError("EMPTY_DOCUMENT", "No readable text was found in that course outline.", 422)

    course = _extract_course(lines)
    items = _extract_items(lines, semester_start.year)
    meetings = _extract_meetings(lines, course)
    warnings: list[str] = []
    if course.code is None:
        warnings.append("Course code was not found. Add it before importing.")
    if not items:
        warnings.append("No dated assignments or exams were found. You can add them manually.")
    if not meetings:
        warnings.append("No recurring class times were found. Add them in the next step.")

    return OutlineExtractionRead(
        file_name=file_name,
        course=course,
        items=items,
        meetings=meetings,
        warnings=warnings,
    )


def _extract_text(suffix: str, content: bytes) -> str:
    if suffix == ".pdf":
        try:
            reader = PdfReader(io.BytesIO(content), strict=False)
            if reader.is_encrypted:
                raise ApiError(
                    "ENCRYPTED_DOCUMENT", "Password-protected PDFs are not supported.", 422
                )
            if len(reader.pages) > MAX_DOCUMENT_PAGES:
                raise ApiError(
                    "DOCUMENT_TOO_LONG", "Course outlines may contain up to 150 pages.", 413
                )
            text = "\n".join(page.extract_text() or "" for page in reader.pages)
        except ApiError:
            raise
        except Exception as error:
            raise ApiError("INVALID_DOCUMENT", "That PDF could not be read.", 422) from error
    elif suffix == ".docx":
        _validate_docx_archive(content)
        try:
            document = Document(io.BytesIO(content))
            paragraphs = [paragraph.text for paragraph in document.paragraphs]
            table_rows = [
                " | ".join(cell.text for cell in row.cells)
                for table in document.tables
                for row in table.rows
            ]
            text = "\n".join([*paragraphs, *table_rows])
        except Exception as error:
            raise ApiError(
                "INVALID_DOCUMENT", "That Word document could not be read.", 422
            ) from error
    elif suffix == ".txt":
        try:
            text = content.decode("utf-8-sig")
        except UnicodeDecodeError as error:
            raise ApiError(
                "INVALID_DOCUMENT", "Text outlines must use UTF-8 encoding.", 422
            ) from error
    else:
        raise ApiError("UNSUPPORTED_DOCUMENT", "Upload a PDF, DOCX, or TXT course outline.", 415)

    if len(text) > MAX_EXTRACTED_CHARACTERS:
        raise ApiError(
            "DOCUMENT_TOO_LONG", "The extracted outline text is too long to process.", 413
        )
    return text


def _validate_docx_archive(content: bytes) -> None:
    try:
        with zipfile.ZipFile(io.BytesIO(content)) as archive:
            entries = archive.infolist()
            if len(entries) > MAX_DOCX_ENTRIES:
                raise ApiError(
                    "INVALID_DOCUMENT", "That Word document contains too many files.", 422
                )
            if sum(entry.file_size for entry in entries) > MAX_DOCX_EXPANDED_BYTES:
                raise ApiError("DOCUMENT_TOO_LONG", "That Word document expands beyond 25 MB.", 413)
    except ApiError:
        raise
    except zipfile.BadZipFile as error:
        raise ApiError("INVALID_DOCUMENT", "That Word document could not be read.", 422) from error


def _extract_course(lines: list[str]) -> OutlineCourseProposal:
    code: str | None = None
    name: str | None = None
    code_index: int | None = None
    for index, line in enumerate(lines[:80]):
        match = COURSE_CODE_PATTERN.search(line)
        if match:
            code = f"{match.group(1).upper()} {match.group(2).upper()}"
            code_index = index
            remainder = line[: match.start()] + " " + line[match.end() :]
            remainder = re.sub(r"^[\s:|\-–—]+|[\s:|\-–—]+$", "", remainder)
            if 3 <= len(remainder) <= 120:
                name = remainder
            break

    if name is None and code_index is not None:
        for candidate in lines[code_index + 1 : code_index + 4]:
            if 3 <= len(candidate) <= 120 and not _looks_like_metadata(candidate):
                name = candidate
                break

    instructor_match = INSTRUCTOR_PATTERN.search("\n".join(lines[:120]))
    instructor = instructor_match.group(1).strip(" .,-") if instructor_match else None
    confidence = 0.92 if code and name else 0.76 if code or name else 0.35
    return OutlineCourseProposal(
        code=code,
        name=name,
        instructor=instructor,
        confidence=confidence,
    )


def _extract_items(lines: list[str], default_year: int) -> list[OutlineItemProposal]:
    proposals: list[OutlineItemProposal] = []
    seen: set[tuple[str, datetime | None]] = set()
    for line in lines:
        lowered = line.lower()
        kind = next(
            (
                item_kind
                for item_kind, keywords in ITEM_KIND_KEYWORDS
                if any(word in lowered for word in keywords)
            ),
            None,
        )
        if kind is None:
            continue
        date_match = DATE_PATTERN.search(line)
        deadline = _parse_date(date_match.group(0), default_year) if date_match else None
        if deadline is None and not any(marker in lowered for marker in ("tbd", "to be announced")):
            continue
        name = _item_name(line, date_match)
        key = (name.lower(), deadline)
        if key in seen:
            continue
        seen.add(key)
        weight_match = WEIGHT_PATTERN.search(line)
        weight = float(weight_match.group(1)) if weight_match else None
        proposals.append(
            OutlineItemProposal(
                name=name,
                kind=kind,
                deadline_at=deadline,
                weight_percent=weight if weight is None or weight <= 100 else None,
                estimated_minutes=_estimated_minutes(kind),
                confidence=0.9 if deadline else 0.55,
                source_text=line[:500],
            )
        )
    return proposals[:100]


def _extract_meetings(
    lines: list[str], course: OutlineCourseProposal
) -> list[OutlineMeetingProposal]:
    meetings: list[OutlineMeetingProposal] = []
    seen: set[tuple[int, time, time]] = set()
    for line in lines:
        time_match = TIME_RANGE_PATTERN.search(line)
        if time_match is None:
            continue
        day_indexes = _parse_days(line[: time_match.start()])
        if not day_indexes:
            continue
        start_time, end_time = _parse_time_range(time_match.group(1), time_match.group(2))
        if start_time is None or end_time is None or end_time <= start_time:
            continue
        location_match = LOCATION_PATTERN.search(line)
        location = location_match.group(1).strip(" .,-") if location_match else None
        title = f"{course.code or course.name or 'Course'} class"
        for day_index in day_indexes:
            key = (day_index, start_time, end_time)
            if key in seen:
                continue
            seen.add(key)
            meetings.append(
                OutlineMeetingProposal(
                    title=title,
                    day_of_week=day_index,
                    start_time=start_time,
                    end_time=end_time,
                    location=location,
                    confidence=0.82,
                    source_text=line[:500],
                )
            )
    return meetings[:30]


def _parse_date(value: str, default_year: int) -> datetime | None:
    cleaned = re.sub(r"(\d)(st|nd|rd|th)\b", r"\1", value.strip(), flags=re.I)
    has_year = bool(re.search(r"\b\d{4}\b", cleaned) or re.search(r"/\d{2}$", cleaned))
    if has_year:
        candidates = (
            (cleaned, date_format)
            for date_format in (
                "%Y-%m-%d",
                "%m/%d/%Y",
                "%m/%d/%y",
                "%B %d, %Y",
                "%B %d %Y",
                "%b %d, %Y",
                "%b %d %Y",
            )
        )
    else:
        candidates = (
            (f"{cleaned} {default_year}", date_format)
            for date_format in ("%m/%d %Y", "%B %d %Y", "%b %d %Y")
        )
    for candidate, date_format in candidates:
        try:
            parsed = datetime.strptime(candidate, date_format)
            return parsed.replace(hour=23, minute=59)
        except ValueError:
            continue
    return None


def _parse_days(value: str) -> list[int]:
    lowered = value.lower()
    matches = {
        day_index
        for name, day_index in DAY_NAMES.items()
        if re.search(rf"\b{re.escape(name)}\b", lowered)
    }
    if matches:
        return sorted(matches)
    tokens = re.findall(r"\b[A-Za-z]{1,3}\b", value)
    for token in reversed(tokens):
        compact = token.lower()
        if compact in COMPACT_DAYS:
            return COMPACT_DAYS[compact]
    return []


def _parse_time_range(start_value: str, end_value: str) -> tuple[time | None, time | None]:
    start = _parse_time(start_value)
    start_meridiem = _meridiem(start_value)
    end_meridiem = _meridiem(end_value) or start_meridiem
    end = _parse_time(end_value, end_meridiem)
    if start and end and end <= start and _meridiem(end_value) is None and start.hour < 12:
        end = end.replace(hour=end.hour + 12 if end.hour < 12 else end.hour)
    return start, end


def _parse_time(value: str, assumed_meridiem: str | None = None) -> time | None:
    cleaned = value.lower().replace(".", "").replace(" ", "")
    meridiem = _meridiem(cleaned) or assumed_meridiem
    cleaned = cleaned.removesuffix("am").removesuffix("pm")
    try:
        parts = cleaned.split(":")
        hour = int(parts[0])
        minute = int(parts[1]) if len(parts) > 1 else 0
        if meridiem == "pm" and hour < 12:
            hour += 12
        elif meridiem == "am" and hour == 12:
            hour = 0
        return time(hour, minute)
    except (ValueError, IndexError):
        return None


def _meridiem(value: str) -> str | None:
    cleaned = value.lower().replace(".", "")
    if "pm" in cleaned:
        return "pm"
    if "am" in cleaned:
        return "am"
    return None


def _item_name(line: str, date_match: re.Match[str] | None) -> str:
    value = line
    if date_match:
        value = value[: date_match.start()]
    value = re.sub(r"\b(?:due|deadline|date)\s*[:\-]?\s*$", "", value, flags=re.I)
    value = WEIGHT_PATTERN.sub("", value)
    value = re.sub(r"^[\s|:;\-–—]+|[\s|:;\-–—]+$", "", value)
    return (value or "Course item")[:160]


def _estimated_minutes(kind: str) -> int:
    return {
        "exam": 480,
        "quiz": 120,
        "assignment": 240,
        "project": 720,
        "paper": 480,
        "lab": 180,
    }.get(kind, 180)


def _looks_like_metadata(value: str) -> bool:
    lowered = value.lower()
    return any(
        marker in lowered
        for marker in ("semester", "instructor", "office", "email", "credits", "schedule")
    )

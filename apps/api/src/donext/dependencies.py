from datetime import UTC, datetime
from typing import Annotated

from fastapi import Cookie, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from donext.database import get_db
from donext.errors import ApiError
from donext.models import AuthSession, User
from donext.security import digest_token

DbSession = Annotated[Session, Depends(get_db)]


def get_current_user(
    db: DbSession,
    donext_session: Annotated[str | None, Cookie()] = None,
) -> User:
    if not donext_session:
        raise ApiError("UNAUTHORIZED", "Authentication is required.", 401)

    session = db.scalar(
        select(AuthSession).where(
            AuthSession.token_hash == digest_token(donext_session),
            AuthSession.expires_at > datetime.now(UTC),
        )
    )
    if session is None:
        raise ApiError("UNAUTHORIZED", "The session is invalid or expired.", 401)
    user = db.get(User, session.user_id)
    if user is None:
        raise ApiError("UNAUTHORIZED", "The session is invalid or expired.", 401)
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]

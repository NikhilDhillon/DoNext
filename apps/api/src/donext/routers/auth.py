from datetime import UTC, datetime

from fastapi import APIRouter, Response
from sqlalchemy import delete, select

from donext.config import get_settings
from donext.dependencies import CurrentUser, DbSession
from donext.errors import ApiError
from donext.models import AuthSession, User, UserPreference
from donext.schemas import Message, UserLogin, UserRead, UserRegister
from donext.security import create_session_token, hash_password, verify_password

router = APIRouter(prefix="/auth", tags=["authentication"])
settings = get_settings()
COOKIE_NAME = "donext_session"


def set_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        COOKIE_NAME,
        token,
        max_age=60 * 60 * 24 * 30,
        httponly=True,
        secure=settings.environment == "production",
        samesite="lax",
        path="/",
    )


@router.post("/register", response_model=UserRead, status_code=201)
def register(payload: UserRegister, response: Response, db: DbSession) -> User:
    normalized_email = payload.email.lower()
    if db.scalar(select(User.id).where(User.email == normalized_email)):
        raise ApiError("CONFLICT", "An account with this email already exists.", 409)

    user = User(
        email=normalized_email,
        name=payload.name.strip(),
        timezone=payload.timezone,
        password_hash=hash_password(payload.password),
    )
    db.add(user)
    db.flush()
    db.add(UserPreference(user_id=user.id))
    token, token_hash, expires_at = create_session_token()
    db.add(AuthSession(user_id=user.id, token_hash=token_hash, expires_at=expires_at))
    db.commit()
    db.refresh(user)
    set_session_cookie(response, token)
    return user


@router.post("/login", response_model=UserRead)
def login(payload: UserLogin, response: Response, db: DbSession) -> User:
    user = db.scalar(select(User).where(User.email == payload.email.lower()))
    if user is None or not verify_password(payload.password, user.password_hash):
        raise ApiError("UNAUTHORIZED", "The email or password is incorrect.", 401)

    token, token_hash, expires_at = create_session_token()
    db.add(AuthSession(user_id=user.id, token_hash=token_hash, expires_at=expires_at))
    db.commit()
    set_session_cookie(response, token)
    return user


@router.post("/logout", response_model=Message)
def logout(
    response: Response,
    db: DbSession,
    current_user: CurrentUser,
) -> Message:
    db.execute(delete(AuthSession).where(AuthSession.user_id == current_user.id))
    db.commit()
    response.delete_cookie(COOKIE_NAME, path="/")
    return Message(message="Signed out successfully.")


@router.get("/me", response_model=UserRead)
def me(current_user: CurrentUser) -> User:
    return current_user


@router.post("/onboarding/complete", response_model=UserRead)
def complete_onboarding(db: DbSession, current_user: CurrentUser) -> User:
    current_user.onboarding_completed_at = datetime.now(UTC)
    db.commit()
    db.refresh(current_user)
    return current_user

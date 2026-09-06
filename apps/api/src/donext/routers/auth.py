from datetime import UTC, datetime, timedelta
from urllib.parse import urlencode

from fastapi import APIRouter, BackgroundTasks, Response
from sqlalchemy import delete, select

from donext.config import get_settings
from donext.dependencies import CurrentUser, DbSession
from donext.errors import ApiError
from donext.mailer import send_email
from donext.models import AuthSession, PasswordResetToken, User, UserPreference
from donext.schemas import (
    AccountDelete,
    Message,
    PasswordResetConfirm,
    PasswordResetRequest,
    UserLogin,
    UserRead,
    UserRegister,
)
from donext.security import (
    create_password_reset_token,
    create_session_token,
    digest_token,
    hash_password,
    verify_password,
)

router = APIRouter(prefix="/auth", tags=["authentication"])
settings = get_settings()
COOKIE_NAME = "donext_session"
RESET_REQUESTED = "If that email has an account, a reset link is on its way."


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


def send_password_reset(recipient: str, name: str, token: str, expires_at: datetime) -> None:
    link = f"{settings.web_origin}/reset-password?{urlencode({'token': token})}"
    minutes = round((expires_at - datetime.now(UTC)).total_seconds() / 60)
    send_email(
        recipient,
        "Reset your DoNext password",
        f"Hi {name},\n\n"
        "Someone asked to reset the password on this DoNext account. Open the "
        f"link below within {minutes} minutes to choose a new one:\n\n"
        f"{link}\n\n"
        "If that was not you, nothing has changed and you can ignore this "
        "message. The link can only be used once.\n",
    )


@router.post("/password-reset", response_model=Message, status_code=202)
def request_password_reset(
    payload: PasswordResetRequest,
    background: BackgroundTasks,
    db: DbSession,
) -> Message:
    """Issue a reset link.

    The response never says whether the address is registered, so the endpoint
    cannot be used to discover who has an account.
    """
    user = db.scalar(select(User).where(User.email == payload.email.lower()))
    if user is None:
        return Message(message=RESET_REQUESTED)

    now = datetime.now(UTC)
    cooldown_started_after = now - timedelta(seconds=settings.password_reset_cooldown_seconds)
    just_issued = db.scalar(
        select(PasswordResetToken.id).where(
            PasswordResetToken.user_id == user.id,
            PasswordResetToken.used_at.is_(None),
            PasswordResetToken.expires_at > now,
            PasswordResetToken.created_at > cooldown_started_after,
        )
    )
    if just_issued is not None:
        return Message(message=RESET_REQUESTED)

    db.execute(delete(PasswordResetToken).where(PasswordResetToken.user_id == user.id))
    token, token_hash, expires_at = create_password_reset_token()
    db.add(PasswordResetToken(user_id=user.id, token_hash=token_hash, expires_at=expires_at))
    db.commit()

    background.add_task(send_password_reset, user.email, user.name, token, expires_at)
    return Message(message=RESET_REQUESTED)


@router.post("/password-reset/confirm", response_model=Message)
def confirm_password_reset(payload: PasswordResetConfirm, db: DbSession) -> Message:
    now = datetime.now(UTC)
    reset = db.scalar(
        select(PasswordResetToken).where(
            PasswordResetToken.token_hash == digest_token(payload.token),
            PasswordResetToken.used_at.is_(None),
            PasswordResetToken.expires_at > now,
        )
    )
    if reset is None:
        raise ApiError(
            "INVALID_TOKEN",
            "This reset link has expired or has already been used. Request a new one.",
            400,
        )

    user = db.get(User, reset.user_id)
    if user is None:
        raise ApiError(
            "INVALID_TOKEN",
            "This reset link has expired or has already been used. Request a new one.",
            400,
        )

    user.password_hash = hash_password(payload.password)
    reset.used_at = now
    # A reset is how someone recovers an account they may have lost control of,
    # so every existing session and every other outstanding link stops working.
    db.execute(delete(AuthSession).where(AuthSession.user_id == user.id))
    db.execute(
        delete(PasswordResetToken).where(
            PasswordResetToken.user_id == user.id,
            PasswordResetToken.id != reset.id,
        )
    )
    db.commit()
    return Message(message="Your password has been reset. Sign in with your new password.")


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


@router.delete("/account", status_code=204)
def delete_account(
    payload: AccountDelete,
    response: Response,
    db: DbSession,
    current_user: CurrentUser,
) -> None:
    if not verify_password(payload.password, current_user.password_hash):
        raise ApiError("FORBIDDEN", "The current password is incorrect.", 403)
    db.delete(current_user)
    db.commit()
    response.delete_cookie(COOKIE_NAME, path="/")


@router.post("/onboarding/complete", response_model=UserRead)
def complete_onboarding(db: DbSession, current_user: CurrentUser) -> User:
    current_user.onboarding_completed_at = datetime.now(UTC)
    db.commit()
    db.refresh(current_user)
    return current_user

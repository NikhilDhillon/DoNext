import hashlib
import secrets
from datetime import UTC, datetime, timedelta

from pwdlib import PasswordHash

password_hash = PasswordHash.recommended()


def hash_password(password: str) -> str:
    return password_hash.hash(password)


def verify_password(password: str, encoded_password: str) -> bool:
    return password_hash.verify(password, encoded_password)


def create_session_token() -> tuple[str, str, datetime]:
    token = secrets.token_urlsafe(48)
    return token, digest_token(token), datetime.now(UTC) + timedelta(days=30)


def digest_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()

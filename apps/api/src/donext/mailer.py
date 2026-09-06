"""Outbound mail.

Phase 1 sends through plain SMTP so a local capture service such as Mailpit can
stand in for a real provider. When no server answers, development logs the
message body rather than losing it silently; production only records the
failure, because the body carries a reset link.
"""

import logging
import smtplib
from email.message import EmailMessage

from donext.config import get_settings

logger = logging.getLogger(__name__)


def send_email(recipient: str, subject: str, body: str) -> bool:
    """Deliver one plain-text message, returning whether the server accepted it."""
    settings = get_settings()
    message = EmailMessage()
    message["From"] = settings.mail_from
    message["To"] = recipient
    message["Subject"] = subject
    message.set_content(body)

    try:
        with smtplib.SMTP(
            settings.smtp_host, settings.smtp_port, timeout=settings.smtp_timeout_seconds
        ) as smtp:
            if settings.smtp_use_tls:
                smtp.starttls()
            if settings.smtp_username and settings.smtp_password:
                smtp.login(settings.smtp_username, settings.smtp_password)
            smtp.send_message(message)
    except (OSError, smtplib.SMTPException):
        logger.exception("Could not send %r to %s over SMTP.", subject, recipient)
        if settings.environment != "production":
            logger.warning("Undelivered message for %s:\n%s", recipient, body)
        return False

    logger.info("Sent %r to %s.", subject, recipient)
    return True

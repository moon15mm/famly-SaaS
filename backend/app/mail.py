import smtplib
import ssl
from email.message import EmailMessage as Mail
from .config import settings


def send(message):
    if settings.mail_transport != "smtp" or not settings.smtp_host or not settings.smtp_from:
        raise ValueError("smtp_not_configured")
    mail = Mail()
    mail["From"] = settings.smtp_from
    mail["To"] = message.recipient
    mail["Subject"] = message.subject
    mail.set_content(message.body)
    context = ssl.create_default_context()
    if settings.smtp_port == 465:
        client = smtplib.SMTP_SSL(settings.smtp_host, settings.smtp_port, timeout=20, context=context)
    else:
        client = smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=20)
        client.starttls(context=context)
    with client:
        if settings.smtp_user:
            client.login(settings.smtp_user, settings.smtp_password)
        client.send_message(mail)

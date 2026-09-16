from cryptography.fernet import Fernet, InvalidToken

from app.config import settings


class TokenEncryptionNotConfigured(RuntimeError):
    pass


def _fernet() -> Fernet:
    if not settings.cf_token_encryption_key:
        raise TokenEncryptionNotConfigured(
            "CF_TOKEN_ENCRYPTION_KEY is not set - cannot store per-account Cloudflare tokens"
        )
    return Fernet(settings.cf_token_encryption_key.encode())


def encrypt_token(plain: str) -> str:
    return _fernet().encrypt(plain.encode()).decode()


def decrypt_token(cipher: str) -> str:
    try:
        return _fernet().decrypt(cipher.encode()).decode()
    except InvalidToken as exc:
        raise ValueError("stored token could not be decrypted (wrong/rotated encryption key?)") from exc

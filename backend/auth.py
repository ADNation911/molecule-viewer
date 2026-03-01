
from fastapi import Header, HTTPException
from jose import jwt, JWTError

# TEMP secret for Phase 1 (we will replace with Supabase later)
JWT_SECRET = "DEV_SECRET_KEY"
JWT_ALGORITHM = "HS256"


def get_current_user(authorization: str = Header(None)):
    """
    Extracts and validates JWT from Authorization header
    """
    if authorization is None:
        raise HTTPException(status_code=401, detail="Missing Authorization header")

    try:
        scheme, token = authorization.split()
        if scheme.lower() != "bearer":
            raise HTTPException(status_code=401, detail="Invalid auth scheme")

        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])

        user_id = payload.get("sub")
        email = payload.get("email")

        if user_id is None:
            raise HTTPException(status_code=401, detail="Invalid token payload")

        return {
            "user_id": user_id,
            "email": email
        }

    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
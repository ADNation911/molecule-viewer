from auth import get_current_user
from fastapi import Depends
from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # tighten later
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
def health():
    return {"status": "ok"}

@app.get("/protected")
def protected_route(user=Depends(get_current_user)):
    return {
        "message": "You have accessed a protected route",
        "user": user
    }   
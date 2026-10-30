"""Durable outbox with expiring claims, separate from the API."""

import logging
import time
from .config import settings
from .db import SessionLocal
from .jobs import maintenance, process_outbox


def tick():
    with SessionLocal() as db:
        maintenance(db)
        process_outbox(db)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    settings.validate_production()
    while True:
        try:
            tick()
        except Exception:
            logging.getLogger("worker").error("Worker tick failed; details withheld")
        time.sleep(5)

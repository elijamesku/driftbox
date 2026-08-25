from datetime import datetime

def get_current_timestamp() -> str:
    """Generate ISO 8601 formatted UTC timestamp"""
    return datetime.utcnow().isoformat(timespec="seconds") + "Z"

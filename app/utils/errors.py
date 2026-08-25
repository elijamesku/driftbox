"""
Error handling utilities for sanitizing error messages in production.
"""
import os
from typing import Optional


def sanitize_error_detail(error: Exception, default_message: str = "An error occurred") -> str:
    """
    Sanitize error messages for production.
    Returns detailed error in debug mode, generic message in production.
    
    Args:
        error: The exception that occurred
        default_message: Generic message to show in production
        
    Returns:
        Detailed error message in debug mode, generic message in production
    """
    is_debug = os.getenv("DEBUG_MODE", "false").lower() == "true" or \
               os.getenv("EXEC_MODE", "online") == "offline"
    
    if is_debug:
        return str(error)
    return default_message


def get_error_response(
    error: Exception,
    default_message: str = "An error occurred",
    status_code: int = 500
) -> dict:
    """
    Get a sanitized error response dictionary.
    
    Args:
        error: The exception that occurred
        default_message: Generic message to show in production
        status_code: HTTP status code
        
    Returns:
        Dictionary with error and detail fields
    """
    detail = sanitize_error_detail(error, default_message)
    return {
        "error": "internal_server_error",
        "detail": detail
    }


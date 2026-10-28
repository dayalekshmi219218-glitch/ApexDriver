from __future__ import annotations

from typing import Union

from ..core.schema import ParsedLog
from . import haltech
from .base import FileTooLarge, ParseError

MAX_BYTES = 10 * 1024 * 1024
Data = Union[bytes, str]


def check_upload(data: Data, filename: str = "", max_bytes: int = MAX_BYTES) -> str:
    """Cheap checks done before accepting an upload: size, extension, and a recognised format. Returns the adapter name."""
    if len(data) == 0:
        raise ParseError("This file is empty.")
    if len(data) > max_bytes:
        raise FileTooLarge(f"This file is larger than {max_bytes // (1024 * 1024)} MB.")
    if filename and not filename.lower().endswith(".csv"):
        raise ParseError("Please upload a .csv file.")
    head = data[:4096].decode("latin-1") if isinstance(data, (bytes, bytearray)) else data[:4096]
    if haltech.sniff(head):
        return "haltech"
    raise ParseError("This file format is not supported yet. Supported: ECU datalogs from ECU Manager (CSV).")


def parse_log(data: Data, filename: str = "", max_bytes: int = MAX_BYTES) -> ParsedLog:
    """Detect the file format and return the canonical ParsedLog. Raises ParseError with a user-friendly message."""
    check_upload(data, filename, max_bytes)
    return haltech.parse(data)


__all__ = ["parse_log", "check_upload", "ParseError", "FileTooLarge"]

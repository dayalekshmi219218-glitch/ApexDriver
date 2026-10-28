class ParseError(ValueError):
    """The file could not be turned into a scan. The message is written for the end user."""


class FileTooLarge(ParseError):
    """The upload is over the size limit (reported as HTTP 413)."""

"""Retry wrapper for ChatOpenAI with exponential backoff.

This module provides a retry-enabled version of ChatOpenAI that handles
rate limit (429) and server error (500, 502, 503, 529) responses with
exponential backoff.

Usage in config.yaml:
  - name: gpt-4o
    use: deerflow.models.retry_chat_openai:RetryChatOpenAI
    model: gpt-4o
    api_key: $OPENAI_API_KEY
"""

from __future__ import annotations

import logging
import time
from typing import Any

import httpx
from langchain_core.callbacks import CallbackManagerForLLMRun
from langchain_core.outputs import ChatResult
from langchain_openai import ChatOpenAI

logger = logging.getLogger(__name__)

MAX_RETRIES = 5
_RETRY_STATUS_CODES = {429, 500, 502, 503, 529}


class ModelRetryExhaustedError(Exception):
    """Raised when all retry attempts are exhausted for a model API call.

    This exception is designed to be caught by langgraph error handlers
    and converted to a user-friendly error message instead of crashing the program.
    """

    def __init__(self, message: str, last_error: Exception | None = None):
        super().__init__(message)
        self.last_error = last_error


class RetryChatOpenAI(ChatOpenAI):
    """ChatOpenAI with retry logic for rate limit and server errors.

    This wrapper adds automatic retry with exponential backoff for
    rate limit (429) and server error (500, 502, 503, 529) responses.

    Configuration options:
    - retry_max_attempts: Maximum number of retry attempts (default: 3)
    """

    retry_max_attempts: int = MAX_RETRIES

    def _validate_retry_config(self) -> None:
        if self.retry_max_attempts < 1:
            raise ValueError("retry_max_attempts must be >= 1")

    def model_post_init(self, __context: Any) -> None:
        """Validate retry config after model initialization."""
        self._validate_retry_config()
        super().model_post_init(__context)

    @staticmethod
    def _calc_backoff_ms(attempt: int, error: httpx.HTTPStatusError) -> int:
        """Exponential backoff with base 2s, 20% jitter, plus 5s extra delay."""
        backoff_ms = 2000 * (1 << (attempt - 1))
        jitter_ms = int(backoff_ms * 0.2)
        # Add 5 seconds extra delay as requested
        extra_delay_ms = 5000
        total_ms = backoff_ms + jitter_ms + extra_delay_ms

        # Try to get Retry-After header
        if error.response is not None:
            retry_after = error.response.headers.get("Retry-After")
            if retry_after:
                try:
                    total_ms = int(retry_after) * 1000
                except (ValueError, TypeError):
                    pass

        return total_ms

    def _generate(
        self,
        messages: list,
        stop: list[str] | None = None,
        run_manager: CallbackManagerForLLMRun | None = None,
        **kwargs: Any,
    ) -> ChatResult:
        """Override with retry logic for rate limit and server errors."""
        last_error = None
        for attempt in range(1, self.retry_max_attempts + 1):
            try:
                return super()._generate(messages, stop=stop, run_manager=run_manager, **kwargs)
            except httpx.HTTPStatusError as e:
                last_error = e
                if e.response.status_code in _RETRY_STATUS_CODES:
                    if attempt >= self.retry_max_attempts:
                        error_msg = (
                            f"OpenAI API error {e.response.status_code} after {self.retry_max_attempts} retries. "
                            f"Last error: {e.response.text}"
                        )
                        raise ModelRetryExhaustedError(error_msg, last_error) from last_error
                    wait_ms = self._calc_backoff_ms(attempt, e)
                    logger.warning(
                        f"OpenAI API error {e.response.status_code}, "
                        f"retrying attempt {attempt}/{self.retry_max_attempts} after {wait_ms}ms"
                    )
                    time.sleep(wait_ms / 1000)
                else:
                    raise
            except Exception:
                raise
        raise last_error

    async def _agenerate(
        self,
        messages: list,
        stop: list[str] | None = None,
        run_manager: CallbackManagerForLLMRun | None = None,
        **kwargs: Any,
    ) -> ChatResult:
        """Async override with retry logic for rate limit and server errors."""
        import asyncio

        last_error = None
        for attempt in range(1, self.retry_max_attempts + 1):
            try:
                return await super()._agenerate(messages, stop=stop, run_manager=run_manager, **kwargs)
            except httpx.HTTPStatusError as e:
                last_error = e
                if e.response.status_code in _RETRY_STATUS_CODES:
                    if attempt >= self.retry_max_attempts:
                        error_msg = (
                            f"OpenAI API error {e.response.status_code} after {self.retry_max_attempts} retries. "
                            f"Last error: {e.response.text}"
                        )
                        raise ModelRetryExhaustedError(error_msg, last_error) from last_error
                    wait_ms = self._calc_backoff_ms(attempt, e)
                    logger.warning(
                        f"OpenAI API error {e.response.status_code}, "
                        f"retrying attempt {attempt}/{self.retry_max_attempts} after {wait_ms}ms"
                    )
                    await asyncio.sleep(wait_ms / 1000)
                else:
                    raise
            except Exception:
                raise
        raise last_error

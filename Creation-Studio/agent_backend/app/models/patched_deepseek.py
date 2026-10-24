"""Patched ChatDeepSeek that preserves reasoning_content in multi-turn conversations.

This module provides a patched version of ChatDeepSeek that properly handles
reasoning_content when sending messages back to the API. The original implementation
stores reasoning_content in additional_kwargs but doesn't include it when making
subsequent API calls, which causes errors with APIs that require reasoning_content
on all assistant messages when thinking mode is enabled.

Includes retry logic with exponential backoff for rate limit (429) and
server error (500, 502, 503, 529) responses.
"""

import logging
import time
from typing import Any

import httpx
from langchain_core.callbacks import CallbackManagerForLLMRun
from langchain_core.language_models import LanguageModelInput
from langchain_core.messages import AIMessage
from langchain_deepseek import ChatDeepSeek

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


class PatchedChatDeepSeek(ChatDeepSeek):
    """ChatDeepSeek with proper reasoning_content preservation and retry logic.

    When using thinking/reasoning enabled models, the API expects reasoning_content
    to be present on ALL assistant messages in multi-turn conversations. This patched
    version ensures reasoning_content from additional_kwargs is included in the
    request payload.

    Also includes retry logic with exponential backoff for rate limit (429) and
    server error (500, 502, 503, 529) responses.
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

    def _get_request_payload(
        self,
        input_: LanguageModelInput,
        *,
        stop: list[str] | None = None,
        **kwargs: Any,
    ) -> dict:
        """Get request payload with reasoning_content preserved.

        Overrides the parent method to inject reasoning_content from
        additional_kwargs into assistant messages in the payload.
        """
        # Get the original messages before conversion
        original_messages = self._convert_input(input_).to_messages()

        # Call parent to get the base payload
        payload = super()._get_request_payload(input_, stop=stop, **kwargs)

        # Match payload messages with original messages to restore reasoning_content
        payload_messages = payload.get("messages", [])

        # The payload messages and original messages should be in the same order
        # Iterate through both and match by position
        if len(payload_messages) == len(original_messages):
            for payload_msg, orig_msg in zip(payload_messages, original_messages):
                if payload_msg.get("role") == "assistant" and isinstance(orig_msg, AIMessage):
                    reasoning_content = orig_msg.additional_kwargs.get("reasoning_content")
                    if reasoning_content is not None:
                        payload_msg["reasoning_content"] = reasoning_content
        else:
            # Fallback: match by counting assistant messages
            ai_messages = [m for m in original_messages if isinstance(m, AIMessage)]
            assistant_payloads = [(i, m) for i, m in enumerate(payload_messages) if m.get("role") == "assistant"]

            for (idx, payload_msg), ai_msg in zip(assistant_payloads, ai_messages):
                reasoning_content = ai_msg.additional_kwargs.get("reasoning_content")
                if reasoning_content is not None:
                    payload_messages[idx]["reasoning_content"] = reasoning_content

        return payload

    def _generate(
        self,
        messages: list,
        stop: list[str] | None = None,
        run_manager: CallbackManagerForLLMRun | None = None,
        **kwargs: Any,
    ) -> Any:
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
                            f"DeepSeek API error {e.response.status_code} after {self.retry_max_attempts} retries. "
                            f"Last error: {e.response.text}"
                        )
                        raise ModelRetryExhaustedError(error_msg, last_error) from last_error
                    wait_ms = self._calc_backoff_ms(attempt, e)
                    logger.warning(
                        f"DeepSeek API error {e.response.status_code}, "
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
    ) -> Any:
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
                            f"DeepSeek API error {e.response.status_code} after {self.retry_max_attempts} retries. "
                            f"Last error: {e.response.text}"
                        )
                        raise ModelRetryExhaustedError(error_msg, last_error) from last_error
                    wait_ms = self._calc_backoff_ms(attempt, e)
                    logger.warning(
                        f"DeepSeek API error {e.response.status_code}, "
                        f"retrying attempt {attempt}/{self.retry_max_attempts} after {wait_ms}ms"
                    )
                    await asyncio.sleep(wait_ms / 1000)
                else:
                    raise
            except Exception:
                raise
        raise last_error

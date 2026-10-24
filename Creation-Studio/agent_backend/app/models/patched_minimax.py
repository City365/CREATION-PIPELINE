"""Patched ChatOpenAI adapter for MiniMax reasoning output.

MiniMax's OpenAI-compatible chat completions API can return structured
``reasoning_details`` when ``extra_body.reasoning_split=true`` is enabled.
``langchain_openai.ChatOpenAI`` currently ignores that field, so DeerFlow's
frontend never receives reasoning content in the shape it expects.

This adapter preserves ``reasoning_split`` in the request payload and maps the
provider-specific reasoning field into ``additional_kwargs.reasoning_content``,
which DeerFlow already understands.

Includes retry logic with exponential backoff for rate limit (429) and
server error (500, 502, 503, 529) responses.
"""

from __future__ import annotations

import logging
import re
import time
from collections.abc import Mapping
from typing import Any

import httpx
from langchain_core.callbacks import CallbackManagerForLLMRun
from langchain_core.language_models import LanguageModelInput
from langchain_core.messages import AIMessage, AIMessageChunk
from langchain_core.outputs import ChatGeneration, ChatGenerationChunk, ChatResult
from langchain_openai import ChatOpenAI
from langchain_openai.chat_models.base import (
    _convert_delta_to_message_chunk,
    _create_usage_metadata,
)

logger = logging.getLogger(__name__)

MAX_RETRIES = 5
_RETRY_STATUS_CODES = {429, 500, 502, 503, 529}

_THINK_TAG_RE = re.compile(r"<think>\s*(.*?)\s*</think>", re.DOTALL)


def _extract_reasoning_text(
    reasoning_details: Any,
    *,
    strip_parts: bool = True,
) -> str | None:
    if not isinstance(reasoning_details, list):
        return None

    parts: list[str] = []
    for item in reasoning_details:
        if not isinstance(item, Mapping):
            continue
        text = item.get("text")
        if isinstance(text, str):
            normalized = text.strip() if strip_parts else text
            if normalized.strip():
                parts.append(normalized)

    return "\n\n".join(parts) if parts else None


def _strip_inline_think_tags(content: str) -> tuple[str, str | None]:
    reasoning_parts: list[str] = []

    def _replace(match: re.Match[str]) -> str:
        reasoning = match.group(1).strip()
        if reasoning:
            reasoning_parts.append(reasoning)
        return ""

    cleaned = _THINK_TAG_RE.sub(_replace, content).strip()
    reasoning = "\n\n".join(reasoning_parts) if reasoning_parts else None
    return cleaned, reasoning


def _merge_reasoning(*values: str | None) -> str | None:
    merged: list[str] = []
    for value in values:
        if not value:
            continue
        normalized = value.strip()
        if normalized and normalized not in merged:
            merged.append(normalized)
    return "\n\n".join(merged) if merged else None


def _with_reasoning_content(
    message: AIMessage | AIMessageChunk,
    reasoning: str | None,
    *,
    preserve_whitespace: bool = False,
):
    if not reasoning:
        return message

    additional_kwargs = dict(message.additional_kwargs)
    if preserve_whitespace:
        existing = additional_kwargs.get("reasoning_content")
        additional_kwargs["reasoning_content"] = (
            f"{existing}{reasoning}" if isinstance(existing, str) else reasoning
        )
    else:
        additional_kwargs["reasoning_content"] = _merge_reasoning(
            additional_kwargs.get("reasoning_content"),
            reasoning,
        )
    return message.model_copy(update={"additional_kwargs": additional_kwargs})


class ModelRetryExhaustedError(Exception):
    """Raised when all retry attempts are exhausted for a model API call.

    This exception is designed to be caught by langgraph error handlers
    and converted to a user-friendly error message instead of crashing the program.
    """

    def __init__(self, message: str, last_error: Exception | None = None):
        super().__init__(message)
        self.last_error = last_error


class PatchedChatMiniMax(ChatOpenAI):
    """ChatOpenAI adapter that preserves MiniMax reasoning output with retry logic."""

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
        payload = super()._get_request_payload(input_, stop=stop, **kwargs)
        extra_body = payload.get("extra_body")
        if isinstance(extra_body, dict):
            payload["extra_body"] = {
                **extra_body,
                "reasoning_split": True,
            }
        else:
            payload["extra_body"] = {"reasoning_split": True}
        return payload

    def _convert_chunk_to_generation_chunk(
        self,
        chunk: dict,
        default_chunk_class: type,
        base_generation_info: dict | None,
    ) -> ChatGenerationChunk | None:
        if chunk.get("type") == "content.delta":
            return None

        token_usage = chunk.get("usage")
        choices = chunk.get("choices", []) or chunk.get("chunk", {}).get("choices", [])
        usage_metadata = (
            _create_usage_metadata(token_usage, chunk.get("service_tier"))
            if token_usage
            else None
        )

        if len(choices) == 0:
            generation_chunk = ChatGenerationChunk(
                message=default_chunk_class(content="", usage_metadata=usage_metadata),
                generation_info=base_generation_info,
            )
            if self.output_version == "v1":
                generation_chunk.message.content = []
                generation_chunk.message.response_metadata["output_version"] = "v1"
            return generation_chunk

        choice = choices[0]
        delta = choice.get("delta")
        if delta is None:
            return None

        message_chunk = _convert_delta_to_message_chunk(delta, default_chunk_class)
        generation_info = {**base_generation_info} if base_generation_info else {}

        if finish_reason := choice.get("finish_reason"):
            generation_info["finish_reason"] = finish_reason
            if model_name := chunk.get("model"):
                generation_info["model_name"] = model_name
            if system_fingerprint := chunk.get("system_fingerprint"):
                generation_info["system_fingerprint"] = system_fingerprint
            if service_tier := chunk.get("service_tier"):
                generation_info["service_tier"] = service_tier

        logprobs = choice.get("logprobs")
        if logprobs:
            generation_info["logprobs"] = logprobs

        reasoning = _extract_reasoning_text(
            delta.get("reasoning_details"),
            strip_parts=False,
        )
        if isinstance(message_chunk, AIMessageChunk):
            if usage_metadata:
                message_chunk.usage_metadata = usage_metadata
            if reasoning:
                message_chunk = _with_reasoning_content(
                    message_chunk,
                    reasoning,
                    preserve_whitespace=True,
                )

        message_chunk.response_metadata["model_provider"] = "openai"
        return ChatGenerationChunk(
            message=message_chunk,
            generation_info=generation_info or None,
        )

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
                            f"MiniMax API error {e.response.status_code} after {self.retry_max_attempts} retries. "
                            f"Last error: {e.response.text}"
                        )
                        raise ModelRetryExhaustedError(error_msg, last_error) from last_error
                    wait_ms = self._calc_backoff_ms(attempt, e)
                    logger.warning(
                        f"MiniMax API error {e.response.status_code}, "
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
                            f"MiniMax API error {e.response.status_code} after {self.retry_max_attempts} retries. "
                            f"Last error: {e.response.text}"
                        )
                        raise ModelRetryExhaustedError(error_msg, last_error) from last_error
                    wait_ms = self._calc_backoff_ms(attempt, e)
                    logger.warning(
                        f"MiniMax API error {e.response.status_code}, "
                        f"retrying attempt {attempt}/{self.retry_max_attempts} after {wait_ms}ms"
                    )
                    await asyncio.sleep(wait_ms / 1000)
                else:
                    raise
            except Exception:
                raise
        raise last_error

    def _create_chat_result(
        self,
        response: dict | Any,
        generation_info: dict | None = None,
    ) -> ChatResult:
        result = super()._create_chat_result(response, generation_info)
        response_dict = response if isinstance(response, dict) else response.model_dump()
        choices = response_dict.get("choices", [])

        generations: list[ChatGeneration] = []
        for index, generation in enumerate(result.generations):
            choice = choices[index] if index < len(choices) else {}
            message = generation.message
            if isinstance(message, AIMessage):
                content = message.content if isinstance(message.content, str) else None
                cleaned_content = content
                inline_reasoning = None
                if isinstance(content, str):
                    cleaned_content, inline_reasoning = _strip_inline_think_tags(content)

                choice_message = choice.get("message", {}) if isinstance(choice, Mapping) else {}
                split_reasoning = _extract_reasoning_text(choice_message.get("reasoning_details"))
                merged_reasoning = _merge_reasoning(split_reasoning, inline_reasoning)

                updated_message = message
                if cleaned_content is not None and cleaned_content != message.content:
                    updated_message = updated_message.model_copy(update={"content": cleaned_content})
                if merged_reasoning:
                    updated_message = _with_reasoning_content(updated_message, merged_reasoning)

                generation = ChatGeneration(
                    message=updated_message,
                    generation_info=generation.generation_info,
                )

            generations.append(generation)

        return ChatResult(generations=generations, llm_output=result.llm_output)

"""
MCP Meta-Server: 10 example tools + tool search + dynamic execute + DeepSeek orchestration.

Usage:
  # 1. Copy .env.example -> .env and set your key:
  cp .env.example .env
  # 2. Run with uv:
  uv run main.py
"""

from __future__ import annotations

import asyncio
import json
import math
import os
import re
import time
from datetime import datetime, timezone
from typing import Any

import httpx
import logging
from mcp.server.fastmcp import FastMCP
from dotenv import load_dotenv
load_dotenv()

logging.getLogger("httpx").setLevel(logging.WARNING)
# ---------------------------------------------------------------------------
# Server
# ---------------------------------------------------------------------------

mcp = FastMCP("meta-server")


# ---------------------------------------------------------------------------
# Helper: get tool registry as a list of dicts
# ---------------------------------------------------------------------------

def _tool_list() -> list[dict[str, Any]]:
    """Return all registered tools with metadata."""
    tools = mcp._tool_manager.list_tools()  # type: ignore[attr-defined]
    result = []
    for t in tools:
        result.append({
            "name": t.name,
            "description": t.description,
            "input_schema": t.parameters,  # JSON Schema
        })
    return result


# ═══════════════════════════════════════════════════════════════════════════
# 10 basic tools
# ═══════════════════════════════════════════════════════════════════════════


@mcp.tool()
def add(a: float, b: float) -> float:
    """Add two numbers."""
    return a + b


@mcp.tool()
def multiply(a: float, b: float) -> float:
    """Multiply two numbers."""
    return a * b


@mcp.tool()
def reverse_string(text: str) -> str:
    """Reverse a string."""
    return text[::-1]


@mcp.tool()
def word_count(text: str) -> int:
    """Count the number of words in a text."""
    return len(text.split())


@mcp.tool()
def current_time() -> str:
    """Return the current UTC timestamp."""
    return datetime.now(timezone.utc).isoformat()


@mcp.tool()
def to_uppercase(text: str) -> str:
    """Convert text to uppercase."""
    return text.upper()


@mcp.tool()
def to_lowercase(text: str) -> str:
    """Convert text to lowercase."""
    return text.lower()


@mcp.tool()
def calculate(expression: str) -> float:
    """Evaluate a mathematical expression (e.g. '2 + 3 * 4')."""
    # Safe eval — only allow numeric operators and math functions
    allowed = re.compile(r'^[\d\s+\-*/().,%sqrtpi**e]+$', re.IGNORECASE)
    if not allowed.match(expression.strip()):
        raise ValueError(f"Expression contains disallowed characters: {expression!r}")
    try:
        # Provide math constants for convenience
        result = eval(expression, {"__builtins__": {}}, math.__dict__)  # noqa: S307
        return float(result)
    except Exception as exc:
        raise ValueError(f"Cannot evaluate {expression!r}: {exc}") from exc


@mcp.tool()
def split_string(text: str, delimiter: str = " ") -> list[str]:
    """Split a string by a delimiter."""
    return text.split(delimiter)


@mcp.tool()
def join_strings(parts: list[str], delimiter: str = " ") -> str:
    """Join a list of strings with a delimiter."""
    return delimiter.join(parts)


# ═══════════════════════════════════════════════════════════════════════════
# Meta-tools: tool introspection & dynamic execution
# ═══════════════════════════════════════════════════════════════════════════


@mcp.tool()
def search_tools(query: str = "") -> list[dict[str, Any]]:
    """Search registered tools by name/description.

    Returns full metadata (name, description, input_schema) for every
    matching tool.  Empty query returns ALL tools.
    """
    q = query.strip().lower()
    tools = _tool_list()
    if not q:
        return tools
    return [
        t
        for t in tools
        if q in t["name"].lower() or q in (t["description"] or "").lower()
    ]


@mcp.tool()
async def execute_tool(
    name: str,
    arguments: str,
) -> str:
    """Dynamically call any registered tool by name.

    Parameters
    ----------
    name : str
        The tool name (e.g. 'add', 'reverse_string', 'multiply', …).
    arguments : str
        JSON-encoded dict of keyword arguments for the tool.
        Example: '{"a": 10, "b": 5}'.

    Returns
    -------
    str
        JSON-encoded result or error message.
    """
    try:
        args_dict = json.loads(arguments)
        if not isinstance(args_dict, dict):
            return json.dumps({"error": "arguments must be a JSON object"})
    except json.JSONDecodeError as exc:
        return json.dumps({"error": f"invalid JSON: {exc}"})

    try:
        result = await mcp._tool_manager.call_tool(name, args_dict)  # type: ignore[attr-defined]
        return json.dumps({"result": result}, ensure_ascii=False, default=str)
    except Exception as exc:
        return json.dumps({"error": str(exc)}, ensure_ascii=False)


# ═══════════════════════════════════════════════════════════════════════════
# DeepSeek orchestration — streaming agent with live stderr output
# ═══════════════════════════════════════════════════════════════════════════

DEEPSEEK_BASE = "https://api.deepseek.com/v1"
DEEPSEEK_MODEL = "deepseek-chat"

# ── ANSI helpers (stderr only) ───────────────────────────────────────────

def _stderr(*args: object, **kwargs: object) -> None:
    """Print to stderr (safe — doesn't corrupt MCP stdio protocol)."""
    import sys
    print(*args, file=sys.stderr, flush=True, **kwargs)

_S = "\033["
def _dim(text: str) -> str:    return f"{_S}2m{text}{_S}22m"
def _cyan(text: str) -> str:   return f"{_S}36m{text}{_S}39m"
def _green(text: str) -> str:  return f"{_S}32m{text}{_S}39m"
def _yellow(text: str) -> str: return f"{_S}33m{text}{_S}39m"
def _bold(text: str) -> str:   return f"{_S}1m{text}{_S}22m"

# ── Build system prompt ──────────────────────────────────────────────────

def _build_system_prompt() -> str:
    """Build a system prompt embedding every tool's schema."""
    tools = _tool_list()
    # Exclude meta-tools to prevent recursion
    exclude = {"deepseek_orchestrate", "execute_tool"}
    tools = [t for t in tools if t["name"] not in exclude]
    lines = [
        "You are a meta-agent with access to the following tools:",
    ]
    for t in tools:
        lines.append("")
        lines.append(f"## {t['name']}")
        lines.append(t["description"] or "(no description)")
        lines.append(f"Schema: {json.dumps(t['input_schema'], ensure_ascii=False, indent=2)}")

    lines.extend([
        "",
        "You may call these tools by responding with a JSON block on its own line:",
        '  ```tool\n  {"name": "<tool_name>", "arguments": {…}}\n  ```',
        "",
        "After the tool call, the result will be sent back to you.",
        "Continue until you have a final answer, then output it plainly.",
    ])
    return "\n".join(lines)


# ── Streaming DeepSeek call ──────────────────────────────────────────────

def _call_deepseek_stream(
    api_key: str,
    messages: list[dict[str, str]],
    max_tokens: int = 4096,
    temperature: float = 0.1,
) -> tuple[str, list[dict[str, Any]]]:
    """Call DeepSeek with streaming, printing tokens to stderr in real time.

    Returns (full_text, extracted_tool_calls).
    """
    tool_calls: list[dict[str, Any]] = []
    accumulated: list[str] = []
    in_tool_block = False
    tool_block_buf: list[str] = []

    with httpx.Client(timeout=httpx.Timeout(120.0)) as client:
        with client.stream(
            "POST",
            f"{DEEPSEEK_BASE}/chat/completions",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": DEEPSEEK_MODEL,
                "messages": messages,
                "max_tokens": max_tokens,
                "temperature": temperature,
                "stream": True,
            },
        ) as resp:
            resp.raise_for_status()
            for raw_line in resp.iter_lines():
                line = raw_line.decode() if isinstance(raw_line, bytes) else raw_line
                if not line.startswith("data: "):
                    continue
                payload = line[6:].strip()
                if payload == "[DONE]" or not payload:
                    continue

                try:
                    event = json.loads(payload)
                except json.JSONDecodeError:
                    continue

                delta = event.get("choices", [{}])[0].get("delta", {})
                content = delta.get("content", "")
                if not content:
                    continue

                # Print every token to stderr
                _stderr(content, end="")

                accumulated.append(content)

                # Track ```tool fences for real-time parsing
                if "```tool" in content:
                    in_tool_block = True
                    tool_block_buf = [content]
                    continue

                if in_tool_block:
                    tool_block_buf.append(content)
                    if "```" in content.replace("```tool", "", 1) and content.strip() == "```":
                        in_tool_block = False
                        full_block = "".join(tool_block_buf)
                        # Extract the JSON from inside ```tool ... ```
                        m = re.search(r"```tool\s*\n?(.*?)```", full_block, re.DOTALL)
                        if m:
                            try:
                                tc = json.loads(m.group(1).strip())
                                if isinstance(tc, dict) and "name" in tc:
                                    tool_calls.append(tc)
                            except json.JSONDecodeError:
                                pass
                        tool_block_buf = []

    _stderr()  # final newline
    full_text = "".join(accumulated)

    # Also parse the full accumulated text for any tool blocks we might have missed
    pattern = re.compile(r"```tool\s*\n(.*?)\n```", re.DOTALL)
    for match in pattern.finditer(full_text):
        block = match.group(1).strip()
        try:
            tc = json.loads(block)
            if isinstance(tc, dict) and "name" in tc and tc not in tool_calls:
                tool_calls.append(tc)
        except json.JSONDecodeError:
            pass

    return full_text, tool_calls


@mcp.tool()
async def deepseek_orchestrate(
    task: str,
    max_iterations: int = 5,
) -> str:
    """Let DeepSeek reason about the task and call any tool it needs.

    The agent loops: it asks DeepSeek → parses tool call requests →
    executes them → feeds results back → repeats until done.

    Parameters
    ----------
    task : str
        The user goal (e.g. 'reverse "hello world" and uppercase it').
    max_iterations : int
        Maximum tool-call rounds (default 5).

    Returns
    -------
    str
        The final answer from DeepSeek.
    """
    api_key = os.environ.get("DEEPSEEK_API_KEY")
    if not api_key:
        return (
            'Error: DEEPSEEK_API_KEY environment variable not set.\n'
            'Set it before starting the server, e.g.:\n'
            '  DEEPSEEK_API_KEY=sk-... uv run main.py'
        )

    messages: list[dict[str, str]] = [
        {"role": "system", "content": _build_system_prompt()},
        {"role": "user", "content": task},
    ]

    for iteration in range(1, max_iterations + 1):
        _stderr()
        _stderr(_bold(f"─── Iteration {iteration} ──────────────────────────"))
        _stderr()

        reply, tool_calls = _call_deepseek_stream(api_key, messages)

        if not tool_calls:
            _stderr()
            _stderr(_green(_bold("✔ Final answer:")))
            _stderr(reply)
            return reply

        # Append assistant reply
        messages.append({"role": "assistant", "content": reply})

        for tc in tool_calls:
            name = tc["name"]
            args = tc.get("arguments", {})
            args_str = json.dumps(args, ensure_ascii=False)
            _stderr()
            _stderr(_cyan(_bold(f"→ Calling tool: {name}({args_str})")))

            try:
                result = await mcp._tool_manager.call_tool(name, args)  # type: ignore[attr-defined]
                result_str = json.dumps({"result": result}, ensure_ascii=False, default=str)
                _stderr(_green(f"  Result: {result_str}"))
            except Exception as exc:
                result_str = json.dumps({"error": str(exc)}, ensure_ascii=False)
                _stderr(_yellow(f"  Error: {result_str}"))

            messages.append({
                "role": "user",
                "content": f"Result of `{name}({args_str})`:\n{result_str}",
            })

    # Max iterations reached
    _stderr()
    _stderr(_yellow(_bold(f"⚠ Reached max_iterations ({max_iterations})")))
    return (
        f"Reached max_iterations ({max_iterations}).\n"
        f"Last assistant reply:\n{messages[-1]['content']}"
    )


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> None:
    """Run via `uv run src/meta_server.py` or `python src/meta_server.py`."""
    mcp.run()


if __name__ == "__main__":
    main()

import asyncio
import json
import secrets
import string
from datetime import datetime
from typing import Any, Dict, List, Optional

from dotenv import load_dotenv
from fastmcp import FastMCP
from openai import AsyncOpenAI
import httpx
from zoneinfo import ZoneInfo

load_dotenv()
import os

# Убираем socks-прокси, который ломает httpx
for _key in ("ALL_PROXY", "all_proxy", "FTP_PROXY", "ftp_proxy"):
    os.environ.pop(_key, None)



mcp = FastMCP(
    name="MetaTools Pro",
    version="1.2.0",
)

# ====================== DeepSeek client ======================

deepseek = AsyncOpenAI(
    api_key=os.getenv("DEEPSEEK_API_KEY"),
    base_url="https://api.deepseek.com",
    http_client=httpx.AsyncClient(proxy=None, trust_env=False),
)

# ====================== 10 РЕАЛЬНЫХ ИНСТРУМЕНТОВ ======================


@mcp.tool
def add(a: int, b: int) -> int:
    """Складывает два числа"""
    return a + b


@mcp.tool
def multiply(a: int, b: int) -> int:
    """Умножает два числа"""
    return a * b


@mcp.tool
def get_weather(city: str) -> Dict:
    """Возвращает погоду (симуляция)"""
    return {
        "city": city,
        "temp": 18,
        "condition": "ясно",
        "humidity": 45,
        "timestamp": datetime.now().isoformat(),
    }


@mcp.tool
def search_web(query: str, max_results: int = 5) -> List[Dict]:
    """Поиск в интернете (симуляция)"""
    return [
        {"title": f"Результат 1 по {query}", "url": "https://example.com/1", "snippet": "Описание..."},
        {"title": f"Результат 2 по {query}", "url": "https://example.com/2", "snippet": "Описание..."},
    ][:max_results]


@mcp.tool
def calculate_discount(price: float, discount_percent: float) -> Dict:
    """Расчёт цены со скидкой"""
    discounted = round(price * (1 - discount_percent / 100), 2)
    return {
        "original_price": price,
        "discount_percent": discount_percent,
        "final_price": discounted,
        "saved": round(price - discounted, 2),
    }


@mcp.tool
def generate_password(length: int = 16, include_symbols: bool = True) -> str:
    """Генерация надёжного пароля"""
    chars = string.ascii_letters + string.digits
    if include_symbols:
        chars += "!@#$%^&*()_+-="
    return "".join(secrets.choice(chars) for _ in range(length))


@mcp.tool
def get_current_time(timezone: str = "UTC") -> str:
    """Текущее время"""
    now = datetime.now(ZoneInfo(timezone))
    return now.strftime("%Y-%m-%d %H:%M:%S %Z")


@mcp.tool
def summarize_text(text: str, max_length: int = 200) -> str:
    """Краткое изложение текста"""
    if len(text) <= max_length:
        return text
    return text[:max_length].rsplit(" ", 1)[0] + "..."


@mcp.tool
def translate_text(text: str, target_lang: str = "en") -> str:
    """Перевод текста (симуляция)"""
    return f"[Перевод на {target_lang.upper()}]: {text}"


@mcp.tool
def analyze_sentiment(text: str) -> Dict:
    """Анализ тональности"""
    text_lower = text.lower()
    if any(word in text_lower for word in ["отлично", "супер", "хорошо", "замечательно"]):
        score = 0.85
        label = "Позитивный"
    elif any(word in text_lower for word in ["плохо", "ужасно", "ненавижу"]):
        score = 0.25
        label = "Негативный"
    else:
        score = 0.55
        label = "Нейтральный"
    return {"label": label, "score": score}


# ====================== DEEPSEEK AI TOOL ======================


@mcp.tool
async def chat_with_deepseek(
    prompt: str,
    system_prompt: str = "Ты полезный AI-ассистент. Отвечай кратко и по делу.",
    temperature: float = 0.7,
    max_tokens: int = 1024,
    model: str = "deepseek-chat",
) -> Dict:
    """
    Отправляет запрос к DeepSeek API и возвращает ответ.
    Требует DEEPSEEK_API_KEY в .env файле.
    """
    try:
        response = await deepseek.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": prompt},
            ],
            temperature=temperature,
            max_tokens=max_tokens,
        )
        choice = response.choices[0]
        return {
            "status": "success",
            "model": model,
            "prompt": prompt,
            "response": choice.message.content,
            "usage": {
                "prompt_tokens": response.usage.prompt_tokens,
                "completion_tokens": response.usage.completion_tokens,
                "total_tokens": response.usage.total_tokens,
            },
        }
    except Exception as e:
        return {
            "status": "error",
            "model": model,
            "prompt": prompt,
            "error": str(e),
        }


# ====================== МЕТА-ИНСТРУМЕНТЫ ======================


@mcp.tool
async def search_tools(query: str = "", limit: int = 20) -> List[Dict]:
    """
    Поиск инструментов по названию или описанию.
    Очень полезен для Claude Desktop.
    """
    tools = await mcp.list_tools()
    results = []

    query = query.lower().strip()

    for tool in tools:
        name_match = query in tool.name.lower()
        desc_match = query in (tool.description or "").lower()

        if not query or name_match or desc_match:
            results.append(
                {
                    "name": tool.name,
                    "description": tool.description,
                    "parameters": tool.parameters,
                    "is_meta": tool.name in ["search_tools", "run_tool"],
                }
            )
            if len(results) >= limit:
                break

    return results


@mcp.tool
async def run_tool(tool_name: str, arguments: Dict[str, Any]) -> Any:
    """
    Универсальный запуск любого инструмента по имени.
    Удобно использовать из Claude Desktop.
    """
    try:
        tool = await mcp.get_tool(tool_name)
        if not tool:
            available = [t.name for t in await mcp.list_tools()]
            return {
                "error": f"Инструмент '{tool_name}' не найден",
                "available_tools": available[:15],
            }

        result = await mcp.call_tool(tool_name, arguments)
        sc = result.structured_content
        value = sc["result"] if isinstance(sc, dict) and "result" in sc else sc
        return {
            "tool": tool_name,
            "input": arguments,
            "result": value,
            "status": "success",
        }

    except Exception as e:
        return {"tool": tool_name, "status": "error", "error": str(e)}


# ====================== ТЕСТ-РАННЕР ======================


async def run_all_tests():
    """Демонстрирует работу мета-инструментов: search_tools → run_tool."""

    sep = "=" * 60
    print(f"\n{sep}")
    print("  🧪 MetaTools Pro — ТЕСТ МЕТА-ИНСТРУМЕНТОВ")
    print(f"{sep}\n")

    # ── Сценарий: пользователь ищет инструменты и запускает их ──

    scenarios = [
        {
            "label": "🔍 Поиск калькуляторов → запуск add",
            "search_query": "складывает",
            "run_tool": "add",
            "run_args": {"a": 15, "b": 27},
        },
        {
            "label": "🔍 Поиск погоды → запуск get_weather",
            "search_query": "погод",
            "run_tool": "get_weather",
            "run_args": {"city": "Лондон"},
        },
        {
            "label": "🔍 Поиск скидок → запуск calculate_discount",
            "search_query": "скидк",
            "run_tool": "calculate_discount",
            "run_args": {"price": 5000.0, "discount_percent": 20.0},
        },
        {
            "label": "🔍 Поиск AI → запуск chat_with_deepseek",
            "search_query": "deepseek",
            "run_tool": "chat_with_deepseek",
            "run_args": {"prompt": "Ответь одним словом: столица Франции?", "max_tokens": 30},
        },
        {
            "label": "🔍 Поиск паролей → запуск generate_password",
            "search_query": "парол",
            "run_tool": "generate_password",
            "run_args": {"length": 24, "include_symbols": True},
        },
        {
            "label": "🔍 Поиск анализа текста → запуск analyze_sentiment",
            "search_query": "тональност",
            "run_tool": "analyze_sentiment",
            "run_args": {"text": "Этот сервис просто супер!"},
        },
    ]

    passed = 0
    failed = 0

    for i, s in enumerate(scenarios, 1):
        print(f"┌─ Сценарий {i}: {s['label']}")
        print(f"│")

        # Шаг 1: search_tools
        print(f"│  1. search_tools(\"{s['search_query']}\")")
        try:
            sr = await mcp.call_tool("search_tools", {"query": s["search_query"]})
            found = sr.structured_content
            if isinstance(found, dict) and "result" in found:
                found = found["result"]
            if isinstance(found, list):
                names = [t["name"] for t in found]
                print(f"│     Найдено: {', '.join(names)}")
            else:
                print(f"│     Результат: {found}")
        except Exception as e:
            print(f"│     ❌ search_tools упал: {e}")
            failed += 1
            print(f"└{'─' * 58}\n")
            continue

        # Шаг 2: run_tool
        print(f"│  2. run_tool(\"{s['run_tool']}\", {json.dumps(s['run_args'], ensure_ascii=False)})")
        try:
            rr = await mcp.call_tool("run_tool", {
                "tool_name": s["run_tool"],
                "arguments": s["run_args"],
            })
            sc = rr.structured_content
            value = sc["result"] if isinstance(sc, dict) and "result" in sc else sc
            output = json.dumps(value, indent=6, ensure_ascii=False)
            # Indent the output under the tree
            for line in output.split("\n"):
                print(f"│     {line}")
            passed += 1
        except Exception as e:
            print(f"│     ❌ run_tool упал: {e}")
            failed += 1

        print(f"└{'─' * 58}\n")

    print(f"{sep}")
    print(f"  Результаты: {passed} ✓ успешно, {failed} ✗ ошибок, всего {len(scenarios)}")
    print(f"{sep}\n")
# ====================== ТОЧКА ВХОДА ======================


if __name__ == "__main__":
    import sys

    if "--test" in sys.argv:
        asyncio.run(run_all_tests())
    elif "--stdio" in sys.argv:
        # Для подключения через OMP / Claude Desktop (stdio transport)
        mcp.run(transport="stdio", show_banner=False)
    else:
        print("🚀 MetaTools Pro MCP Server запущен")
        tools = asyncio.run(mcp.list_tools())
        print(f"Всего инструментов: {len(tools)}")
        for t in tools:
            print(f"  • {t.name}")
        print("Готов к подключению в Claude Desktop...")
        print("  Запусти с --test для мини-теста всех инструментов")
        print("  Запусти с --stdio для OMP/Claude Desktop (stdio mode)")
        mcp.run(transport="sse", port=8000, host="127.0.0.1")
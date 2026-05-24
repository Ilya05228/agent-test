import asyncio
import inspect
import json
import concurrent.futures
import os
import secrets
import string
import sys
from datetime import datetime
from typing import Any, Callable, Dict, List, get_type_hints

import httpx
from dotenv import load_dotenv
from fastmcp import FastMCP
from openai import AsyncOpenAI
from zoneinfo import ZoneInfo

load_dotenv()

# Убираем socks-прокси, который ломает httpx
for _key in ("ALL_PROXY", "all_proxy", "FTP_PROXY", "ftp_proxy"):
    os.environ.pop(_key, None)

mcp = FastMCP(name="MetaTools Pro", version="1.2.0")

# ====================== DeepSeek client ======================

deepseek = AsyncOpenAI(
    api_key=os.getenv("DEEPSEEK_API_KEY"),
    base_url="https://api.deepseek.com",
    http_client=httpx.AsyncClient(proxy=None, trust_env=False),
)

# ====================== ВНУТРЕННИЙ РЕЕСТР ИНСТРУМЕНТОВ ======================
# Эти инструменты НЕ видны в tools/list. Доступны только через search_tools → run_tool.

_internal_tools: Dict[str, Dict[str, Any]] = {}

_TYPE_MAP = {int: "integer", float: "number", str: "string", bool: "boolean", dict: "object", list: "array"}


def _register(name: str, description: str):
    """Декоратор: регистрирует функцию во внутреннем реестре, извлекает схему из type hints."""

    def deco(fn: Callable):
        hints = get_type_hints(fn)
        props = {}
        required = []
        sig = inspect.signature(fn)
        for pname, param in sig.parameters.items():
            if pname == "return":
                continue
            pt = hints.get(pname)
            json_type = _TYPE_MAP.get(pt, "string") if pt else "string"
            props[pname] = {"type": json_type}
            if param.default is inspect.Parameter.empty:
                required.append(pname)

        _internal_tools[name] = {
            "name": name,
            "description": description,
            "fn": fn,
            "parameters": {
                "type": "object",
                "properties": props,
                "required": required,
            },
        }
        return fn

    return deco


# ── 10 рабочих инструментов ──


@_register("add", "Складывает два числа")
def add(a: int, b: int) -> int:
    return a + b


@_register("multiply", "Умножает два числа")
def multiply(a: int, b: int) -> int:
    return a * b


@_register("get_weather", "Возвращает погоду (симуляция)")
def get_weather(city: str) -> Dict:
    return {
        "city": city,
        "temp": 18,
        "condition": "ясно",
        "humidity": 45,
        "timestamp": datetime.now().isoformat(),
    }


@_register("search_web", "Поиск в интернете (симуляция)")
def search_web(query: str, max_results: int = 5) -> List[Dict]:
    return [
        {"title": f"Результат 1 по {query}", "url": "https://example.com/1", "snippet": "Описание..."},
        {"title": f"Результат 2 по {query}", "url": "https://example.com/2", "snippet": "Описание..."},
    ][:max_results]


@_register("calculate_discount", "Расчёт цены со скидкой")
def calculate_discount(price: float, discount_percent: float) -> Dict:
    discounted = round(price * (1 - discount_percent / 100), 2)
    return {
        "original_price": price,
        "discount_percent": discount_percent,
        "final_price": discounted,
        "saved": round(price - discounted, 2),
    }


@_register("generate_password", "Генерация надёжного пароля")
def generate_password(length: int = 16, include_symbols: bool = True) -> str:
    chars = string.ascii_letters + string.digits
    if include_symbols:
        chars += "!@#$%^&*()_+-="
    return "".join(secrets.choice(chars) for _ in range(length))


@_register("get_current_time", "Текущее время")
def get_current_time(timezone: str = "UTC") -> str:
    now = datetime.now(ZoneInfo(timezone))
    return now.strftime("%Y-%m-%d %H:%M:%S %Z")


@_register("summarize_text", "Краткое изложение текста")
def summarize_text(text: str, max_length: int = 200) -> str:
    if len(text) <= max_length:
        return text
    return text[:max_length].rsplit(" ", 1)[0] + "..."


@_register("translate_text", "Перевод текста (симуляция)")
def translate_text(text: str, target_lang: str = "en") -> str:
    return f"[Перевод на {target_lang.upper()}]: {text}"


@_register("analyze_sentiment", "Анализ тональности")
def analyze_sentiment(text: str) -> Dict:
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


@_register("chat_with_deepseek", "Отправляет запрос к DeepSeek API и возвращает ответ")
async def chat_with_deepseek(
    prompt: str,
    system_prompt: str = "Ты полезный AI-ассистент. Отвечай кратко и по делу.",
    temperature: float = 0.7,
    max_tokens: int = 1024,
    model: str = "deepseek-chat",
) -> Dict:
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
        return {"status": "error", "model": model, "prompt": prompt, "error": str(e)}


# ====================== МЕТА-ИНСТРУМЕНТЫ (только они видны в MCP) ======================


def _format_tool_info(name: str, info: dict) -> dict:
    return {
        "name": info["name"],
        "description": info["description"],
        "parameters": info["parameters"],
    }


@mcp.tool
def search_tools(query: str = "", limit: int = 20) -> List[Dict]:
    """
    Поиск инструментов по названию или описанию.
    Возвращает название, описание и схему параметров для каждого найденного инструмента.
    """
    q = query.lower().strip()
    results = []
    for name, info in _internal_tools.items():
        if not q or q in name.lower() or q in (info["description"] or "").lower():
            results.append(_format_tool_info(name, info))
            if len(results) >= limit:
                break
    return results


@mcp.tool
def run_tool(tool_name: str, arguments: Dict[str, Any]) -> Any:
    """
    Универсальный запуск любого инструмента по имени.
    Предварительно используй search_tools чтобы узнать какие инструменты есть и какие у них параметры.
    """
    info = _internal_tools.get(tool_name)
    if info is None:
        available = list(_internal_tools.keys())
        return {
            "error": f"Инструмент '{tool_name}' не найден",
            "available_tools": available[:15],
        }

    try:
        fn = info["fn"]
        if asyncio.iscoroutinefunction(fn):
            # Если мы внутри event loop — нельзя asyncio.run()
            try:
                loop = asyncio.get_running_loop()
            except RuntimeError:
                loop = None

            if loop is None:
                result = asyncio.run(fn(**arguments))
            else:
                # Мы внутри event loop (например, тест), создаём задачу и ждём
                with concurrent.futures.ThreadPoolExecutor() as pool:
                    result = pool.submit(asyncio.run, fn(**arguments)).result()
        else:
            result = fn(**arguments)
        return {"tool": tool_name, "input": arguments, "result": result, "status": "success"}
    except Exception as e:
        return {"tool": tool_name, "status": "error", "error": str(e)}

# ====================== ТЕСТ-РАННЕР ======================


async def run_all_tests():
    """Демонстрирует работу мета-инструментов: search_tools → run_tool."""

    sep = "=" * 60
    print(f"\n{sep}")
    print("  🧪 MetaTools Pro — ТЕСТ МЕТА-ИНСТРУМЕНТОВ")
    print(f"  Всего в реестре: {len(_internal_tools)} инструментов")
    print(f"  В MCP видны:     search_tools, run_tool")
    print(f"{sep}\n")

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
        print(f'│  1. search_tools("{s["search_query"]}")')
        try:
            found = search_tools(query=s["search_query"])
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
        print(f'│  2. run_tool("{s["run_tool"]}", {json.dumps(s["run_args"], ensure_ascii=False)})')
        try:
            result = run_tool(tool_name=s["run_tool"], arguments=s["run_args"])
            output = json.dumps(result, indent=6, ensure_ascii=False)
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
    if "--test" in sys.argv:
        asyncio.run(run_all_tests())
    elif "--stdio" in sys.argv:
        mcp.run(transport="stdio", show_banner=False)
    else:
        print("🚀 MetaTools Pro MCP Server запущен")
        print(f"Инструментов в реестре: {len(_internal_tools)}")
        print(f"  • search_tools (MCP)")
        print(f"  • run_tool (MCP)")
        print(f"  + {len(_internal_tools)} динамических (через search/run)")
        print("Готов к подключению...")
        print("  --test  для мини-теста")
        print("  --stdio для OMP/Claude Desktop")
        mcp.run(transport="sse", port=8000, host="127.0.0.1")

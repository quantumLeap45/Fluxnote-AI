"""Lightweight async database client for Supabase PostgREST API.

Replaces supabase-py to eliminate httpx/postgrest-py version incompatibilities
in Vercel's Python 3.12 serverless runtime. Pure httpx — zero extra deps.
"""
from typing import Any, Optional
import httpx
from app.config import settings


class DBResult:
    def __init__(self, data: list, count: Optional[int] = None):
        self.data = data
        self.count = count


class DBQuery:
    def __init__(self, table: str):
        self._table = table
        self._select_cols = "*"
        self._filters: dict[str, str] = {}
        self._order_field: Optional[str] = None
        self._order_desc: bool = False
        self._limit: Optional[int] = None
        self._count_mode: Optional[str] = None
        self._op = "select"
        self._data: Optional[Any] = None

    def select(self, columns: str = "*", count: Optional[str] = None) -> "DBQuery":
        self._select_cols = columns
        self._count_mode = count
        return self

    def eq(self, field: str, value: Any) -> "DBQuery":
        self._filters[field] = f"eq.{value}"
        return self

    def in_(self, field: str, values: list) -> "DBQuery":
        self._filters[field] = f"in.({','.join(str(v) for v in values)})"
        return self

    def order(self, field: str, desc: bool = False) -> "DBQuery":
        self._order_field = field
        self._order_desc = desc
        return self

    def limit(self, n: int) -> "DBQuery":
        self._limit = n
        return self

    def insert(self, data: dict) -> "DBQuery":
        self._op = "insert"
        self._data = data
        return self

    def update(self, data: dict) -> "DBQuery":
        self._op = "update"
        self._data = data
        return self

    def delete(self) -> "DBQuery":
        self._op = "delete"
        return self

    def _base_url(self) -> str:
        return f"{settings.SUPABASE_URL}/rest/v1/{self._table}"

    def _headers(self) -> dict:
        return {
            "apikey": settings.SUPABASE_KEY,
            "Authorization": f"Bearer {settings.SUPABASE_KEY}",
            "Content-Type": "application/json",
        }

    async def execute(self) -> DBResult:
        url = self._base_url()
        headers = self._headers()
        async with httpx.AsyncClient(timeout=30) as client:
            if self._op == "select":
                return await self._do_select(client, url, headers)
            if self._op == "insert":
                return await self._do_insert(client, url, headers)
            if self._op == "update":
                return await self._do_update(client, url, headers)
            return await self._do_delete(client, url, headers)

    async def _do_select(self, client, url, headers):
        params: dict[str, str] = {"select": self._select_cols}
        params.update(self._filters)
        if self._order_field:
            direction = "desc" if self._order_desc else "asc"
            params["order"] = f"{self._order_field}.{direction}"
        if self._limit:
            params["limit"] = str(self._limit)
        h = dict(headers)
        if self._count_mode == "exact":
            h["Prefer"] = "count=exact"
        resp = await client.get(url, headers=h, params=params)
        resp.raise_for_status()
        data = resp.json()
        count = None
        if self._count_mode == "exact":
            cr = resp.headers.get("content-range", "*/0")
            try:
                count = int(cr.split("/")[-1])
            except (ValueError, IndexError):
                count = len(data) if isinstance(data, list) else 0
        return DBResult(data=data if isinstance(data, list) else [data], count=count)

    async def _do_insert(self, client, url, headers):
        h = {**headers, "Prefer": "return=representation"}
        resp = await client.post(url, headers=h, json=self._data)
        resp.raise_for_status()
        result = resp.json()
        return DBResult(data=result if isinstance(result, list) else [result])

    async def _do_update(self, client, url, headers):
        h = {**headers, "Prefer": "return=representation"}
        resp = await client.patch(url, headers=h, params=self._filters, json=self._data)
        resp.raise_for_status()
        result = resp.json()
        return DBResult(data=result if isinstance(result, list) else [result])

    async def _do_delete(self, client, url, headers):
        resp = await client.delete(url, headers=headers, params=self._filters)
        resp.raise_for_status()
        return DBResult(data=[])


def table(name: str) -> DBQuery:
    """Entry point: await table('name').select().eq('field', val).execute()"""
    return DBQuery(name)

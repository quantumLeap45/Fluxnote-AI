import pytest

# Run async tests with asyncio only (not trio) since the codebase uses asyncio primitives
@pytest.fixture(params=["asyncio"])
def anyio_backend(request):
    return request.param

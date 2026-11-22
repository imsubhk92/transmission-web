FROM node:24-alpine AS frontend
WORKDIR /build
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM ghcr.io/astral-sh/uv:0.13.8 AS uv

FROM python:3.13-slim
COPY --from=uv /uv /usr/local/bin/uv
WORKDIR /app/backend
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen --no-dev --no-cache
COPY backend/app ./app
COPY --from=frontend /build/dist /app/frontend/dist
RUN groupadd --gid 1000 streamline && useradd --uid 1000 --gid 1000 --no-create-home streamline
USER streamline
ENV PATH="/app/backend/.venv/bin:$PATH" PYTHONUNBUFFERED=1
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]

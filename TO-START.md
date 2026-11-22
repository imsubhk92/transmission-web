With Docker Desktop running, start the full application:

```bash
cd /Users/zubhxk/Projects/transmission-web
docker compose up --build -d
```

Open:

- **Application:** http://localhost:8000
- **API docs:** http://localhost:8000/docs

Check status and logs:

```bash
docker compose ps
docker compose logs -f app transmission
```

Stop the application while preserving downloads and configuration:

```bash
docker compose down
```
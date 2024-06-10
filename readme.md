# Docker

```
docker build -t co2-backend -f Dockerfile.dev .
docker run -d -p 3000:3000 co2-backend
```

Or use `docker-compose`:

```
docker-compose up --build
```

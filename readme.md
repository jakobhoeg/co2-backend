
# Video af kørende Flutter app (på Android)

https://github.com/jakobhoeg/co2-backend/assets/114422072/490c9f81-67ac-4b6f-b096-9ce5dfbce5a8 

# Video af Push Notifikation implementering

https://github.com/jakobhoeg/co2-backend/assets/114422072/20223287-7423-4418-8a4b-a58fdefe2ff3

# Docker

```
docker build -t co2-backend -f Dockerfile.dev .
docker run -d -p 3000:3000 co2-backend
```

Or use `docker-compose`:

```
docker-compose up --build
```

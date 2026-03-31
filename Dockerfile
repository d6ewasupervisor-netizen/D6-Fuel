FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
RUN apt-get update && apt-get install -y sqlite3 && rm -rf /var/lib/apt/lists/*

COPY . .

RUN chmod +x start.sh

ENV PORT=8000
EXPOSE 8000

CMD ["./start.sh"]

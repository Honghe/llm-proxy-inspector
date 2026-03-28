FROM python:3.12-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY proxy.py README.md LICENSE ./
COPY static ./static

RUN mkdir -p /app/data

EXPOSE 7654 7655

CMD ["python", "proxy.py"]

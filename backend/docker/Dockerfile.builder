FROM pytorch/pytorch:2.4.1-cuda12.1-cudnn9-runtime

WORKDIR /app

COPY requirements/requirements-builder.txt ./requirements-builder.txt
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir -r requirements-builder.txt

COPY src ./src
COPY model_loader.py ./model_loader.py

ENV PYTHONPATH=/app \
    PYTHONUNBUFFERED=1 \
    HF_HUB_ENABLE_HF_TRANSFER=1

CMD ["python", "-m", "src.builder.handler"]
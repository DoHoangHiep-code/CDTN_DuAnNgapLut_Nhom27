# AQUAALERT – AI Microservice

## Cài đặt
```bash
cd ai_service
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
```

## Chạy
```bash
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

## Kiểm tra
```bash
curl -X POST http://localhost:8000/api/predict \
  -H "Content-Type: application/json" \
  -d '{"station_id":48900,"year":2024,"month":9,"day":15,"hour":14,"temp":31.5,"rhum":85.0,"prcp":45.2,"wspd":22.0,"pres":1008.5}'
```

## ⚠️ Feature Order – PHẢI kiểm tra trước khi deploy
Mở `main.py` và tìm `FEATURE_ORDER`. Đối chiếu với cột `X_train` trong notebook training.
Sau khi service khởi động, log sẽ in `model.feature_names_` – dùng list đó để điền vào `FEATURE_ORDER`.

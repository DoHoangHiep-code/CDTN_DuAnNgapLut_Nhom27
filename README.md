# Flood Prediction System - Huong dan chay du an cho nguoi moi

Tai lieu nay huong dan tu A den Z de ban co the chay duoc he thong web du bao ngap lut tren may Windows, ke ca khi ban chua quen dung Terminal.

## 1) Tong quan cau truc du an

Du an gom 2 phan chinh:

- `backend`: API Node.js + Express + Sequelize + PostgreSQL/PostGIS
- `flood-prediction-frontend/flood-prediction-system-ui`: giao dien React + Vite + Tailwind

## 2) Can cai gi truoc?

Hay cai cac cong cu sau:

1. **Node.js LTS** (khuyen nghi 20.x hoac moi hon)  
   Kiem tra sau khi cai:
   - `node -v`
   - `npm -v`

2. **PostgreSQL** (khuyen nghi 15+)

3. **(Tuy chon) pgAdmin** de tao database bang giao dien

4. **Git** (neu can clone/pull code)

## 3) Mo Terminal dung cach (cho nguoi moi)

Co 2 cach de mo:

- Cach 1: Mo Cursor/VSCode, mo thu muc du an, mo Terminal trong editor.
- Cach 2: Mo PowerShell, sau do di chuyen vao thu muc du an:

```powershell
cd "d:\CDTN_DuDoanNgapLut-master"
```

## 4) Chuan bi Database PostgreSQL

### 4.1 Tao database

Ban can tao database ten:

- `flood_prediction_db`

Neu dung pgAdmin: tao database bang giao dien.  
Neu dung psql:

```sql
CREATE DATABASE flood_prediction_db;
```

### 4.2 Cau hinh ket noi database cho backend

Backend doc bien moi truong qua `backend/src/db/config.js` (co gia tri mac dinh):

- `DB_USER` (mac dinh: `postgres`)
- `DB_PASSWORD` (mac dinh: `123456`)
- `DB_NAME` (mac dinh: `flood_prediction_db`)
- `DB_HOST` (mac dinh: `127.0.0.1`)
- `DB_PORT` (mac dinh: `5432`)

Ban co the tao file `.env` trong thu muc `backend` de ghi de:

```env
DB_USER=postgres
DB_PASSWORD=123456
DB_NAME=flood_prediction_db
DB_HOST=127.0.0.1
DB_PORT=5432
PORT=3002
JWT_SECRET=dev_secret_change_me
```

## 5) Chay Backend (API)

### 5.1 Cai thu vien backend

```powershell
cd "d:\CDTN_DuDoanNgapLut-master\backend"
npm install
```

### 5.2 Chay migration tao bang

```powershell
npm run db:migrate
```

### 5.3 Day du lieu mau (seed)

```powershell
npm run seed
```

> Buoc nay se tao du lieu nguoi dung, du lieu thoi tiet, du bao ngap, report mau...

### 5.4 Khoi dong backend

```powershell
npm start
```

Backend mac dinh chay o:

- `http://localhost:3002`
- Health check: `http://localhost:3002/health`

## 6) Chay Frontend (web)

Mo Terminal moi:

```powershell
cd "d:\CDTN_DuDoanNgapLut-master\flood-prediction-frontend\flood-prediction-system-ui"
npm install
npm run dev
```

Frontend mac dinh:

- `http://localhost:5173`

## 6.1) Chay AI Model service (bat buoc neu muon du bao that)

Du an co microservice AI rieng trong thu muc `ai_service`.  
Neu khong chay service nay, backend se khong goi duoc model de du bao ngap.

### Buoc 1: Cai thu vien AI service

Mo Terminal moi:

```powershell
cd "d:\CDTN_DuDoanNgapLut-master\ai_service"
python -m venv venv
.\venv\Scripts\activate
pip install -r requirements.txt
```

> Neu may ban dung Linux/macOS thi lenh kich hoat venv se khac.

### Buoc 2: Chay AI service

```powershell
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

AI service mac dinh:

- `http://localhost:8000`
- API predict: `POST /api/predict`
- API predict batch: `POST /api/predict/batch`

### Buoc 3: Cau hinh backend tro den AI service

Trong file `.env` cua backend (neu co), them:

```env
AI_SERVICE_URL=http://localhost:8000
```

Neu khong set, backend tu dung mac dinh `http://localhost:8000`.

### Buoc 4: Day du bao tu AI vao database

Sau khi backend + AI service + database da chay, mo terminal backend va chay:

```powershell
cd "d:\CDTN_DuDoanNgapLut-master\backend"
npm run predict
```

Lenh nay se:

- Lay feature thoi tiet theo tung node
- Goi AI service de du bao do ngap
- Luu ket qua vao bang `flood_predictions`

Neu thanh cong, terminal se in danh sach node va muc du bao.

## 7) Cau hinh frontend goi dung backend that

Kiem tra file:

- `flood-prediction-frontend/flood-prediction-system-ui/.env`

Noi dung can co:

```env
VITE_USE_MOCKS=false
VITE_API_BASE_URL=http://localhost:3002/api/v1
```

## 8) Tai khoan dang nhap duoc tao tu seed

Sau khi chay `npm run seed`, co the dang nhap:

- Admin: mat khau `Admin@123`
- Expert: mat khau `Expert@123`
- User: mat khau `User@123`

> Neu trang login dung truong email, hay chon tai khoan seed tu bang `users` trong database.

## 9) Luong chay nhanh (tom tat 1 lanh)

### Terminal 1 - Backend

```powershell
cd "d:\CDTN_DuDoanNgapLut-master\backend"
npm install
npm run db:migrate
npm run seed
npm start
```

### Terminal 2 - Frontend

```powershell
cd "d:\CDTN_DuDoanNgapLut-master\flood-prediction-frontend\flood-prediction-system-ui"
npm install
npm run dev
```

### Terminal 3 - AI service

```powershell
cd "d:\CDTN_DuDoanNgapLut-master\ai_service"
python -m venv venv
.\venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

### Terminal 4 - Day du bao vao DB (khi can)

```powershell
cd "d:\CDTN_DuDoanNgapLut-master\backend"
npm run predict
```

Sau do mo trinh duyet: `http://localhost:5173`

## 10) Loi thuong gap va cach xu ly

### Loi 1: `EADDRINUSE` (port da duoc dung)

- Y nghia: port 3002 (backend) hoac 5173 (frontend) da co tien trinh khac chiem.
- Cach xu ly:

```powershell
netstat -ano | findstr ":3002"
Stop-Process -Id <PID> -Force
```

Lam tuong tu voi port 5173 neu can.

### Loi 2: Dang nhap that bai du da seed

- Kiem tra da chay lai seed chua: `npm run seed`
- Kiem tra backend co dang chay khong
- Kiem tra frontend `.env` da tro dung `VITE_API_BASE_URL`

### Loi 3: Frontend bao 404 API

- Kiem tra backend co mount route dung `/api/v1/...`
- Kiem tra `.env` frontend
- Kiem tra backend dang chay dung port

### Loi 4: Migration loi vi extension DB

- Dam bao PostgreSQL dang hoat dong
- Dam bao user DB co quyen tao bang/index
- Chay lai: `npm run db:migrate`

### Loi 5: Chay `npm run predict` bao loi ket noi AI service

- Kiem tra AI service da chay chua (port 8000)
- Kiem tra bien `AI_SERVICE_URL` trong backend
- Kiem tra endpoint AI:
  - `http://localhost:8000/api/predict`
  - `http://localhost:8000/api/predict/batch`

## 11) Lenh huu ich

Trong `backend`:

- `npm run db:migrate` - chay migration
- `npm run db:migrate:undo` - rollback 1 migration
- `npm run db:migrate:undo:all` - rollback tat ca migration
- `npm run seed` - day du lieu mau
- `npm run predict` - goi AI model va luu du bao vao bang `flood_predictions`
- `npm start` - chay server API

Trong `flood-prediction-system-ui`:

- `npm run dev` - chay web local
- `npm run build` - build production
- `npm run preview` - preview ban build

## 12) Goi y cho nguoi moi

- Luon mo **2 Terminal**: 1 cho backend, 1 cho frontend.
- Moi khi sua `.env`, hay **tat va chay lai** process de nhan bien moi.
- Neu bi loi, doc ky dong loi dau tien trong Terminal (thuong la nguyen nhan that).

---

Neu ban muon, minh co the viet them ban **README co hinh minh hoa** (step-by-step co screenshot) de nguoi moi trong team de theo doi hon.

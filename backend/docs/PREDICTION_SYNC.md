# Sincronização de Predictions com Weather Measurements

## Visão Geral

Este documento descreve o sistema de sincronização entre `flood_predictions` e `weather_measurements`. O objetivo é garantir que **toda weather_measurement tem uma correspondente flood_prediction**.

## Estrutura

### Tabelas
- **weather_measurements**: Coleta de dados climáticos reais/simulados
  - Campos: node_id, time, temp, rhum, prcp, prcp_3h, prcp_6h, prcp_12h, prcp_24h, wspd, pres, etc.
  - Primary key: (node_id, time)

- **flood_predictions**: Duraçóes de inundação previstas por AI
  - Campos: node_id, time, flood_depth_cm, risk_level, explanation
  - Primary key: (node_id, time)

- **grid_nodes**: Metadados geográficos dos pontos
  - Campos: node_id, latitude, longitude, elevation, slope, impervious_ratio, etc.

## Ferramentas & Scripts

### 1. Verificar Gaps

**Comando:**
```bash
cd backend
npm run check-gaps
```

**Saída:**
- Total de weather records
- Total de prediction records
- Número de gaps encontrados
- Amostra dos gaps
- Estatísticas por data e por node

**Exemplo de saída:**
```
🔍 Verificando gaps entre weather_measurements e flood_predictions...

📊 Total weather records: 5320
📊 Total prediction records: 5100

❌ Records com gap (weather sem prediction): 220

📋 Amostra dos 10 primeiros gaps:

1. Node 1234 (Trung Hòa - Nhân Chính) @ 2026-05-03T10:00:00Z
2. Node 5678 (Ba Đình) @ 2026-05-03T09:30:00Z
...

📅 Gaps por data:

  2026-05-03: 150 gaps
  2026-05-02: 70 gaps

🔴 Top 10 nodes com mais gaps:

  Node 1234 (Trung Hòa): 45 gaps
  Node 5678 (Ba Đình): 30 gaps
  ...
```

### 2. Preencher Gaps

**Comando básico:**
```bash
cd backend
npm run fill-gaps
```

**Comando em batch mode (mais rápido):**
```bash
cd backend
npm run fill-gaps:batch
```

**Opções avançadas:**
```bash
# Processar apenas 100 records
node scripts/fill_missing_predictions.js --limit=100

# Processar apenas um node
node scripts/fill_missing_predictions.js --node-id=1234

# Processar apenas uma data
node scripts/fill_missing_predictions.js --date=2026-05-03

# Combinar opções
node scripts/fill_missing_predictions.js --limit=500 --date=2026-05-03 --batch
```

**Saída:**
```
🔄 Fill missing predictions
Parameters: limit=100, nodeId=null, date=null, batch=true

📊 Encontrados 100 gaps para processar

📦 Processando em batch mode (100 registros)...
  ⏳ Processados: 10/100
  ⏳ Processados: 20/100
  ...
  ⏳ Processados: 100/100

✅ Resultado: 98/100 predictions criadas com sucesso!
```

### 3. API Endpoints

#### POST `/api/v1/flood-prediction/sync-with-weather`
Sincronizar predictions com weather (via API)

**Query params:**
- `limit`: Máximo de records a processar (padrão: 200, máx: 1000)
- `batch_size`: Tamanho do batch para AI (padrão: 20, máx: 100)

**Exemplo:**
```bash
curl -X POST \
  'http://localhost:3001/api/v1/flood-prediction/sync-with-weather?limit=500&batch_size=50'
```

**Resposta:**
```json
{
  "success": true,
  "data": {
    "processed": 500,
    "success": 495,
    "failed": 5,
    "gaps": 500
  }
}
```

#### GET `/api/v1/flood-prediction/validate-coverage`
Validar integridade de predictions vs weather

**Exemplo:**
```bash
curl http://localhost:3001/api/v1/flood-prediction/validate-coverage
```

**Resposta:**
```json
{
  "success": true,
  "data": {
    "weatherTotal": 5320,
    "predictionTotal": 5418,
    "gaps": 0,
    "coverage": "100.00%"
  }
}
```

## Fluxo de Sincronização

```
┌─────────────────────────────────────────┐
│ weather_measurements table              │
│ (node_id, time, features...)            │
└──────────────┬──────────────────────────┘
               │
               ├──→ LEFT JOIN flood_predictions
               │
               ├──→ Encontrar gaps
               │    (WHERE prediction_id IS NULL)
               │
               ├──→ Build AI features
               │
               ├──→ Chamar AI (batch ou individual)
               │
               ├──→ Receber (flood_depth_cm, risk_level)
               │
               └──→ INSERT/UPDATE flood_predictions
                    (node_id, time, depth, risk_level)
                    
│
└──→ Validar coverage (100% = completo)
```

## Cenários de Uso

### Cenário 1: Verificação inicial
```bash
npm run check-gaps
# Resultado: Mostra gaps existentes
```

### Cenário 2: Preenchimento de todos os gaps
```bash
npm run fill-gaps:batch
# Resultado: Todos os gaps preenchidos
```

### Cenário 3: Sincronização seletiva (data específica)
```bash
npm run check-gaps
# Vê que 2026-05-02 tem muitos gaps

node scripts/fill_missing_predictions.js --date=2026-05-02 --batch
# Preenche apenas gaps de 2026-05-02
```

### Cenário 4: API webhook
```javascript
// Backend pode chamar automaticamente
POST /api/v1/flood-prediction/sync-with-weather?limit=500

// Ou combinar com validation
GET /api/v1/flood-prediction/validate-coverage
POST /api/v1/flood-prediction/sync-with-weather (if coverage < 100%)
```

## Código-fonte

### PredictionService.js
- `syncPredictionsWithWeather(limit, batchSize)` - Sync method
- `validateCoverage()` - Coverage validation

### FloodPredictionController.js
- POST `/sync-with-weather` - API endpoint
- GET `/validate-coverage` - API endpoint

### Scripts
- `scripts/check_prediction_gaps.js` - Gap checker
- `scripts/fill_missing_predictions.js` - Gap filler

## Otimizações

### Para melhorar performance:
1. **Batch processing**: Processar 20-50 records de uma vez
2. **Índices**: Certifique-se que (node_id, time) tem índice
3. **Limites**: Use `--limit` para processamento incremental
4. **Horário baixo**: Execute sync fora de picos de uso

### Queries de validação
```sql
-- Verificar total de gaps
SELECT COUNT(DISTINCT (w.node_id, w.time)) as gaps
FROM weather_measurements w
LEFT JOIN flood_predictions fp ON w.node_id = fp.node_id AND w.time = fp.time
WHERE fp.prediction_id IS NULL;

-- Verificar coverage percentage
SELECT 
  COUNT(*) as weather_total,
  COUNT(fp.prediction_id) as prediction_count,
  ROUND(COUNT(fp.prediction_id)::FLOAT / COUNT(*) * 100, 2) as coverage_pct
FROM weather_measurements w
LEFT JOIN flood_predictions fp ON w.node_id = fp.node_id AND w.time = fp.time;

-- Ver gaps por data
SELECT 
  DATE(w.time),
  COUNT(*) as gap_count
FROM weather_measurements w
LEFT JOIN flood_predictions fp ON w.node_id = fp.node_id AND w.time = fp.time
WHERE fp.prediction_id IS NULL
GROUP BY DATE(w.time)
ORDER BY DATE(w.time) DESC;
```

## Troubleshooting

### Problema: AI service não responde
**Solução**: Verificar se uvicorn está rodando
```bash
ps aux | grep uvicorn
# Se não estiver, iniciar:
cd ai_service
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

### Problema: Muitos gaps ainda após sync
**Solução**: Aumentar limit e rodar novamente
```bash
node scripts/fill_missing_predictions.js --limit=1000 --batch
```

### Problema: Alguns records com AI failures
**Solução**: Usar mode individual para debug
```bash
node scripts/fill_missing_predictions.js --limit=50
# Sem --batch, tém mais logging
```

## Próximos passos

1. ✅ Implementar scripts de check e fill
2. ✅ Adicionar API endpoints
3. ⏳ Implementar auto-sync em cronjob
4. ⏳ Adicionar alertas se coverage < 95%
5. ⏳ Dashboard de monitoring

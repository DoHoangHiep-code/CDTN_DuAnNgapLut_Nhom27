import urllib.request
import json
import traceback

def test_flood_model():
    url = 'http://localhost:8000/api/predict'
    payload = {
        "prcp": 25.0, "prcp_3h": 60.0, "prcp_6h": 90.0,
        "prcp_12h": 110.0, "prcp_24h": 130.0,
        "temp": 28.5, "rhum": 88.0, "wspd": 15.0,
        "pres": 1008.0, "pressure_change_24h": -2.5,
        "max_prcp_3h": 30.0, "max_prcp_6h": 45.0, "max_prcp_12h": 55.0,
        "elevation": 5.2, "slope": 1.5, "impervious_ratio": 0.72,
        "dist_to_drain_km": 0.3, "dist_to_river_km": 1.2,
        "dist_to_pump_km": 0.8, "dist_to_main_road_km": 0.15,
        "dist_to_park_km": 0.5,
        "hour": 14, "dayofweek": 2, "month": 9, "dayofyear": 258,
        "hour_sin": -0.5, "hour_cos": -0.866,
        "month_sin": -0.866, "month_cos": -0.5,
        "rainy_season_flag": 1
    }
    
    try:
        req = urllib.request.Request(url, data=json.dumps(payload).encode('utf-8'), headers={'Content-Type': 'application/json'})
        with urllib.request.urlopen(req) as response:
            result = json.loads(response.read().decode('utf-8'))
            print("Flood Prediction Response:", result)
            print("Flood Model API is working correctly.")
    except Exception as e:
        print("Flood Prediction Failed:")
        print(e)
        if hasattr(e, 'read'):
            print(e.read().decode('utf-8'))
        traceback.print_exc()

if __name__ == "__main__":
    test_flood_model()

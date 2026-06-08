import React, { useState } from 'react';
import { 
  CloudRain, 
  Droplets, 
  MapPin, 
  Mountain, 
  Leaf, 
  Layers, 
  RefreshCcw 
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardMeta } from '../components/common/Card';
import { Button } from '../components/common/Button';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';
import { LandslideMap, type LandslideMapRef } from '../features/landslide/components/LandslideMap';
import { LocationSearch, type NominatimResult } from '../components/LocationSearch';
import { getWeather7Days, getNearestLandslideNode } from '../services/api';



// Default data while loading
const defaultRainHistory = [
  { day: 'T2', mm: 0 },
  { day: 'T3', mm: 0 },
  { day: 'T4', mm: 0 },
  { day: 'T5', mm: 0 },
  { day: 'T6', mm: 0 },
  { day: 'T7', mm: 0 },
  { day: 'CN', mm: 0 },
];

export function WeatherTerrainPage() {
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [locationName, setLocationName] = useState('Hà Nội');
  const [currentCoords, setCurrentCoords] = useState({ lat: 21.0, lon: 105.0 });
  const [rainHistory, setRainHistory] = useState<{day: string, mm: number}[]>(defaultRainHistory);
  const [stats, setStats] = useState({ todayRain: 0, rain3Days: 0, rain7Days: 0, soilMoisture: 85 });
  const [terrain, setTerrain] = useState({ slope: 32, ndvi: 0.65, twi: 4.2, lulc: 'Rừng rậm', tpi: 0, tri: 0, roughness: 0, ndwi: 0, bsi: 0, riverDist: 0, roadDist: 0 });
  const mapRef = React.useRef<LandslideMapRef>(null);

  const fetchWeather = async (lat = 21.0, lon = 105.0) => {
    setLoading(true);
    try {
      const [weatherData, nodeData] = await Promise.all([
        getWeather7Days(lat, lon),
        getNearestLandslideNode(lat, lon).catch(() => null)
      ]);

      if (weatherData && weatherData.length > 0) {
        const days = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
        const mapped = weatherData.slice(0, 7).map((d: any) => {
          const date = new Date(d.dateIso);
          return {
            day: days[date.getDay()],
            mm: d.rainfallMm
          };
        });
        setRainHistory(mapped.reverse()); // Hiển thị từ quá khứ đến hiện tại nếu cần, hoặc giữ nguyên
      }

      let r1 = weatherData?.[0]?.rainfallMm || 0;
      let r3 = weatherData?.slice(0, 3).reduce((acc: number, cur: any) => acc + cur.rainfallMm, 0) || 0;
      let r7 = weatherData?.slice(0, 7).reduce((acc: number, cur: any) => acc + cur.rainfallMm, 0) || 0;
      let sm = 85;

      if (nodeData) {
        const ndvi = nodeData.ndvi ?? 0.65;
        const c = nodeData.lulc_class;
        let lulc = 'Không rõ';
        if (c !== null && c !== undefined) {
          const cNum = Number(c);
          if ([1, 2, 3, 4, 5].includes(cNum)) lulc = 'Rừng (Các loại)';
          else if ([6, 7, 8, 9, 10].includes(cNum)) lulc = 'Đất thưa / Cây bụi';
          else if ([11, 12, 14].includes(cNum)) lulc = 'Nông nghiệp / Đồng cỏ';
          else if ([13, 16, 17].includes(cNum)) lulc = 'Đô thị / Đất trống';
        } else {
          // fallback
          if (ndvi > 0.6) lulc = 'Rừng rậm';
          else if (ndvi > 0.3) lulc = 'Nông nghiệp / Cây bụi';
          else if (ndvi < 0) lulc = 'Mặt nước';
        }

        setTerrain({
          slope: nodeData.slope ?? 32,
          ndvi: ndvi,
          twi: nodeData.twi ?? 4.2,
          lulc: lulc,
          tpi: nodeData.tpi ?? 0,
          tri: nodeData.tri ?? 0,
          roughness: nodeData.roughness ?? 0,
          ndwi: nodeData.ndwi ?? 0,
          bsi: nodeData.bsi ?? 0,
          riverDist: (nodeData.dist_to_river_m ?? 50000) / 1000,
          roadDist: (nodeData.dist_to_road_m ?? 20000) / 1000,
        });
        
        r7 = nodeData.rain_7d_accum ?? r7;
        sm = nodeData.soil_moisture_1d ?? sm;

        if (nodeData.location_name) {
          setLocationName(nodeData.location_name);
        }
      }

      setStats({ todayRain: r1, rain3Days: r3, rain7Days: r7, soilMoisture: sm });

    } catch (e) {
      console.error('Fetch weather failed', e);
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => {
    fetchWeather();
  }, []);

  const handleRefresh = () => {
    fetchWeather(currentCoords.lat, currentCoords.lon);
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-2xl font-extrabold tracking-tight text-slate-900 dark:text-slate-100 flex items-center gap-2">
            Khí tượng & Địa hình {locationName && <span className="text-lg text-slate-500 font-medium">({locationName})</span>}
          </h2>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Dữ liệu động (thời tiết) và tĩnh (địa hình) phục vụ mô hình học máy sạt lở
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            leftIcon={<RefreshCcw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />}
            onClick={handleRefresh}
            disabled={loading}
          >
            Làm mới
          </Button>
        </div>
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        {/* Left Col (Dynamic + Static) */}
        <div className="flex flex-col gap-5 lg:col-span-5">
          {/* Dynamic Data */}
          <Card className="flex flex-col h-full">
            <CardHeader>
              <div>
                <CardTitle>Chỉ số Khí tượng (Động)</CardTitle>
                <CardMeta className="italic text-slate-400">
                  Cập nhật tự động: 2 lần/ngày (Nguồn: Open-Meteo)
                </CardMeta>
              </div>
            </CardHeader>
            <div className="grid grid-cols-2 gap-4 p-4 flex-1">
              <div className="flex flex-col items-center justify-center rounded-xl bg-sky-50 p-4 dark:bg-sky-900/20 border border-sky-100 dark:border-sky-800">
                <CloudRain className="h-6 w-6 text-sky-500 mb-2" />
                <span className="text-xs text-slate-500">Mưa hôm nay</span>
                <span className="text-xl font-bold text-sky-700 dark:text-sky-300">{stats.todayRain.toFixed(1)} mm</span>
              </div>
              <div className="flex flex-col items-center justify-center rounded-xl bg-blue-50 p-4 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800">
                <CloudRain className="h-6 w-6 text-blue-500 mb-2" />
                <span className="text-xs text-slate-500">Mưa 3 ngày qua</span>
                <span className="text-xl font-bold text-blue-700 dark:text-blue-300">{stats.rain3Days.toFixed(1)} mm</span>
              </div>
              <div className="flex flex-col items-center justify-center rounded-xl bg-indigo-50 p-4 dark:bg-indigo-900/20 border border-indigo-100 dark:border-indigo-800">
                <CloudRain className="h-6 w-6 text-indigo-500 mb-2" />
                <span className="text-xs text-slate-500">Mưa 7 ngày qua</span>
                <span className="text-xl font-bold text-indigo-700 dark:text-indigo-300">{stats.rain7Days.toFixed(1)} mm</span>
              </div>
              <div className="flex flex-col items-center justify-center rounded-xl bg-cyan-50 p-4 dark:bg-cyan-900/20 border border-cyan-100 dark:border-cyan-800">
                <Droplets className="h-6 w-6 text-cyan-500 mb-2" />
                <span className="text-xs text-slate-500">Độ ẩm đất</span>
                <span className="text-xl font-bold text-cyan-700 dark:text-cyan-300">{stats.soilMoisture}%</span>
              </div>
            </div>
          </Card>

          {/* Static Data */}
          <Card className="flex flex-col h-full">
            <CardHeader>
              <div>
                <CardTitle>Chỉ số Địa hình (Tĩnh)</CardTitle>
                <CardMeta className="italic text-slate-400">
                  Cập nhật từ vệ tinh: 1 tháng/lần (Nguồn: Landsat/MODIS)
                </CardMeta>
              </div>
            </CardHeader>
            <div className="grid grid-cols-2 gap-4 p-4 flex-1">
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-orange-100 p-2 dark:bg-orange-900/30">
                  <Mountain className="h-5 w-5 text-orange-600 dark:text-orange-400" />
                </div>
                <div>
                  <div className="text-xs text-slate-500">Độ dốc (Slope)</div>
                  <div className="text-lg font-bold text-slate-800 dark:text-slate-100">{terrain.slope.toFixed(1)}°</div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-emerald-100 p-2 dark:bg-emerald-900/30">
                  <Leaf className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                </div>
                <div>
                  <div className="text-xs text-slate-500">Độ phủ (NDVI)</div>
                  <div className="text-lg font-bold text-slate-800 dark:text-slate-100">{terrain.ndvi.toFixed(2)}</div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-amber-100 p-2 dark:bg-amber-900/30">
                  <MapPin className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                </div>
                <div>
                  <div className="text-xs text-slate-500">Chỉ số ĐH (TWI)</div>
                  <div className="text-lg font-bold text-slate-800 dark:text-slate-100">{terrain.twi.toFixed(2)}</div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-purple-100 p-2 dark:bg-purple-900/30">
                  <Layers className="h-5 w-5 text-purple-600 dark:text-purple-400" />
                </div>
                <div>
                  <div className="text-xs text-slate-500">Loại đất (LULC)</div>
                  <div className="text-sm font-bold text-slate-800 dark:text-slate-100">{terrain.lulc}</div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-rose-100 p-2 dark:bg-rose-900/30">
                  <Mountain className="h-5 w-5 text-rose-600 dark:text-rose-400" />
                </div>
                <div>
                  <div className="text-xs text-slate-500">Độ gồ ghề (Rough)</div>
                  <div className="text-lg font-bold text-slate-800 dark:text-slate-100">{terrain.roughness.toFixed(1)}</div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-blue-100 p-2 dark:bg-blue-900/30">
                  <Droplets className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                </div>
                <div>
                  <div className="text-xs text-slate-500">Nước/Độ ẩm (NDWI)</div>
                  <div className="text-lg font-bold text-slate-800 dark:text-slate-100">{terrain.ndwi.toFixed(2)}</div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-stone-100 p-2 dark:bg-stone-900/30">
                  <Layers className="h-5 w-5 text-stone-600 dark:text-stone-400" />
                </div>
                <div>
                  <div className="text-xs text-slate-500">Đất trống (BSI)</div>
                  <div className="text-lg font-bold text-slate-800 dark:text-slate-100">{terrain.bsi.toFixed(2)}</div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-teal-100 p-2 dark:bg-teal-900/30">
                  <MapPin className="h-5 w-5 text-teal-600 dark:text-teal-400" />
                </div>
                <div>
                  <div className="text-xs text-slate-500">Cách Sông / Đường</div>
                  <div className="text-sm font-bold text-slate-800 dark:text-slate-100">{terrain.riverDist.toFixed(1)}km / {terrain.roadDist.toFixed(1)}km</div>
                </div>
              </div>
            </div>
          </Card>
        </div>

        {/* Right Col (Map + Chart) */}
        <div className="flex flex-col gap-5 lg:col-span-7">
          <Card className="flex flex-col overflow-hidden h-[450px]">
            <CardHeader className="bg-white dark:bg-slate-900 z-10 border-b border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <CardTitle>Bản đồ Địa hình</CardTitle>
                <CardMeta>Mô hình số độ cao & sạt lở (DEM)</CardMeta>
              </div>
            </CardHeader>
            <div className="flex-1 relative z-0">
              {/* Overlay Search Bar on map */}
              <div className="absolute top-4 left-1/2 -translate-x-1/2 w-full max-w-sm px-4 z-[1000]">
                <LocationSearch
                  districts={[]} 
                  placeholder="Tìm kiếm vị trí trên bản đồ..."
                  value={searchQuery}
                  onChange={(v) => {
                    setSearchQuery(v);
                    if (!v.trim()) {
                      setCurrentCoords({ lat: 21.0, lon: 105.0 });
                      mapRef.current?.flyToWard(21.0, 105.0);
                      fetchWeather(21.0, 105.0);
                      setLocationName('Hà Nội');
                    }
                  }}
                  onFilterChange={() => {}}
                  onSelectGeoResult={(res: NominatimResult) => {
                    const lat = parseFloat(res.lat);
                    const lon = parseFloat(res.lon);
                    setCurrentCoords({ lat, lon });
                    mapRef.current?.flyToWard(lat, lon);
                    fetchWeather(lat, lon);
                  }}
                />
              </div>
              <LandslideMap mapRef={mapRef} tileStyle="terrain" hideHUD={true} hideDangerPoints={true} searchMarker={[currentCoords.lat, currentCoords.lon]} />
            </div>
          </Card>

          <Card>
            <CardHeader>
              <div>
                <CardTitle>Lịch sử Lượng mưa 7 ngày qua</CardTitle>
                <CardMeta>Dữ liệu lượng mưa theo ngày (mm)</CardMeta>
              </div>
            </CardHeader>
            <div className="h-48 p-2">
              <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1}>
                <BarChart data={rainHistory} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.2} vertical={false} />
                  <XAxis dataKey="day" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#1e293b', border: 'none', borderRadius: '8px', color: '#f8fafc' }}
                    itemStyle={{ fontSize: '13px', color: '#e2e8f0' }}
                  />
                  <Bar dataKey="mm" name="Lượng mưa (mm)" fill="#0ea5e9" radius={[4, 4, 0, 0]} barSize={30} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

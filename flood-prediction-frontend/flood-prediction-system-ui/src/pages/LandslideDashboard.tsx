import { useState, useEffect } from 'react';
import { RefreshCcw, CloudRain, Droplets, AlertTriangle, AlertCircle } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardMeta } from '../components/common/Card';
import { Button } from '../components/common/Button';
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts';
import { getLandslideDashboardStats } from '../services/api';

export function LandslideDashboardPage() {
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState<any>(null);

  const fetchStats = async () => {
    setLoading(true);
    try {
      const data = await getLandslideDashboardStats();
      setStats(data);
    } catch (e) {
      console.error('Failed to fetch landslide stats:', e);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchStats();
  }, []);

  const handleRefresh = () => {
    fetchStats();
  };

  if (!stats) {
    return (
      <div className="flex h-64 items-center justify-center">
        <RefreshCcw className="h-8 w-8 animate-spin text-slate-400" />
      </div>
    );
  }

  const riskRatioData = [
    { name: 'An toàn', value: stats.safe_count, color: '#10b981' },
    { name: 'Cảnh báo', value: stats.warning_count, color: '#f59e0b' },
    { name: 'Nguy hiểm', value: stats.danger_count, color: '#e11d48' },
  ].filter(d => d.value > 0);

  const combinedRainData: any[] = [];
  if (stats?.rain_trend) {
    stats.rain_trend.forEach((d: any) => combinedRainData.push({ day: d.day, past: d.mm }));
  }
  if (stats?.rain_forecast_3d && stats.rain_forecast_3d.length > 0) {
    if (stats.rain_trend && stats.rain_trend.length > 0) {
      const lastPast = stats.rain_trend[stats.rain_trend.length - 1];
      const existing = combinedRainData.find(d => d.day === lastPast.day);
      if (existing) existing.future = lastPast.mm;
    }
    stats.rain_forecast_3d.forEach((d: any) => combinedRainData.push({ day: d.day, future: d.mm }));
  }

  return (
    <div className="space-y-5">
      {/* --- Top Banner Pulse (Conditional) --- */}
      {stats.danger_count > 0 && (
        <div className="relative overflow-hidden rounded-xl bg-rose-600 px-6 py-4 shadow-lg">
          <div className="absolute inset-0 animate-pulse bg-rose-500/50" />
          <div className="relative flex items-center gap-4">
            <div className="rounded-full bg-white/20 p-2">
              <AlertTriangle className="h-6 w-6 text-white" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-white">CẢNH BÁO KHẨN CẤP</h3>
              <p className="text-sm font-medium text-rose-100">
                Phát hiện {stats.danger_count.toLocaleString('vi-VN')} điểm có nguy cơ sạt lở RẤT CAO (Dành cho hôm nay). Vui lòng kiểm tra chi tiết!
              </p>
            </div>
          </div>
        </div>
      )}

      {/* --- Header --- */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-lg font-extrabold tracking-tight text-slate-900 dark:text-slate-100">
            Bảng điều khiển Sạt lở
          </h2>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Giám sát rủi ro trượt lở đất diện rộng theo thời gian thực (Dữ liệu mặc định hôm nay)
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

      {/* --- 4 Metric Cards --- */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <div className="flex items-center gap-4 p-4">
            <div className="rounded-xl bg-sky-100 p-3 dark:bg-sky-900/30">
              <CloudRain className="h-6 w-6 text-sky-600 dark:text-sky-400" />
            </div>
            <div>
              <p className="text-sm font-medium text-slate-500 dark:text-slate-400">Mưa tích lũy 7 ngày</p>
              <h4 className="text-2xl font-bold text-slate-900 dark:text-slate-100">{stats.rain_7d_accum_avg} <span className="text-sm font-normal text-slate-500">mm</span></h4>
            </div>
          </div>
        </Card>
        
        <Card>
          <div className="flex items-center gap-4 p-4">
            <div className="rounded-xl bg-indigo-100 p-3 dark:bg-indigo-900/30">
              <Droplets className="h-6 w-6 text-indigo-600 dark:text-indigo-400" />
            </div>
            <div>
              <p className="text-sm font-medium text-slate-500 dark:text-slate-400">Độ ẩm đất trung bình</p>
              <h4 className="text-2xl font-bold text-slate-900 dark:text-slate-100">{stats.soil_moisture_avg} <span className="text-sm font-normal text-slate-500">%</span></h4>
            </div>
          </div>
        </Card>
        
        <Card>
          <div className="flex items-center gap-4 p-4">
            <div className="rounded-xl bg-rose-100 p-3 dark:bg-rose-900/30">
              <AlertTriangle className="h-6 w-6 text-rose-600 dark:text-rose-400" />
            </div>
            <div>
              <p className="text-sm font-medium text-slate-500 dark:text-slate-400">Số điểm NGUY HIỂM</p>
              <h4 className="text-2xl font-bold text-rose-600 dark:text-rose-400">{stats.danger_count.toLocaleString('vi-VN')}</h4>
            </div>
          </div>
        </Card>
        
        <Card>
          <div className="flex items-center gap-4 p-4">
            <div className="rounded-xl bg-amber-100 p-3 dark:bg-amber-900/30">
              <AlertCircle className="h-6 w-6 text-amber-600 dark:text-amber-400" />
            </div>
            <div>
              <p className="text-sm font-medium text-slate-500 dark:text-slate-400">Số điểm CẢNH BÁO</p>
              <h4 className="text-2xl font-bold text-amber-600 dark:text-amber-400">{stats.warning_count.toLocaleString('vi-VN')}</h4>
            </div>
          </div>
        </Card>
      </div>

      {/* --- Charts --- */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Left: Bar Chart */}
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Top Tỉnh/Huyện rủi ro cao nhất</CardTitle>
              <CardMeta>Số lượng điểm có nguy cơ sạt lở</CardMeta>
            </div>
          </CardHeader>
          <div className="h-64 p-2">
            {stats.top_provinces && stats.top_provinces.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1}>
                <BarChart data={stats.top_provinces} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.2} vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#1e293b', border: 'none', borderRadius: '8px', color: '#f8fafc' }}
                    itemStyle={{ fontSize: '13px', color: '#e2e8f0' }}
                  />
                  <Legend iconType="circle" wrapperStyle={{ fontSize: '12px' }} />
                  <Bar dataKey="danger" name="Nguy hiểm" fill="#e11d48" radius={[4, 4, 0, 0]} barSize={20} />
                  <Bar dataKey="warning" name="Cảnh báo" fill="#f59e0b" radius={[4, 4, 0, 0]} barSize={20} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-slate-500">
                Chưa có dữ liệu rủi ro
              </div>
            )}
          </div>
        </Card>

        {/* Middle: Line Chart */}
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Xu hướng Mưa tích lũy (Quá khứ & Tương lai)</CardTitle>
              <CardMeta>API7d (Antecedent Precipitation Index)</CardMeta>
            </div>
          </CardHeader>
          <div className="h-64 p-2">
            {combinedRainData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1}>
                <LineChart data={combinedRainData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.2} vertical={false} />
                  <XAxis dataKey="day" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#1e293b', border: 'none', borderRadius: '8px', color: '#f8fafc' }}
                    itemStyle={{ fontSize: '13px', color: '#e2e8f0' }}
                  />
                  <Legend iconType="circle" wrapperStyle={{ fontSize: '12px' }} />
                  <Line type="monotone" dataKey="past" name="Quá khứ (mm)" stroke="#0ea5e9" strokeWidth={3} dot={{ r: 4, fill: '#0ea5e9', strokeWidth: 2 }} activeDot={{ r: 6 }} />
                  <Line type="monotone" dataKey="future" name="Dự báo (mm)" stroke="#8b5cf6" strokeDasharray="5 5" strokeWidth={3} dot={{ r: 4, fill: '#8b5cf6', strokeWidth: 2 }} activeDot={{ r: 6 }} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-slate-500">
                Chưa có dữ liệu lượng mưa
              </div>
            )}
          </div>
        </Card>

        {/* Right: Doughnut Chart */}
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Tỷ lệ mức độ rủi ro</CardTitle>
              <CardMeta>An toàn / Cảnh báo / Nguy hiểm</CardMeta>
            </div>
          </CardHeader>
          <div className="h-64 p-2">
            {riskRatioData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1}>
                <PieChart>
                  <Pie
                    data={riskRatioData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={80}
                    paddingAngle={5}
                    dataKey="value"
                    stroke="none"
                  >
                    {riskRatioData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#1e293b', border: 'none', borderRadius: '8px', color: '#f8fafc' }}
                    itemStyle={{ fontSize: '13px', color: '#e2e8f0' }}
                  />
                  <Legend iconType="circle" wrapperStyle={{ fontSize: '12px' }} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-slate-500">
                Chưa có dữ liệu
              </div>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

import React, { useState, useMemo, useEffect } from 'react';
import { 
  FileText, Download, FileSpreadsheet, Search, Filter,
  MapPin, AlertTriangle, ShieldCheck, ChevronLeft, ChevronRight, Loader2
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '../utils/cn';
import { getLandslideHotspots, getLandslideDashboardStats } from '../services/api';
import type { LandslideNode } from '../services/api';

const LEVEL_COLORS: Record<string, string> = {
  'Nguy hiểm': 'bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-900/50 dark:text-rose-300 dark:border-rose-800',
  'Cảnh báo': 'bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-900/50 dark:text-orange-300 dark:border-orange-800',
  'An toàn': 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/50 dark:text-emerald-300 dark:border-emerald-800',
};

const RISK_MAP: Record<string, string> = {
  DANGER: 'Nguy hiểm',
  WARNING: 'Cảnh báo',
  SAFE: 'An toàn'
};

export function LandslideReportPage() {
  const { t } = useTranslation();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedProvince, setSelectedProvince] = useState('Tất cả');
  const [selectedLevel, setSelectedLevel] = useState('Tất cả');
  const [page, setPage] = useState(1);
  const itemsPerPage = 5;

  const [nodes, setNodes] = useState<LandslideNode[]>([]);
  const [totalNodes, setTotalNodes] = useState(425180);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadData() {
      setLoading(true);
      try {
        const [hotspotsData, statsData] = await Promise.all([
          getLandslideHotspots(500), // Get top 500 hotspots for the report
          getLandslideDashboardStats()
        ]);
        setNodes(hotspotsData);
        if (statsData?.totalNodes) {
          setTotalNodes(statsData.totalNodes);
        }
      } catch (err) {
        console.error('Error loading report data:', err);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

  const parsedData = useMemo(() => {
    return nodes.map(node => {
      // Tách location_name thành commune, district, province
      const parts = (node.location_name || '').split(',').map(p => p.trim());
      let commune = 'Chưa xác định', district = '', province = '';
      if (parts.length >= 3) {
        commune = parts[0];
        district = parts[1];
        province = parts.slice(2).join(', ');
      } else if (parts.length === 2) {
        commune = parts[0];
        province = parts[1];
      } else {
        commune = parts[0] || 'Khu vực';
      }

      return {
        id: node.id || Math.random().toString(),
        commune,
        district,
        province,
        lat: node.lat || 0,
        lon: (node as any).lon || node.lng || 0,
        rain7d: Math.round(node.rain_7d_accum || 0),
        probability: Number(((node.prob_landslide || 0) * 100).toFixed(2)),
        level: RISK_MAP[node.risk_level || 'SAFE'] || 'An toàn'
      };
    });
  }, [nodes]);

  const provinces = ['Tất cả', ...Array.from(new Set(parsedData.map(d => d.province).filter(Boolean)))];
  const levels = ['Tất cả', 'Nguy hiểm', 'Cảnh báo', 'An toàn'];

  const filteredData = useMemo(() => {
    return parsedData.filter(item => {
      const matchSearch = item.commune.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          item.district.toLowerCase().includes(searchTerm.toLowerCase());
      const matchProvince = selectedProvince === 'Tất cả' || item.province === selectedProvince;
      const matchLevel = selectedLevel === 'Tất cả' || item.level === selectedLevel;
      return matchSearch && matchProvince && matchLevel;
    });
  }, [parsedData, searchTerm, selectedProvince, selectedLevel]);

  const paginatedData = useMemo(() => {
    const start = (page - 1) * itemsPerPage;
    return filteredData.slice(start, start + itemsPerPage);
  }, [filteredData, page]);

  const totalPages = Math.ceil(filteredData.length / itemsPerPage) || 1;

  const topHotspots = [...parsedData].sort((a, b) => b.probability - a.probability).slice(0, 4);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-rose-500 to-red-600 shadow-lg shadow-rose-200 dark:shadow-rose-900/40">
            <FileText className="h-6 w-6 text-white" />
          </div>
          <div>
            <h2 className="text-xl font-extrabold tracking-tight text-slate-900 dark:text-slate-100">
              Báo cáo Sạt lở
            </h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Dữ liệu dự báo sạt lở lưới (Grid Nodes). Ngưỡng cảnh báo RẤT CAO của AI: &gt; 9%
            </p>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center p-12">
          <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
        </div>
      ) : (
        <>
          {/* Top Hotspots */}
          <div className="space-y-3">
            <h3 className="text-sm font-extrabold text-slate-800 dark:text-slate-100">Top Khu vực Rủi ro Cao</h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {topHotspots.map((item, idx) => (
                <div key={idx} className="relative flex flex-col overflow-hidden rounded-2xl border border-rose-400/80 bg-gradient-to-b from-rose-100 to-white shadow-rose-200/50 shadow-lg ring-2 ring-rose-300/50 dark:border-rose-600 dark:from-rose-900/40 dark:to-slate-900 p-4">
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <div className="text-sm font-bold text-slate-800 dark:text-slate-100">{item.commune}</div>
                      <div className="text-xs text-slate-500">{item.district ? `${item.district}, ${item.province}` : item.province}</div>
                    </div>
                    <div className="bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-300 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3" />
                      RẤT CAO
                    </div>
                  </div>
                  <div className="mt-2 text-3xl font-black text-rose-600 dark:text-rose-400 tabular-nums">
                    {item.probability.toFixed(2)}%
                  </div>
                </div>
              ))}
              {topHotspots.length === 0 && (
                <div className="col-span-full py-8 text-center text-sm text-slate-500">
                  Không có dữ liệu điểm nóng nào.
                </div>
              )}
            </div>
          </div>

          {/* Main Table Area */}
          <div className="grid grid-cols-12 gap-4">
            {/* Table Column */}
            <div className="col-span-12 lg:col-span-9 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
              <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-4 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="text-sm font-extrabold text-slate-900 dark:text-slate-100">
                    Dữ liệu Dự báo Điểm
                  </div>
                  <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                    Đang hiển thị {filteredData.length} điểm rủi ro / Tổng số {totalNodes.toLocaleString('vi-VN')} điểm
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 shadow-sm hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                    <Download className="h-3.5 w-3.5" /> CSV
                  </button>
                  <button type="button" className="flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 shadow-sm hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400">
                    <FileSpreadsheet className="h-3.5 w-3.5" /> Excel
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left whitespace-nowrap">
                  <thead className="bg-slate-50 dark:bg-slate-800/80">
                    <tr className="border-b border-slate-200 dark:border-slate-700">
                      <th className="px-4 py-3 text-[11px] font-bold uppercase text-slate-400">#</th>
                      <th className="px-4 py-3 text-[11px] font-bold uppercase text-slate-400">Khu Vực</th>
                      <th className="px-4 py-3 text-[11px] font-bold uppercase text-slate-400">Tọa độ</th>
                      <th className="px-4 py-3 text-[11px] font-bold uppercase text-slate-400">Mưa 7D</th>
                      <th className="px-4 py-3 text-[11px] font-bold uppercase text-slate-400">Xác Suất</th>
                      <th className="px-4 py-3 text-[11px] font-bold uppercase text-slate-400">Mức Độ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {paginatedData.map((item, idx) => (
                      <tr key={item.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/30">
                        <td className="px-4 py-3.5 text-xs font-bold text-slate-400">
                          {(page - 1) * itemsPerPage + idx + 1}
                        </td>
                        <td className="px-4 py-3.5">
                          <div className="flex items-center gap-2">
                            <MapPin className="h-4 w-4 text-slate-400" />
                            <div>
                              <div className="text-xs font-semibold text-slate-800 dark:text-slate-100">{item.commune}</div>
                              <div className="text-[10px] text-slate-500">{item.district ? `${item.district}, ${item.province}` : item.province}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3.5 text-xs text-slate-600 dark:text-slate-400 font-mono">
                          {item.lat.toFixed(4)}, {item.lon.toFixed(4)}
                        </td>
                        <td className="px-4 py-3.5 text-xs font-semibold text-blue-600 dark:text-blue-400">
                          {item.rain7d} mm
                        </td>
                        <td className="px-4 py-3.5 text-xs font-bold tabular-nums">
                          {item.probability.toFixed(2)}%
                        </td>
                        <td className="px-4 py-3.5">
                          <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold', LEVEL_COLORS[item.level])}>
                            {item.level === 'An toàn' ? <ShieldCheck className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
                            {item.level}
                          </span>
                        </td>
                      </tr>
                    ))}
                    {paginatedData.length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-4 py-8 text-center text-sm text-slate-500">
                          Không tìm thấy dữ liệu phù hợp
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 dark:border-slate-800">
                <button 
                  disabled={page <= 1} 
                  onClick={() => setPage(p => p - 1)}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300"
                >
                  <ChevronLeft className="h-4 w-4 inline" /> Trước
                </button>
                <span className="text-xs text-slate-500">Trang {page} / {totalPages}</span>
                <button 
                  disabled={page >= totalPages} 
                  onClick={() => setPage(p => p + 1)}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300"
                >
                  Tiếp <ChevronRight className="h-4 w-4 inline" />
                </button>
              </div>
            </div>

            {/* Filter Column */}
            <div className="col-span-12 lg:col-span-3 space-y-4">
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
                <div className="mb-4 flex items-center gap-2">
                  <Filter className="h-4 w-4 text-indigo-500" />
                  <h3 className="text-sm font-extrabold text-slate-800 dark:text-slate-100">Bộ lọc</h3>
                </div>
                
                <div className="space-y-4">
                  <div>
                    <label className="mb-1.5 block text-xs font-bold text-slate-600 dark:text-slate-400">
                      Tìm kiếm Khu vực
                    </label>
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      <input 
                        type="text" 
                        value={searchTerm}
                        onChange={(e) => { setSearchTerm(e.target.value); setPage(1); }}
                        placeholder="Nhập tên xã/huyện..." 
                        className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="mb-1.5 block text-xs font-bold text-slate-600 dark:text-slate-400">
                      Lọc theo Tỉnh
                    </label>
                    <select 
                      value={selectedProvince}
                      onChange={(e) => { setSelectedProvince(e.target.value); setPage(1); }}
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 px-3 text-sm outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    >
                      {provinces.map(p => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </div>

                  <div>
                    <label className="mb-1.5 block text-xs font-bold text-slate-600 dark:text-slate-400">
                      Lọc theo Mức độ
                    </label>
                    <select 
                      value={selectedLevel}
                      onChange={(e) => { setSelectedLevel(e.target.value); setPage(1); }}
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 px-3 text-sm outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    >
                      {levels.map(l => <option key={l} value={l}>{l}</option>)}
                    </select>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}


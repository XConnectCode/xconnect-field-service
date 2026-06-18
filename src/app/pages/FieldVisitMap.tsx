/**
 * FieldVisitMap.tsx
 * Drop in: src/app/pages/FieldVisitMap.tsx
 * Add route in routes.tsx: { path: '/field-visit-map', element: <FieldVisitMap /> }
 *
 * Uses Leaflet + OpenStreetMap (no API key required).
 * Loads Leaflet CSS/JS dynamically if not already present.
 */

import { useState, useEffect, useRef, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Label } from '../components/ui/label';
import { Badge } from '../components/ui/badge';
import { MapPin, Filter, X } from 'lucide-react';

// ── Purpose colors ────────────────────────────────────────────────────────────
const PURPOSE_COLORS: Record<string, string> = {
  'XFire Installation': '#22c55e',
  'Training':           '#3b82f6',
  'Incident':           '#ef4444',
  'Follow Up/Check Up': '#6366f1',
  'Impromptu':          '#f59e0b',
  'Delivery/Pickup':    '#14b8a6',
  'Sales':              '#a855f7',
  'R&D':                '#f97316',
};

const PURPOSE_OPTS = Object.keys(PURPOSE_COLORS);

// ── Parse "lat, lng" string → [lat, lng] numbers ─────────────────────────────
function parseLatLng(str: string | null): [number, number] | null {
  if (!str) return null;
  const parts = str.split(',').map(s => parseFloat(s.trim()));
  if (parts.length !== 2 || isNaN(parts[0]) || isNaN(parts[1])) return null;
  if (parts[0] < -90 || parts[0] > 90 || parts[1] < -180 || parts[1] > 180) return null;
  return [parts[0], parts[1]];
}

// ── Load Leaflet dynamically ──────────────────────────────────────────────────
function loadLeaflet(): Promise<any> {
  return new Promise((resolve, reject) => {
    if ((window as any).L) { resolve((window as any).L); return; }

    // CSS
    if (!document.querySelector('#leaflet-css')) {
      const link = document.createElement('link');
      link.id = 'leaflet-css';
      link.rel = 'stylesheet';
      link.href = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css';
      document.head.appendChild(link);
    }

    // JS
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js';
    script.onload = () => resolve((window as any).L);
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

export default function FieldVisitMap() {
  const mapRef      = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<any>(null);
  const markersLayer= useRef<any>(null);

  const [visits,    setVisits]    = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [leafletReady, setLeafletReady] = useState(false);

  // Filters
  const [filterCustomer, setFilterCustomer] = useState('');
  const [filterPurpose,  setFilterPurpose]  = useState('');

  // Selected visit popup
  const [selected, setSelected] = useState<any | null>(null);

  // ── Load Leaflet ──────────────────────────────────────────────────────────
  useEffect(() => {
    loadLeaflet().then(() => setLeafletReady(true)).catch(console.error);
  }, []);

  // ── Load data ─────────────────────────────────────────────────────────────
  useEffect(() => {
    Promise.all([
      supabase.from('fieldvisits')
        .select('row_id,field_visit_id,arrival_date,visit_purpose,field_or_facility,lat_long,customer,customer_district,xc_rep,pad_name,visit_summary')
        .not('lat_long', 'is', null)
        .neq('lat_long', '')
        .order('arrival_date', { ascending: false }),
      supabase.from('customers').select('row_id,customer').order('customer'),
    ]).then(([visitsRes, custsRes]) => {
      setVisits(visitsRes.data || []);
      setCustomers(custsRes.data || []);
    }).finally(() => setLoading(false));
  }, []);

  // ── Filtered visits ───────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    return visits.filter(v => {
      if (!parseLatLng(v.lat_long)) return false;
      if (filterCustomer && v.customer !== filterCustomer) return false;
      if (filterPurpose  && v.visit_purpose !== filterPurpose) return false;
      return true;
    });
  }, [visits, filterCustomer, filterPurpose]);

  // ── Init map ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!leafletReady || !mapRef.current || mapInstance.current) return;
    const L = (window as any).L;

    mapInstance.current = L.map(mapRef.current, {
      center: [39.5, -98.35], // Center of US
      zoom: 5,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(mapInstance.current);

    markersLayer.current = L.layerGroup().addTo(mapInstance.current);

    // Dynamically invalidate map size if the container element changes size (e.g. mobile stacking)
    const resizeObserver = new ResizeObserver(() => {
      if (mapInstance.current) {
        mapInstance.current.invalidateSize();
      }
    });
    if (mapRef.current) {
      resizeObserver.observe(mapRef.current);
    }

    return () => {
      resizeObserver.disconnect();
    };
  }, [leafletReady]);

  // ── Update markers when data/filters change ───────────────────────────────
  useEffect(() => {
    if (!leafletReady || !mapInstance.current || !markersLayer.current) return;
    const L = (window as any).L;
    markersLayer.current.clearLayers();

    filtered.forEach(visit => {
      const coords = parseLatLng(visit.lat_long);
      if (!coords) return;

      const color  = PURPOSE_COLORS[visit.visit_purpose] || '#64748b';
      const date   = visit.arrival_date ? new Date(visit.arrival_date).toLocaleDateString() : '';

      // SVG circle marker
      const icon = L.divIcon({
        className: '',
        iconSize: [14, 14],
        iconAnchor: [7, 7],
        html: `<div style="width:14px;height:14px;border-radius:50%;background:${color};border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,0.3);cursor:pointer;"></div>`,
      });

      const marker = L.marker(coords, { icon });
      marker.on('click', () => setSelected(visit));
      markersLayer.current.addLayer(marker);
    });
  }, [filtered, leafletReady]);

  const clearFilters = () => { setFilterCustomer(''); setFilterPurpose(''); };
  const filtersActive = filterCustomer || filterPurpose;

  const custName = (custId: string) => customers.find(c => c.row_id === custId)?.customer || '-';

  return (
    <div className="p-4 md:p-8">
      <div className="max-w-7xl mx-auto">

        {/* Header */}
        <div className="flex justify-between items-start mb-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">Field Visit Map</h1>
            <p className="text-gray-600 dark:text-gray-300 mt-2">
              {loading ? 'Loading…' : `${filtered.length.toLocaleString()} visits with GPS coordinates`}
            </p>
          </div>
        </div>

        {/* Filter bar */}
        <Card className="mb-4">
          <CardContent className="pt-4">
            <div className="flex flex-wrap gap-4 items-end">
              <div className="flex-1 min-w-[200px]">
                <Label className="text-xs text-gray-500 mb-1 block">Customer</Label>
                <Select value={filterCustomer || '__all__'} onValueChange={v => setFilterCustomer(v === '__all__' ? '' : v)}>
                  <SelectTrigger><SelectValue placeholder="All customers" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">All customers</SelectItem>
                    {customers.map(c => <SelectItem key={c.row_id} value={c.row_id}>{c.customer}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex-1 min-w-[180px]">
                <Label className="text-xs text-gray-500 mb-1 block">Visit Purpose</Label>
                <Select value={filterPurpose || '__all__'} onValueChange={v => setFilterPurpose(v === '__all__' ? '' : v)}>
                  <SelectTrigger><SelectValue placeholder="All purposes" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">All purposes</SelectItem>
                    {PURPOSE_OPTS.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {filtersActive && (
                <button onClick={clearFilters} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 hover:border-gray-300">
                  <X className="w-4 h-4" /> Clear
                </button>
              )}
            </div>

            {/* Legend */}
            <div className="flex flex-wrap gap-3 mt-3 pt-3 border-t border-gray-100 dark:border-gray-700">
              {PURPOSE_OPTS.map(p => (
                <button key={p} onClick={() => setFilterPurpose(filterPurpose === p ? '' : p)}
                  className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded-full border transition-all ${filterPurpose === p ? 'border-gray-400 bg-gray-100' : 'border-transparent hover:border-gray-200'}`}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: PURPOSE_COLORS[p], flexShrink: 0, display: 'inline-block' }} />
                  {p}
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Map + sidebar */}
        <div className="flex flex-col md:flex-row gap-4 h-auto md:h-[600px]">
          {/* Map */}
          <div className="w-full h-[400px] md:h-full md:flex-1 relative" style={{ borderRadius: 12, overflow: 'hidden', border: '1px solid #e2e8f0' }}>
            {loading && (
              <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc', zIndex: 10, fontSize: 14, color: '#64748b' }}>
                Loading map data…
              </div>
            )}
            <div ref={mapRef} style={{ width: '100%', height: '100%' }} />
          </div>

          {/* Detail panel */}
          <div className="w-full md:w-[280px] shrink-0 flex flex-col gap-2 overflow-y-auto max-h-[400px] md:max-h-full">
            {selected ? (
              <Card style={{ flexShrink: 0 }}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center justify-between">
                    <span className="flex items-center gap-1.5">
                      <MapPin className="w-4 h-4" style={{ color: PURPOSE_COLORS[selected.visit_purpose] || '#64748b' }} />
                      Visit #{selected.field_visit_id}
                    </span>
                    <button onClick={() => setSelected(null)} className="text-gray-400 hover:text-gray-600">
                      <X className="w-4 h-4" />
                    </button>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div>
                    <Badge style={{ background: PURPOSE_COLORS[selected.visit_purpose] || '#64748b', color: '#fff', border: 'none' }}>
                      {selected.visit_purpose}
                    </Badge>
                  </div>
                  {selected.arrival_date && (
                    <div><span className="text-gray-500 font-medium">Date: </span>{new Date(selected.arrival_date).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}</div>
                  )}
                  <div><span className="text-gray-500 font-medium">Customer: </span>{custName(selected.customer)}</div>
                  {selected.pad_name && <div><span className="text-gray-500 font-medium">Pad: </span>{selected.pad_name}</div>}
                  {selected.xc_rep && <div><span className="text-gray-500 font-medium">SQM: </span>{selected.xc_rep}</div>}
                  <div><span className="text-gray-500 font-medium">Location: </span><span className="font-mono text-xs">{selected.lat_long}</span></div>
                  {selected.visit_summary && (
                    <div className="pt-2 border-t border-gray-100 dark:border-gray-700 text-gray-600 dark:text-gray-300 text-xs leading-relaxed">
                      {selected.visit_summary.slice(0, 200)}{selected.visit_summary.length > 200 ? '…' : ''}
                    </div>
                  )}
                </CardContent>
              </Card>
            ) : (
              <div className="text-center py-8 text-gray-400 text-sm">
                <MapPin className="w-8 h-8 mx-auto mb-2 opacity-30" />
                Click a pin to see visit details
              </div>
            )}

            {/* Stats */}
            <Card style={{ flexShrink: 0 }}>
              <CardHeader className="pb-2"><CardTitle className="text-xs text-gray-500 uppercase tracking-wider">Breakdown</CardTitle></CardHeader>
              <CardContent className="space-y-1.5">
                {PURPOSE_OPTS.filter(p => filtered.some(v => v.visit_purpose === p)).map(p => {
                  const count = filtered.filter(v => v.visit_purpose === p).length;
                  return (
                    <div key={p} className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-1.5">
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: PURPOSE_COLORS[p], flexShrink: 0, display: 'inline-block' }} />
                        <span className="text-gray-600 dark:text-gray-300">{p}</span>
                      </div>
                      <span className="font-semibold text-gray-900 dark:text-gray-100">{count}</span>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}

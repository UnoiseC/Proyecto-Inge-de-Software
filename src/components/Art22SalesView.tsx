import { useMemo, useState } from 'react';
import { Plus, Target, Calculator, PackagePlus, CheckCircle2, X } from 'lucide-react';
import type { ActaMensualAdminResponse, JsspSnapshot } from '../types/jssp.ts';
import { formatCLP, MESES_ES } from '../lib/punctuality.ts';

interface Art22SalesViewProps {
  snapshot: JsspSnapshot;
  actaAdmin: ActaMensualAdminResponse;
  mes: number;
  anio: number;
  onRegisterSale: (payload: {
    id_vendedor: string;
    id_meta: number;
    items: Array<{ codigo_producto: number; cantidad: number; precio_unitario: number }>;
  }) => Promise<void>;
  onCreateMeta: (payload: {
    fecha_inicio: string;
    fecha_fin: string;
    monto_objetivo: number;
  }) => Promise<void>;
  onCreateProduct: (payload: {
    nombre_producto: string;
    categoria_producto: string;
    porcentaje_comision_producto: number;
  }) => Promise<void>;
}

export function Art22SalesView({
  snapshot,
  actaAdmin,
  mes,
  anio,
  onRegisterSale,
  onCreateMeta,
  onCreateProduct,
}: Art22SalesViewProps) {
  const art22Sellers = useMemo(() => {
    return snapshot.vendedores.map((v) => {
      const t = snapshot.trabajadores.find((w) => w.id_trabajador === v.id_trabajador);
      const suc = snapshot.sucursales.find((s) => s.id_sucursal === t?.id_sucursal);
      return {
        ...v,
        nombre_completo: t ? `${t.nombre_trabajador} ${t.apellido_trabajador}` : v.id_trabajador,
        rut: t?.rut || '—',
        email: t?.email_trabajador || '—',
        sueldo_base: t?.sueldo_base_trabajador || 0,
        sucursal: suc?.nombre_sucursal || '—',
      };
    });
  }, [snapshot.vendedores, snapshot.trabajadores, snapshot.sucursales]);

  const [selectedMetaId, setSelectedMetaId] = useState<number>(
    actaAdmin.metas_venta[0]?.id_meta || snapshot.metas[0]?.id_meta || 1
  );

  // Sale registration state
  const [saleSellerId, setSaleSellerId] = useState<string>(art22Sellers[0]?.id_trabajador || '');
  const [saleMetaId, setSaleMetaId] = useState<number>(
    snapshot.metas[0]?.id_meta || 1
  );
  const [saleProductCode, setSaleProductCode] = useState<number>(
    snapshot.productos[0]?.codigo_producto || 101
  );
  const [saleCantidad, setSaleCantidad] = useState<number>(1);
  const [salePrecioUnitario, setSalePrecioUnitario] = useState<number>(1500000);
  const [saleSaving, setSaleSaving] = useState(false);
  const [saleFeedback, setSaleFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  // Modals
  const [showMetaModal, setShowMetaModal] = useState(false);
  const [metaForm, setMetaForm] = useState({
    fecha_inicio: `${anio}-${String(mes).padStart(2, '0')}-01`,
    fecha_fin: `${anio}-${String(mes).padStart(2, '0')}-28`,
    monto_objetivo: 10000000,
  });

  const [showProductModal, setShowProductModal] = useState(false);
  const [prodForm, setProdForm] = useState({
    nombre_producto: '',
    categoria_producto: 'Software SaaS',
    porcentaje_comision_producto: 7.5,
  });

  // Compute consolidated Art. 22 commission ledger across metas
  const commissionSummaryBySeller = useMemo(() => {
    const map = new Map<
      string,
      {
        ventasIds: Set<number>;
        totalVendido: number;
        comisionTotal: number;
        metasCumplidas: number;
      }
    >();

    for (const seller of art22Sellers) {
      map.set(seller.id_trabajador, {
        ventasIds: new Set<number>(),
        totalVendido: 0,
        comisionTotal: 0,
        metasCumplidas: 0,
      });
    }

    for (const dv of snapshot.detallesVenta) {
      const entry = map.get(dv.id_vendedor);
      if (!entry) continue;
      const prod = snapshot.productos.find((p) => p.codigo_producto === dv.codigo_producto);
      const pct = prod?.porcentaje_comision_producto || 0;
      entry.ventasIds.add(dv.id_venta);
      entry.totalVendido += dv.subtotal;
      entry.comisionTotal += dv.subtotal * (pct / 100);
    }

    return art22Sellers.map((seller) => {
      const stats = map.get(seller.id_trabajador)!;
      const comisionRedondeada = Math.round(stats.comisionTotal);
      return {
        ...seller,
        cantidadVentas: stats.ventasIds.size,
        totalVendido: stats.totalVendido,
        comisionCalculada: comisionRedondeada,
        remuneracionTotal: seller.sueldo_base + comisionRedondeada,
      };
    });
  }, [art22Sellers, snapshot.detallesVenta, snapshot.productos]);

  const kpis = useMemo(() => {
    const totalVendido = commissionSummaryBySeller.reduce((s, r) => s + r.totalVendido, 0);
    const totalComisiones = commissionSummaryBySeller.reduce((s, r) => s + r.comisionCalculada, 0);
    const metasCumplidas = snapshot.metas.filter((m) => m.estado === 'CUMPLIDA').length;
    return {
      vendedoresCount: art22Sellers.filter((s) => s.es_articulo22).length,
      totalVendido,
      totalComisiones,
      metasCumplidas,
      totalMetas: snapshot.metas.length,
    };
  }, [commissionSummaryBySeller, art22Sellers, snapshot.metas]);

  const selectedProduct = snapshot.productos.find(
    (p) => p.codigo_producto === Number(saleProductCode)
  );
  const previewSubtotal = Math.max(0, Number(saleCantidad) * Number(salePrecioUnitario));
  const previewCommission = Math.round(
    previewSubtotal * ((selectedProduct?.porcentaje_comision_producto || 0) / 100)
  );

  const handleSaleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaleFeedback(null);
    setSaleSaving(true);
    try {
      await onRegisterSale({
        id_vendedor: saleSellerId,
        id_meta: Number(saleMetaId),
        items: [
          {
            codigo_producto: Number(saleProductCode),
            cantidad: Number(saleCantidad),
            precio_unitario: Number(salePrecioUnitario),
          },
        ],
      });
      setSaleFeedback({
        ok: true,
        text: `Venta registrada en JSSP_VENTA / JSSP_DETALLE_VENTA. Meta #${saleMetaId} y comisión (+${formatCLP(previewCommission)}) actualizadas.`,
      });
    } catch (err) {
      setSaleFeedback({
        ok: false,
        text: err instanceof Error ? err.message : 'Error al registrar venta.',
      });
    } finally {
      setSaleSaving(false);
    }
  };

  const selectedMetaDetail = actaAdmin.metas_venta.find((m) => m.id_meta === selectedMetaId);

  return (
    <div className="space-y-6">
      {/* 4-KPI Strip */}
      <div className="bg-white border border-slate-200 rounded-lg grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-slate-200">
        <div className="p-5">
          <div className="text-xs text-slate-500">Vendedores Artículo 22 CT</div>
          <div className="mt-1.5 flex items-baseline gap-2">
            <span className="text-2xl font-semibold font-mono tabular-nums text-slate-900">
              {kpis.vendedoresCount}
            </span>
            <span className="text-xs text-slate-500">Exentos de jornada</span>
          </div>
        </div>

        <div className="p-5">
          <div className="text-xs text-slate-500">Ventas Totales Acumuladas</div>
          <div className="mt-1.5 text-2xl font-semibold font-mono tabular-nums text-slate-900">
            {formatCLP(kpis.totalVendido)}
          </div>
        </div>

        <div className="p-5">
          <div className="text-xs text-slate-500">Comisiones Calculadas</div>
          <div className="mt-1.5 text-2xl font-semibold font-mono tabular-nums text-emerald-700">
            {formatCLP(kpis.totalComisiones)}
          </div>
        </div>

        <div className="p-5">
          <div className="text-xs text-slate-500">Cumplimiento de Metas</div>
          <div className="mt-1.5 flex items-baseline gap-2">
            <span className="text-2xl font-semibold font-mono tabular-nums text-blue-700">
              {kpis.metasCumplidas}/{kpis.totalMetas}
            </span>
            <span className="text-xs text-slate-500">Metas cumplidas</span>
          </div>
        </div>
      </div>

      {/* Main 12-col Grid */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* Left 8 cols: Metas de Venta + Liquidación de Comisiones */}
        <div className="xl:col-span-8 space-y-6">
          {/* Metas de Venta */}
          <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold text-slate-900">
                  Seguimiento de Metas de Venta (JSSP_META_VENTA)
                </h2>
                <p className="text-xs text-slate-500">
                  Progreso recalculado automáticamente por trigger jssp_actualizar_totales_venta_y_meta
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowMetaModal(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-slate-900 text-white rounded-md hover:bg-slate-800 whitespace-nowrap shrink-0"
              >
                <Target className="w-3.5 h-3.5" />
                Nueva Meta
              </button>
            </div>

            <div className="divide-y divide-slate-200">
              {snapshot.metas.map((m) => {
                const pct =
                  m.monto_objetivo > 0
                    ? Math.min(100, Math.round((m.monto_actual / m.monto_objetivo) * 1000) / 10)
                    : 0;
                const isSelected = m.id_meta === selectedMetaId;
                return (
                  <div
                    key={m.id_meta}
                    onClick={() => setSelectedMetaId(m.id_meta)}
                    className={`p-5 cursor-pointer transition-colors ${
                      isSelected ? 'bg-blue-50/40' : 'hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                        <span className="font-mono">Meta #{m.id_meta}</span>
                        <span className="text-slate-300">·</span>
                        <span className="text-xs font-normal font-mono text-slate-500">
                          {m.fecha_inicio} al {m.fecha_fin || 'Abierta'}
                        </span>
                      </div>
                      <span
                        className={`text-xs font-semibold ${
                          m.estado === 'CUMPLIDA'
                            ? 'text-emerald-700'
                            : m.estado === 'NO_CUMPLIDA'
                              ? 'text-rose-700'
                              : 'text-amber-700'
                        }`}
                      >
                        {m.estado === 'CUMPLIDA'
                          ? 'CUMPLIDA'
                          : m.estado === 'NO_CUMPLIDA'
                            ? 'NO CUMPLIDA'
                            : 'EN PROGRESO'}
                      </span>
                    </div>

                    <div className="mt-3 w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full transition-all duration-300 ${
                          m.estado === 'CUMPLIDA' ? 'bg-emerald-600' : 'bg-blue-700'
                        }`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>

                    <div className="mt-2.5 flex items-center justify-between text-xs font-mono tabular-nums text-slate-600">
                      <span>
                        Actual: <strong className="text-slate-900">{formatCLP(m.monto_actual)}</strong>
                      </span>
                      <span>
                        Objetivo: {formatCLP(m.monto_objetivo)} ({pct}%)
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            {selectedMetaDetail && selectedMetaDetail.detalle_vendedores.length > 0 && (
              <div className="px-6 py-4 bg-slate-50 border-t border-slate-200">
                <div className="text-xs font-semibold text-slate-700 mb-2">
                  Aporte por vendedor en Meta #{selectedMetaDetail.id_meta} ({MESES_ES[mes - 1]} {anio})
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {selectedMetaDetail.detalle_vendedores.map((dv) => (
                    <div
                      key={dv.id_trabajador}
                      className="p-3 bg-white border border-slate-200 rounded-md"
                    >
                      <div className="text-xs font-semibold text-slate-900 truncate">
                        {dv.vendedor}
                      </div>
                      <div className="text-[11px] text-slate-500 truncate">{dv.zona_cobertura}</div>
                      <div className="mt-1.5 text-xs font-mono tabular-nums text-slate-800">
                        Vendido: {formatCLP(dv.total_vendido_meta)}
                      </div>
                      <div className="text-xs font-mono tabular-nums text-emerald-700 font-semibold">
                        Comisión: {formatCLP(dv.comision_estimada)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>

          {/* Liquidación de Comisiones por Vendedor Art. 22 */}
          <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200">
              <h3 className="text-base font-semibold text-slate-900">
                Cálculo Automático de Comisiones — Vendedores Artículo 22
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Fórmula SQL: SUM(subtotal × porcentaje_comision_producto / 100) + sueldo_base_trabajador
              </p>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                    <th className="py-2.5 px-4">Vendedor / RUT</th>
                    <th className="py-2.5 px-3">Zona / Contrato</th>
                    <th className="py-2.5 px-3 text-right">Ventas</th>
                    <th className="py-2.5 px-3 text-right">Total Vendido</th>
                    <th className="py-2.5 px-3 text-right">Comisión</th>
                    <th className="py-2.5 px-3 text-right">Sueldo Base</th>
                    <th className="py-2.5 px-4 text-right">Total Estimado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-xs">
                  {commissionSummaryBySeller.map((row) => (
                    <tr key={row.id_trabajador} className="hover:bg-slate-50">
                      <td className="py-3 px-4">
                        <div className="font-semibold text-slate-900">{row.nombre_completo}</div>
                        <div className="font-mono text-slate-500">{row.rut}</div>
                      </td>
                      <td className="py-3 px-3">
                        <div className="text-slate-800">{row.zona_cobertura}</div>
                        <div className="text-slate-500">
                          {row.es_articulo22 ? 'Art. 22 CT (Sin jornada)' : 'Jornada ordinaria'}
                        </div>
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums">
                        {row.cantidadVentas}
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-900">
                        {formatCLP(row.totalVendido)}
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums font-semibold text-emerald-700">
                        +{formatCLP(row.comisionCalculada)}
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-600">
                        {formatCLP(row.sueldo_base)}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums font-semibold text-slate-900">
                        {formatCLP(row.remuneracionTotal)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        {/* Right 4 cols: Register New Sale + Product Catalog */}
        <aside className="xl:col-span-4 space-y-6">
          <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 className="text-base font-semibold text-slate-900">
                  Registrar Venta (Art. 22)
                </h3>
                <p className="text-xs text-slate-500">
                  Imputa a JSSP_VENTA y calcula comisión
                </p>
              </div>
              <Calculator className="w-5 h-5 text-slate-400" />
            </div>

            <form onSubmit={handleSaleSubmit} className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Vendedor Artículo 22
                </label>
                <select
                  value={saleSellerId}
                  onChange={(e) => setSaleSellerId(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-md"
                >
                  {art22Sellers.map((s) => (
                    <option key={s.id_trabajador} value={s.id_trabajador}>
                      {s.nombre_completo} · {s.zona_cobertura}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Meta de Venta Asociada
                </label>
                <select
                  value={saleMetaId}
                  onChange={(e) => setSaleMetaId(Number(e.target.value))}
                  className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-md"
                >
                  {snapshot.metas.map((m) => (
                    <option key={m.id_meta} value={m.id_meta}>
                      Meta #{m.id_meta} ({formatCLP(m.monto_actual)} / {formatCLP(m.monto_objetivo)})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Producto (JSSP_PRODUCTO)
                </label>
                <select
                  value={saleProductCode}
                  onChange={(e) => setSaleProductCode(Number(e.target.value))}
                  className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-md"
                >
                  {snapshot.productos.map((p) => (
                    <option key={p.codigo_producto} value={p.codigo_producto}>
                      {p.nombre_producto} ({p.porcentaje_comision_producto}% com.)
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Cantidad</label>
                  <input
                    type="number"
                    min={1}
                    required
                    value={saleCantidad}
                    onChange={(e) => setSaleCantidad(Number(e.target.value))}
                    className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-md"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Precio Unit. (CLP)
                  </label>
                  <input
                    type="number"
                    min={1000}
                    step={1000}
                    required
                    value={salePrecioUnitario}
                    onChange={(e) => setSalePrecioUnitario(Number(e.target.value))}
                    className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-md"
                  />
                </div>
              </div>

              <div className="p-3 bg-slate-50 border border-slate-200 rounded-md space-y-1 text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-600">Subtotal Venta:</span>
                  <span className="font-mono tabular-nums font-semibold text-slate-900">
                    {formatCLP(previewSubtotal)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600">
                    Comisión ({selectedProduct?.porcentaje_comision_producto || 0}%):
                  </span>
                  <span className="font-mono tabular-nums font-semibold text-emerald-700">
                    +{formatCLP(previewCommission)}
                  </span>
                </div>
              </div>

              <button
                type="submit"
                disabled={saleSaving}
                className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-medium bg-slate-900 text-white rounded-md hover:bg-slate-800 disabled:opacity-50"
              >
                <Plus className="w-3.5 h-3.5" />
                {saleSaving ? 'Registrando venta...' : 'Registrar Venta y Calcular Comisión'}
              </button>

              {saleFeedback && (
                <div
                  className={`p-3 rounded-md border text-xs flex items-start gap-2 ${
                    saleFeedback.ok
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                      : 'bg-rose-50 border-rose-200 text-rose-900'
                  }`}
                >
                  <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{saleFeedback.text}</span>
                </div>
              )}
            </form>
          </section>

          {/* Catalog of commission products */}
          <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">
                  Productos y Tasas de Comisión
                </h3>
                <p className="text-xs text-slate-500">Tabla JSSP_PRODUCTO</p>
              </div>
              <button
                type="button"
                onClick={() => setShowProductModal(true)}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium border border-slate-300 text-slate-700 rounded hover:bg-slate-50"
              >
                <PackagePlus className="w-3.5 h-3.5" />
                Agregar
              </button>
            </div>
            <div className="divide-y divide-slate-200">
              {snapshot.productos.map((p) => (
                <div key={p.codigo_producto} className="px-5 py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-slate-900 truncate">
                      {p.nombre_producto}
                    </div>
                    <div className="text-[11px] text-slate-500">
                      Cód. <span className="font-mono">{p.codigo_producto}</span> · {p.categoria_producto}
                    </div>
                  </div>
                  <span className="text-xs font-mono tabular-nums font-semibold text-blue-700 shrink-0">
                    {p.porcentaje_comision_producto}%
                  </span>
                </div>
              ))}
            </div>
          </section>
        </aside>
      </div>

      {/* Modal: Nueva Meta */}
      {showMetaModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md bg-white border border-slate-200 rounded-lg overflow-hidden shadow-lg">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <h3 className="text-base font-semibold text-slate-900">Crear Meta de Venta</h3>
              <button
                type="button"
                onClick={() => setShowMetaModal(false)}
                className="p-1 text-slate-500 hover:text-slate-900"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                await onCreateMeta(metaForm);
                setShowMetaModal(false);
              }}
              className="p-6 space-y-4"
            >
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Fecha Inicio
                  </label>
                  <input
                    type="date"
                    required
                    value={metaForm.fecha_inicio}
                    onChange={(e) => setMetaForm({ ...metaForm, fecha_inicio: e.target.value })}
                    className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-md"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Fecha Fin</label>
                  <input
                    type="date"
                    required
                    value={metaForm.fecha_fin}
                    onChange={(e) => setMetaForm({ ...metaForm, fecha_fin: e.target.value })}
                    className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-md"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Monto Objetivo (CLP)
                </label>
                <input
                  type="number"
                  min={100000}
                  step={100000}
                  required
                  value={metaForm.monto_objetivo}
                  onChange={(e) =>
                    setMetaForm({ ...metaForm, monto_objetivo: Number(e.target.value) })
                  }
                  className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-md"
                />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowMetaModal(false)}
                  className="px-4 py-2 text-xs font-medium border border-slate-300 rounded-md text-slate-700"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-medium bg-slate-900 text-white rounded-md hover:bg-slate-800"
                >
                  Guardar Meta
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Nuevo Producto */}
      {showProductModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md bg-white border border-slate-200 rounded-lg overflow-hidden shadow-lg">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <h3 className="text-base font-semibold text-slate-900">
                Agregar Producto Comisionable
              </h3>
              <button
                type="button"
                onClick={() => setShowProductModal(false)}
                className="p-1 text-slate-500 hover:text-slate-900"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                await onCreateProduct(prodForm);
                setShowProductModal(false);
                setProdForm({
                  nombre_producto: '',
                  categoria_producto: 'Software SaaS',
                  porcentaje_comision_producto: 7.5,
                });
              }}
              className="p-6 space-y-4"
            >
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Nombre del Producto
                </label>
                <input
                  type="text"
                  required
                  value={prodForm.nombre_producto}
                  onChange={(e) => setProdForm({ ...prodForm, nombre_producto: e.target.value })}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Categoría</label>
                  <input
                    type="text"
                    required
                    value={prodForm.categoria_producto}
                    onChange={(e) =>
                      setProdForm({ ...prodForm, categoria_producto: e.target.value })
                    }
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Comisión (0–100%)
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={0.5}
                    required
                    value={prodForm.porcentaje_comision_producto}
                    onChange={(e) =>
                      setProdForm({
                        ...prodForm,
                        porcentaje_comision_producto: Number(e.target.value),
                      })
                    }
                    className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-md"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowProductModal(false)}
                  className="px-4 py-2 text-xs font-medium border border-slate-300 rounded-md text-slate-700"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-medium bg-slate-900 text-white rounded-md hover:bg-slate-800"
                >
                  Crear Producto
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

(function () {
  'use strict';

  function raw(str) { return String(str); }

  // ============= OWNER DASHBOARD =============
  function renderDashboardOwner() {
    var html = `
      <div class="kpi-grid">
        <div class="kpi-card info">
          <div class="kpi-card-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg></div>
          <div class="kpi-card-label">إجمالي المخزون المتاح</div>
          <div class="kpi-card-value">١٢٨,٤٥٠ <small style="font-size:0.6em;color:var(--text-muted)">كجم</small></div>
          <div class="kpi-card-change up"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;"><polyline points="18 15 12 9 6 15"/></svg> +٣٫٢٪ عن الشهر الماضي</div>
        </div>
        <div class="kpi-card accent">
          <div class="kpi-card-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg></div>
          <div class="kpi-card-label">خام لدى المصانع الخارجية</div>
          <div class="kpi-card-value">٤٥,٣٠٠ <small style="font-size:0.6em;color:var(--text-muted)">كجم</small></div>
          <div class="kpi-card-change up"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;"><polyline points="18 15 12 9 6 15"/></svg> +١٢٫١٪</div>
        </div>
        <div class="kpi-card info">
          <div class="kpi-card-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg></div>
          <div class="kpi-card-label">مبيعات هذا الشهر</div>
          <div class="kpi-card-value">١,٢٤٠,٠٠٠ <small style="font-size:0.6em;color:var(--text-muted)">ر.س</small></div>
          <div class="kpi-card-change up"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;"><polyline points="18 15 12 9 6 15"/></svg> +٨٫٥٪</div>
        </div>
        <div class="kpi-card danger">
          <div class="kpi-card-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg></div>
          <div class="kpi-card-label">موافقات معلقة</div>
          <div class="kpi-card-value">٢٣</div>
          <div class="kpi-card-change down"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;"><polyline points="6 9 12 15 18 9"/></svg> +٥ عمليات جديدة</div>
        </div>
        <div class="kpi-card warning">
          <div class="kpi-card-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></div>
          <div class="kpi-card-label">تحذيرات مهمة</div>
          <div class="kpi-card-value">٨</div>
          <div class="kpi-card-change down"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;"><polyline points="6 9 12 15 18 9"/></svg> تحذير مخزون +٣</div>
        </div>
        <div class="kpi-card warning">
          <div class="kpi-card-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg></div>
          <div class="kpi-card-label">شكاوى مفتوحة</div>
          <div class="kpi-card-value">٤</div>
          <div class="kpi-card-change down"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;"><polyline points="6 9 12 15 18 9"/></svg> زادت ١ عن الأسبوع الماضي</div>
        </div>
        <div class="kpi-card info">
          <div class="kpi-card-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg></div>
          <div class="kpi-card-label">ربحية تقريبية (هذا الشهر)</div>
          <div class="kpi-card-value">٢١٥,٠٠٠ <small style="font-size:0.6em;color:var(--text-muted)">ر.س</small></div>
          <div class="kpi-card-change up"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;"><polyline points="18 15 12 9 6 15"/></svg> +٥٫٢٪</div>
        </div>
      </div>

      <div class="kpi-grid" style="grid-template-columns:repeat(2,1fr);margin-bottom:24px;">
        <div class="card">
          <div class="card-header"><span class="card-title">ملخص أرصدة العملاء</span></div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
            <div><div style="font-size:0.75rem;color:var(--text-muted);">إجمالي المستحق</div><div style="font-size:1.2rem;font-weight:800;color:var(--color-foreground);">٢١١,٧٠٠ <span style="font-size:0.6em;color:var(--text-muted);">ر.س</span></div></div>
            <div><div style="font-size:0.75rem;color:var(--text-muted);">متأخر</div><div style="font-size:1.2rem;font-weight:800;color:var(--color-danger);">٧٠,٥٠٠ <span style="font-size:0.6em;color:var(--text-muted);">ر.س</span></div></div>
            <div><div style="font-size:0.75rem;color:var(--text-muted);">مدفوع هذا الشهر</div><div style="font-size:1.2rem;font-weight:800;color:var(--color-success);">١٢٤,٠٠٠ <span style="font-size:0.6em;color:var(--text-muted);">ر.س</span></div></div>
            <div><div style="font-size:0.75rem;color:var(--text-muted);">عدد العملاء النشطين</div><div style="font-size:1.2rem;font-weight:800;">٨</div></div>
          </div>
        </div>
        <div class="card">
          <div class="card-header"><span class="card-title">ملخص مستحقات المصانع</span></div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
            <div><div style="font-size:0.75rem;color:var(--text-muted);">إجمالي مستحق</div><div style="font-size:1.2rem;font-weight:800;color:var(--color-foreground);">٣٤٢,٨٠٠ <span style="font-size:0.6em;color:var(--text-muted);">ر.س</span></div></div>
            <div><div style="font-size:0.75rem;color:var(--text-muted);">غير مسدد</div><div style="font-size:1.2rem;font-weight:800;color:var(--color-warning);">٧٧,٠٠٠ <span style="font-size:0.6em;color:var(--text-muted);">ر.س</span></div></div>
            <div><div style="font-size:0.75rem;color:var(--text-muted);">تم السداد</div><div style="font-size:1.2rem;font-weight:800;color:var(--color-success);">٢٦٥,٨٠٠ <span style="font-size:0.6em;color:var(--text-muted);">ر.س</span></div></div>
            <div><div style="font-size:0.75rem;color:var(--text-muted);">عدد المصانع</div><div style="font-size:1.2rem;font-weight:800;">٥</div></div>
          </div>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:24px;">
        <div class="card">
          <div class="card-header"><span class="card-title">المخزون حسب الموقع / المصنع</span></div>
          <div class="chart-container"><canvas id="chartStockByLocation"></canvas></div>
        </div>
        <div class="card">
          <div class="card-header"><span class="card-title">اتجاه المبيعات الشهرية</span></div>
          <div class="chart-container"><canvas id="chartSalesTrend"></canvas></div>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:24px;">
        <div class="card">
          <div class="card-header"><span class="card-title">اتجاه الموافقات والتحذيرات</span></div>
          <div class="chart-container"><canvas id="chartReviewTrend"></canvas></div>
        </div>
        <div class="card">
          <div class="card-header"><span class="card-title">توزيع مخزون المصانع الخارجية</span></div>
          <div class="chart-container"><canvas id="chartFactoryDist"></canvas></div>
        </div>
      </div>

      <div class="card">
        <div class="card-header"><span class="card-title">آخر النشاطات</span></div>
        <div class="timeline">
          <div class="timeline-item">
            <div class="timeline-dot success"></div>
            <div class="timeline-date ltr">٢٣/٠٦/٢٠٢٦ — ١٠:٣٢</div>
            <div class="timeline-text"><strong>استلام منتج</strong> — منتج مبروم PQ-8821 من مصنع النسيج الحديث (١,٢٠٠ كجم)</div>
          </div>
          <div class="timeline-item">
            <div class="timeline-dot"></div>
            <div class="timeline-date ltr">٢٣/٠٦/٢٠٢٦ — ٠٩:١٥</div>
            <div class="timeline-text"><strong>صرف خام لمصنع خارجي</strong> — خام TM-4401 إلى مصنع الخليج (٨٠٠ كجم)</div>
          </div>
          <div class="timeline-item">
            <div class="timeline-dot warning"></div>
            <div class="timeline-date ltr">٢٢/٠٦/٢٠٢٦ — ١٤:٠٥</div>
            <div class="timeline-text"><strong>تسجيل شكوى</strong> — عميل رقم C-221 — عيوب لون في الخصلة Y-5542</div>
          </div>
          <div class="timeline-item">
            <div class="timeline-dot success"></div>
            <div class="timeline-date ltr">٢٢/٠٦/٢٠٢٦ — ١١:٤٨</div>
            <div class="timeline-text"><strong>اعتماد بيع</strong> — فاتورة INV-3302 بقيمة ٤٨,٥٠٠ ر.س — شركة ألفا للتجارة</div>
          </div>
          <div class="timeline-item">
            <div class="timeline-dot"></div>
            <div class="timeline-date ltr">٢١/٠٦/٢٠٢٦ — ١٥:٢٢</div>
            <div class="timeline-text"><strong>استلام خام</strong> — خام قطن Y-7120 من المورد S-009 (٥,٠٠٠ كجم)</div>
          </div>
          <div class="timeline-item">
            <div class="timeline-dot danger"></div>
            <div class="timeline-date ltr">٢١/٠٦/٢٠٢٦ — ١٣:١٠</div>
            <div class="timeline-text"><strong>تحذير مخزون</strong> — خام TM-3301 أقل من الحد الأدنى (٨٠ كجم متبقي)</div>
          </div>
        </div>
      </div>
    `;
    document.getElementById('pageContent').innerHTML = html;
    initOwnerCharts();
  }

  function initOwnerCharts() {
    var chartDefaults = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } }
    };
    var colorBlue = '#2457C5';
    var colorTeal = '#2A9D8F';
    var colorAmber = '#C47A12';
    var colorRed = '#C2414A';

    // Stock by location
    var ctx1 = document.getElementById('chartStockByLocation');
    if (ctx1) {
      new Chart(ctx1, {
        type: 'bar',
        data: {
          labels: ['المستودع الرئيسي', 'مصنع النسيج الحديث (فرد)', 'مصنع الخليج (زوى)', 'مصنع اليمامة (فرد)', 'مستودع جدة', 'مستودع الدمام'],
          datasets: [{
            label: 'الكمية (كجم)',
            data: [45200, 18300, 12700, 8500, 29500, 14250],
            backgroundColor: [colorBlue, colorTeal, colorAmber, '#52657A', colorBlue, colorTeal],
            borderRadius: 4
          }]
        },
        options: Object.assign({}, chartDefaults, {
          scales: { y: { beginAtZero: true, grid: { color: '#E2E8F0' } }, x: { grid: { display: false } } }
        })
      });
    }

    // Sales trend
    var ctx2 = document.getElementById('chartSalesTrend');
    if (ctx2) {
      new Chart(ctx2, {
        type: 'line',
        data: {
          labels: ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو'],
          datasets: [{
            label: 'المبيعات (ر.س)',
            data: [780000, 920000, 1050000, 980000, 1150000, 1240000],
            borderColor: colorBlue,
            backgroundColor: colorBlue + '18',
            fill: true,
            tension: 0.35,
            pointRadius: 4,
            pointBackgroundColor: colorBlue
          }]
        },
        options: Object.assign({}, chartDefaults, {
          scales: { y: { beginAtZero: false, grid: { color: '#E2E8F0' } }, x: { grid: { display: false } } }
        })
      });
    }

    // Review/warning trend
    var ctx3 = document.getElementById('chartReviewTrend');
    if (ctx3) {
      new Chart(ctx3, {
        type: 'line',
        data: {
          labels: ['الأسبوع ١', 'الأسبوع ٢', 'الأسبوع ٣', 'الأسبوع ٤', 'الأسبوع ٥', 'الأسبوع ٦'],
          datasets: [
            { label: 'عمليات مراجعة', data: [12, 18, 15, 22, 19, 23], borderColor: colorAmber, backgroundColor: colorAmber + '18', fill: true, tension: 0.35, pointRadius: 3 },
            { label: 'تحذيرات', data: [4, 6, 5, 8, 7, 8], borderColor: colorRed, backgroundColor: colorRed + '18', fill: true, tension: 0.35, pointRadius: 3 }
          ]
        },
        options: Object.assign({}, chartDefaults, {
          plugins: { legend: { display: true, position: 'top', labels: { boxWidth: 12, padding: 12, font: { size: 11 } } } },
          scales: { y: { beginAtZero: true, grid: { color: '#E2E8F0' } }, x: { grid: { display: false } } }
        })
      });
    }

    // Factory stock distribution
    var ctx4 = document.getElementById('chartFactoryDist');
    if (ctx4) {
      new Chart(ctx4, {
        type: 'doughnut',
        data: {
          labels: ['النسيج الحديث (فرد)', 'مصنع الخليج (زوى)', 'مصنع اليمامة (فرد)', 'مصنع العروبة (زوى)', 'مصنع الشرق (زوى)'],
          datasets: [{
            data: [18300, 12700, 8500, 6200, 4600],
            backgroundColor: [colorTeal, colorBlue, colorAmber, '#52657A', '#94A3B8'],
            borderWidth: 0
          }]
        },
        options: Object.assign({}, chartDefaults, {
          cutout: '60%',
          plugins: { legend: { display: true, position: 'bottom', labels: { boxWidth: 12, padding: 10, font: { size: 11 } } } }
        })
      });
    }
  }

  // ============= ACCOUNTANT DASHBOARD =============
  function renderDashboardAccountant() {
    var html = `
      <div class="kpi-grid">
        <div class="kpi-card warning">
          <div class="kpi-card-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg></div>
          <div class="kpi-card-label">مبيعات تحتاج اعتماد</div>
          <div class="kpi-card-value">١١</div>
          <div class="kpi-card-change down">+٣ غير معتمدة</div>
        </div>
        <div class="kpi-card warning">
          <div class="kpi-card-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg></div>
          <div class="kpi-card-label">خام مستلم بدون سعر</div>
          <div class="kpi-card-value">٥</div>
          <div class="kpi-card-change down">بحاجة إدخال السعر</div>
        </div>
        <div class="kpi-card warning">
          <div class="kpi-card-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg></div>
          <div class="kpi-card-label">تشغيل يحتاج مراجعة تكلفة</div>
          <div class="kpi-card-value">٤</div>
          <div class="kpi-card-change down">قيد المراجعة</div>
        </div>
        <div class="kpi-card warning">
          <div class="kpi-card-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg></div>
          <div class="kpi-card-label">تكاليف مباشرة تحتاج مراجعة</div>
          <div class="kpi-card-value">٣</div>
        </div>
        <div class="kpi-card danger">
          <div class="kpi-card-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg></div>
          <div class="kpi-card-label">مدفوعات غير مسددة</div>
          <div class="kpi-card-value">٩٢,٠٠٠ <small style="font-size:0.6em;color:var(--text-muted)">ر.س</small></div>
        </div>
        <div class="kpi-card danger">
          <div class="kpi-card-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></div>
          <div class="kpi-card-label">تحذيرات ترحيل تاريخي</div>
          <div class="kpi-card-value">٣</div>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:24px;">
        <div class="card">
          <div class="card-header"><span class="card-title">اتجاه المبيعات الشهرية</span></div>
          <div class="chart-container"><canvas id="chartAcctSales"></canvas></div>
        </div>
        <div class="card">
          <div class="card-header"><span class="card-title">مستحقات المصانع الخارجية</span></div>
          <div class="chart-container"><canvas id="chartAcctFactory"></canvas></div>
        </div>
      </div>

      <div class="card">
        <div class="card-header"><span class="card-title">آخر المدفوعات</span></div>
        <div class="table-container">
          <table>
            <thead><tr><th>التاريخ</th><th>البيان</th><th>الطرف</th><th>المبلغ</th><th>الحالة</th></tr></thead>
            <tbody>
              <tr><td class="ltr">٢٣/٠٦</td><td>دفعة تشغيل</td><td>مصنع النسيج الحديث</td><td class="ltr">٤٥,٠٠٠ ر.س</td><td><span class="status-chip completed">تم</span></td></tr>
              <tr><td class="ltr">٢٢/٠٦</td><td>سداد فاتورة</td><td>شركة ألفا للتجارة</td><td class="ltr">٤٨,٥٠٠ ر.س</td><td><span class="status-chip completed">تم</span></td></tr>
              <tr><td class="ltr">٢١/٠٦</td><td>دفعة تشغيل</td><td>مصنع الخليج</td><td class="ltr">٣٢,٠٠٠ ر.س</td><td><span class="status-chip pending">معلق</span></td></tr>
              <tr><td class="ltr">٢٠/٠٦</td><td>مستحقات نقل</td><td>شركة الشحن السريع</td><td class="ltr">١٢,٥٠٠ ر.س</td><td><span class="status-chip completed">تم</span></td></tr>
            </tbody>
          </table>
        </div>
      </div>
    `;
    document.getElementById('pageContent').innerHTML = html;
    initAcctCharts();
  }

  function initAcctCharts() {
    var c = '#2457C5', t = '#2A9D8F', a = '#C47A12';
    var ctx1 = document.getElementById('chartAcctSales');
    if (ctx1) {
      new Chart(ctx1, {
        type: 'line',
        data: { labels: ['يناير','فبراير','مارس','أبريل','مايو','يونيو'], datasets: [{ label: 'المبيعات', data: [780000,920000,1050000,980000,1150000,1240000], borderColor: c, backgroundColor: c+'18', fill: true, tension: 0.35 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: false, grid: { color: '#E2E8F0' } }, x: { grid: { display: false } } } }
      });
    }
    var ctx2 = document.getElementById('chartAcctFactory');
    if (ctx2) {
      new Chart(ctx2, {
        type: 'bar',
        data: { labels: ['النسيج الحديث','الخليج','اليمامة','العروبة','الشرق'], datasets: [{ label: 'المستحق (ر.س)', data: [128000, 96000, 54000, 38800, 26000], backgroundColor: [c, t, a, '#52657A', '#94A3B8'], borderRadius: 4 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, grid: { color: '#E2E8F0' } }, x: { grid: { display: false } } } }
      });
    }
  }

  // ============= REVIEW CENTER =============
  function renderReviewCenter() {
    var html = `
      <div class="summary-grid">
        <div class="summary-card" data-review-type="sales">
          <div class="summary-card-count">٨</div>
          <div class="summary-card-label">مبيعات تحتاج اعتماد</div>
        </div>
        <div class="summary-card warning" data-review-type="price">
          <div class="summary-card-count">٥</div>
          <div class="summary-card-label">خام مستلم بدون سعر</div>
        </div>
        <div class="summary-card warning" data-review-type="cost">
          <div class="summary-card-count">٤</div>
          <div class="summary-card-label">تشغيل يحتاج مراجعة تكلفة</div>
        </div>
        <div class="summary-card danger" data-review-type="returns">
          <div class="summary-card-count">٣</div>
          <div class="summary-card-label">مرتجعات تحتاج قرار</div>
        </div>
        <div class="summary-card warning" data-review-type="settlements">
          <div class="summary-card-count">٢</div>
          <div class="summary-card-label">تسويات غير مسددة</div>
        </div>
        <div class="summary-card danger" data-review-type="history">
          <div class="summary-card-count">٣</div>
          <div class="summary-card-label">تحذيرات ترحيل تاريخي</div>
        </div>
        <div class="summary-card danger" data-review-type="negative">
          <div class="summary-card-count">١</div>
          <div class="summary-card-label">مخزون سالب</div>
        </div>
      </div>

      <div class="filter-bar">
        <select class="form-select"><option>جميع الأنواع</option><option>مبيعات</option><option>خام بدون سعر</option><option>مراجعة تكلفة</option><option>مرتجعات</option><option>ترحيل تاريخي</option></select>
        <select class="form-select"><option>جميع الحالات</option><option>بانتظار المراجعة</option><option>قيد المراجعة</option><option>تمت المراجعة</option></select>
        <input class="form-input" type="text" placeholder="بحث…" style="min-width:200px;">
        <button class="btn btn-secondary btn-sm"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg> بحث</button>
        <button class="btn btn-ghost btn-sm">إعادة تعيين</button>
      </div>

      <div class="card" style="padding:0;overflow:hidden;">
        <div class="table-container" style="border:none;">
          <table>
            <thead><tr><th>#</th><th>نوع المراجعة</th><th>البيان</th><th>الطرف</th><th>تاريخ العملية</th><th>المبلغ / الكمية</th><th>الحالة</th><th></th></tr></thead>
            <tbody>
              <tr onclick="__app.openDrawer('تفاصيل المراجعة', getReviewDetail(1))" style="cursor:pointer;">
                <td class="ltr" style="color:var(--text-muted)">R-001</td>
                <td><span class="status-chip review">مبيعات</span></td>
                <td>فاتورة مبيعات INV-3321</td>
                <td>شركة ألفا للتجارة</td>
                <td class="ltr">٢٢/٠٦/٢٠٢٦</td>
                <td class="ltr">٤٨,٥٠٠ ر.س</td>
                <td><span class="status-chip pending">بانتظار المراجعة</span></td>
                <td><button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();__app.openDrawer('تفاصيل المراجعة', getReviewDetail(1))">عرض</button></td>
              </tr>
              <tr onclick="__app.openDrawer('تفاصيل المراجعة', getReviewDetail(2))" style="cursor:pointer;">
                <td class="ltr" style="color:var(--text-muted)">R-002</td>
                <td><span class="status-chip warning">خام بدون سعر</span></td>
                <td>استلام خام Y-7120</td>
                <td>مورد S-009</td>
                <td class="ltr">٢١/٠٦/٢٠٢٦</td>
                <td class="ltr">٥,٠٠٠ كجم</td>
                <td><span class="status-chip pending">بانتظار المراجعة</span></td>
                <td><button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();__app.openDrawer('تفاصيل المراجعة', getReviewDetail(2))">عرض</button></td>
              </tr>
              <tr onclick="__app.openDrawer('تفاصيل المراجعة', getReviewDetail(3))" style="cursor:pointer;">
                <td class="ltr" style="color:var(--text-muted)">R-003</td>
                <td><span class="status-chip warning">مراجعة تكلفة</span></td>
                <td>تشغيل خصلة TW-1182</td>
                <td>مصنع الخليج</td>
                <td class="ltr">٢٠/٠٦/٢٠٢٦</td>
                <td class="ltr">٣٢,٠٠٠ ر.س</td>
                <td><span class="status-chip review">قيد المراجعة</span></td>
                <td><button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();__app.openDrawer('تفاصيل المراجعة', getReviewDetail(3))">عرض</button></td>
              </tr>
              <tr onclick="__app.openDrawer('تفاصيل المراجعة', getReviewDetail(4))" style="cursor:pointer;">
                <td class="ltr" style="color:var(--text-muted)">R-004</td>
                <td><span class="status-chip danger">مرتجعات</span></td>
                <td>مرتجع عميل C-221</td>
                <td>شركة بيتا للتجارة</td>
                <td class="ltr">١٩/٠٦/٢٠٢٦</td>
                <td class="ltr">٢٥٠ كجم</td>
                <td><span class="status-chip pending">بانتظار المراجعة</span></td>
                <td><button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();__app.openDrawer('تفاصيل المراجعة', getReviewDetail(4))">عرض</button></td>
              </tr>
              <tr onclick="__app.openDrawer('تفاصيل المراجعة', getReviewDetail(5))" style="cursor:pointer;">
                <td class="ltr" style="color:var(--text-muted)">R-005</td>
                <td><span class="status-chip danger">ترحيل تاريخي</span></td>
                <td>رصيد افتتاحي ٢٠٢٥</td>
                <td>—</td>
                <td class="ltr">١٥/٠٦/٢٠٢٦</td>
                <td class="ltr">عشرات السجلات</td>
                <td><span class="status-chip locked">مقفول</span></td>
                <td><button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();__app.openDrawer('تفاصيل المراجعة', getReviewDetail(5))">عرض</button></td>
              </tr>
              <tr onclick="__app.openDrawer('تفاصيل المراجعة', getReviewDetail(6))" style="cursor:pointer;">
                <td class="ltr" style="color:var(--text-muted)">R-006</td>
                <td><span class="status-chip review">مبيعات</span></td>
                <td>فاتورة مبيعات INV-3319</td>
                <td>شركة جاما للنسيج</td>
                <td class="ltr">١٨/٠٦/٢٠٢٦</td>
                <td class="ltr">٣٦,٢٠٠ ر.س</td>
                <td><span class="status-chip completed">تمت المراجعة</span></td>
                <td><button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();__app.openDrawer('تفاصيل المراجعة', getReviewDetail(6))">عرض</button></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="card" style="margin-top:20px;">
        <div class="card-header"><span class="card-title">سجل المراجعة والتدقيق</span></div>
        <div class="table-container" style="border:none;">
          <table>
            <thead><tr><th>من أدخل البيانات</th><th>وقت الإدخال</th><th>القسم</th><th>نوع العملية</th><th>الحالة</th><th>آخر إجراء مراجعة</th></tr></thead>
            <tbody>
              <tr><td>أحمد السلمي</td><td class="ltr">٢٣/٠٦ ١٠:٣٢</td><td>مستودع</td><td>استلام منتج</td><td><span class="status-chip review">قيد المراجعة</span></td><td>بإنتظار التحقق من الكمية</td></tr>
              <tr><td>سعد القحطاني</td><td class="ltr">٢٣/٠٦ ٠٩:١٥</td><td>تشغيل</td><td>صرف خام</td><td><span class="status-chip approved">معتمد</span></td><td>تمت المراجعة بواسطة: عبدالله</td></tr>
              <tr><td>فهد المطيري</td><td class="ltr">٢٢/٠٦ ١٤:٠٥</td><td>جودة</td><td>تسجيل شكوى</td><td><span class="status-chip pending">بانتظار</span></td><td>بإنتظار تخصيص محقق</td></tr>
              <tr><td>نورة الشمري</td><td class="ltr">٢٢/٠٦ ١١:٤٨</td><td>مبيعات</td><td>اعتماد فاتورة</td><td><span class="status-chip approved">معتمد</span></td><td>تمت المراجعة بواسطة: عبدالله</td></tr>
              <tr><td>خالد الزهراني</td><td class="ltr">٢١/٠٦ ١٥:٢٢</td><td>مستودع</td><td>استلام خام</td><td><span class="status-chip neutral">مؤرشف</span></td><td>تمت أرشفة السجل</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    `;
    document.getElementById('pageContent').innerHTML = html;
  }

  // ============= REVIEW DETAIL HELPER =============
  window.getReviewDetail = function (id) {
    var details = {
      1: { title: 'فاتورة مبيعات INV-3321', desc: 'تحتاج اعتماد المدير', amount: '٤٨,٥٠٠ ر.س', party: 'شركة ألفا للتجارة', date: '٢٢/٠٦/٢٠٢٦', status: 'بانتظار المراجعة', items: [
        { action: 'إدخال الفاتورة', by: 'نورة الشمري', time: '٢٢/٠٦ ١١:٣٠', dept: 'مبيعات' },
        { action: 'مراجعة أولية', by: '—', time: '—', dept: '—' }
      ]},
      2: { title: 'استلام خام Y-7120', desc: 'تم الاستلام بدون تحديد السعر', amount: '٥,٠٠٠ كجم', party: 'المورد S-009', date: '٢١/٠٦/٢٠٢٦', status: 'بانتظار المراجعة', items: [
        { action: 'إدخال الاستلام', by: 'خالد الزهراني', time: '٢١/٠٦ ١٥:٢٢', dept: 'مستودع' }
      ]},
      3: { title: 'تشغيل خصلة TW-1182', desc: 'تكلفة التشغيل تحتاج تدقيق', amount: '٣٢,٠٠٠ ر.س', party: 'مصنع الخليج', date: '٢٠/٠٦/٢٠٢٦', status: 'قيد المراجعة', items: [
        { action: 'إدخال أمر تشغيل', by: 'سعد القحطاني', time: '٢٠/٠٦ ٠٩:٠٠', dept: 'تشغيل' },
        { action: 'مراجعة أولية', by: 'محمد العتيبي', time: '٢٠/٠٦ ١٤:٣٠', dept: 'تكاليف' }
      ]},
      4: { title: 'مرتجع عميل C-221', desc: 'مرتجع بضاعة بسبب عيوب لون', amount: '٢٥٠ كجم', party: 'شركة بيتا للتجارة', date: '١٩/٠٦/٢٠٢٦', status: 'بانتظار المراجعة', items: [
        { action: 'إدخال المرتجع', by: 'فهد المطيري', time: '١٩/٠٦ ١٦:١٠', dept: 'جودة' }
      ]},
      5: { title: 'رصيد افتتاحي ٢٠٢٥', desc: 'ترحيل تاريخي — سجلات مقفولة', amount: '—', party: '—', date: '١٥/٠٦/٢٠٢٦', status: 'مقفول', items: [
        { action: 'رفع البيانات', by: 'نظام', time: '١٥/٠٦ ٠٨:٠٠', dept: 'إدارة' },
        { action: 'اعتماد الترحيل', by: 'عبدالله محمد', time: '١٥/٠٦ ١٠:٠٠', dept: 'إدارة' },
        { action: 'إقفال', by: 'نظام', time: '١٥/٠٦ ١٠:٠١', dept: 'نظام' }
      ]},
      6: { title: 'فاتورة مبيعات INV-3319', desc: 'فاتورة معتمدة', amount: '٣٦,٢٠٠ ر.س', party: 'شركة جاما للنسيج', date: '١٨/٠٦/٢٠٢٦', status: 'تمت المراجعة', items: [
        { action: 'إدخال الفاتورة', by: 'نورة الشمري', time: '١٨/٠٦ ١٠:٢٠', dept: 'مبيعات' },
        { action: 'مراجعة واعتماد', by: 'عبدالله محمد', time: '١٨/٠٦ ١٤:٠٠', dept: 'إدارة' }
      ]}
    };
    var d = details[id] || details[1];
    var rows = d.items.map(function (it) {
      return '<tr><td>' + it.action + '</td><td>' + it.by + '</td><td class="ltr">' + it.time + '</td><td>' + it.dept + '</td></tr>';
    }).join('');
    return '<div style="margin-bottom:16px;"><h4 style="font-size:1.1rem;margin-bottom:4px;">' + d.title + '</h4><p style="color:var(--text-secondary);font-size:0.88rem;">' + d.desc + '</p></div><div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;"><div><strong style="color:var(--text-secondary);font-size:0.8rem;">المبلغ/الكمية</strong><br>' + d.amount + '</div><div><strong style="color:var(--text-secondary);font-size:0.8rem;">الطرف</strong><br>' + d.party + '</div><div><strong style="color:var(--text-secondary);font-size:0.8rem;">التاريخ</strong><br><span class="ltr">' + d.date + '</span></div><div><strong style="color:var(--text-secondary);font-size:0.8rem;">الحالة</strong><br><span class="status-chip pending">' + d.status + '</span></div></div><hr style="border:none;border-top:1px solid var(--border);margin:16px 0;"><h5 style="font-size:0.9rem;margin-bottom:8px;">إجراءات المراجعة</h5><div class="table-container"><table><thead><tr><th>الإجراء</th><th>بواسطة</th><th>الوقت</th><th>القسم</th></tr></thead><tbody>' + rows + '</tbody></table></div><div style="margin-top:20px;display:flex;gap:8px;"><button class="btn btn-primary btn-sm" disabled>اعتماد</button><button class="btn btn-secondary btn-sm" disabled>طلب تعديل</button><button class="btn btn-danger btn-sm" disabled>رفض</button><span style="font-size:0.75rem;color:var(--text-muted);margin-right:8px;display:flex;align-items:center;">نموذج واجهة — الأزرار معطلة</span></div>';
  };

  // ============= WORKER TASKS HUB =============
  function renderWorkerTasks() {
    var html = `
      <div class="worker-grid">
        <a class="worker-task-card" onclick="__app.navigateTo('worker-receipt-raw')" style="cursor:pointer;">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>
          <h3>استلام خام</h3>
          <p>تسجيل استلام خام جديد من المورد</p>
        </a>
        <a class="worker-task-card" onclick="__app.navigateTo('worker-stock-transfer')" style="cursor:pointer;">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14"/><path d="M12 5l7 7-7 7"/></svg>
          <h3>تحويل مخزون</h3>
          <p>نقل خام أو منتج بين المستودعات</p>
        </a>
        <a class="worker-task-card" onclick="__app.navigateTo('worker-customer-return')" style="cursor:pointer;">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12h14"/><path d="M10 5l-7 7 7 7"/></svg>
          <h3>استلام مرتجع عميل</h3>
          <p>تسجيل مرتجع بضاعة من عميل</p>
        </a>
        <a class="worker-task-card" onclick="__app.navigateTo('worker-issue-factory')" style="cursor:pointer;">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
          <h3>صرف خام لمصنع خارجي</h3>
          <p>تسجيل خام مصروف للتشغيل لدى المصنع</p>
        </a>
        <a class="worker-task-card" onclick="__app.navigateTo('worker-receipt-single-yarn')" style="cursor:pointer;">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>
          <h3>استلام لوط فرد</h3>
          <p>استلام خصلة غزل مفردة من مصنع خارجي</p>
        </a>
        <a class="worker-task-card" onclick="__app.navigateTo('worker-receipt-twisted-yarn')" style="cursor:pointer;">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-9-9"/><path d="M12 3a9 9 0 0 1 9 9"/></svg>
          <h3>استلام لوط زوى</h3>
          <p>استلام خصلة غزل مبرومة (مجمعة)</p>
        </a>
        <a class="worker-task-card" onclick="__app.navigateTo('worker-wip-return')" style="cursor:pointer;">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12h14"/><path d="M10 5l-7 7 7 7"/></svg>
          <h3>مرتجع تشغيل / وردية</h3>
          <p>تسجيل هالك أو مرتجع من التشغيل</p>
        </a>
        <a class="worker-task-card" onclick="__app.navigateTo('worker-quality-test')" style="cursor:pointer;">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
          <h3>إدخال فحص جودة</h3>
          <p>تسجيل نتائج فحص عينات الجودة</p>
        </a>
        <a class="worker-task-card" onclick="__app.navigateTo('worker-quality-hold')" style="cursor:pointer;">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          <h3>إيقاف / فك إيقاف جودة</h3>
          <p>إدارة أوامر الإيقاف الجودي</p>
        </a>
        <a class="worker-task-card" onclick="__app.navigateTo('worker-complaint')" style="cursor:pointer;">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
          <h3>تحقيق شكوى</h3>
          <p>فحص شكوى عميل وتسجيل النتائج</p>
        </a>
        <a class="worker-task-card" onclick="__app.navigateTo('worker-activity')" style="cursor:pointer;">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          <h3>آخر نشاطاتي</h3>
          <p>عرض سجل نشاطاتي الأخيرة</p>
        </a>
      </div>
    `;
    document.getElementById('pageContent').innerHTML = html;
  }

  // ============= WORKER SCREEN HELPER =============
  function renderWorkerForm(title, description, fieldsHtml, extra) {
    return '<div class="card" style="max-width:700px;"><div class="card-header"><span class="card-title">' + title + '</span></div><p style="color:var(--text-secondary);font-size:0.88rem;margin-bottom:20px;">' + description + '</p>' + fieldsHtml + (extra || '') + '<div style="margin-top:24px;display:flex;gap:12px;"><button class="btn btn-primary btn-lg" disabled>حفظ</button><button class="btn btn-secondary btn-lg" disabled>إلغاء</button><span style="font-size:0.75rem;color:var(--text-muted);margin-right:12px;display:flex;align-items:center;">نموذج واجهة — الأزرار معطلة</span></div></div>';
  }
  function renderWorkerReceiptRaw() {
    document.getElementById('pageContent').innerHTML = renderWorkerForm('استلام رسالة خام', 'تسجيل استلام رسالة خام جديدة من المورد', [
      '<div class="form-group"><label class="form-label">رقم رسالة الخام</label><input class="form-input" type="text" placeholder="RA-2024-001" dir="ltr" style="text-align:left;"></div>',
      '<div class="form-group"><label class="form-label">المورد</label><select class="form-select"><option>المورد S-009 — شركة الأمل</option><option>المورد S-012 — مؤسسة الفيصل</option></select></div>',
      '<div class="form-group"><label class="form-label">الكمية (كجم)</label><input class="form-input" type="text" placeholder="مثال: 5000"></div>',
      '<div class="form-group"><label class="form-label">عدد البالات</label><input class="form-input" type="text" placeholder="مثال: 100"></div>',
      '<div class="form-group"><label class="form-label">موقع الاستلام</label><select class="form-select"><option>المستودع الرئيسي</option><option>مستودع جدة</option><option>مستودع الدمام</option></select></div>',
      '<div class="form-group"><label class="form-label">تاريخ الاستلام</label><input class="form-input" type="text" placeholder="DD/MM/YYYY" value="23/06/2026" dir="ltr" style="text-align:left;"></div>',
      '<div class="form-group"><label class="form-label">ملاحظات</label><input class="form-input" type="text" placeholder="اختياري"></div>'
    ].join(''));
  }
  function renderWorkerStockTransfer() {
    document.getElementById('pageContent').innerHTML = renderWorkerForm('تحويل مخزون', 'نقل خام أو منتج بين المستودعات', [
      '<div class="form-group"><label class="form-label">من مستودع</label><select class="form-select"><option>المستودع الرئيسي</option><option>مستودع جدة</option></select></div>',
      '<div class="form-group"><label class="form-label">إلى مستودع</label><select class="form-select"><option>مستودع الدمام</option><option>المستودع الرئيسي</option></select></div>',
      '<div class="form-group"><label class="form-label">الصنف</label><select class="form-select"><option>Y-7120 — قطن مصري</option><option>PQ-8821 — لوط زوى</option></select></div>',
      '<div class="form-group"><label class="form-label">الكمية</label><input class="form-input" type="text" placeholder="مثال: 2000"></div>'
    ].join(''));
  }
  function renderWorkerCustomerReturn() {
    document.getElementById('pageContent').innerHTML = renderWorkerForm('استلام مرتجع عميل', 'تسجيل مرتجع بضاعة من عميل', [
      '<div class="form-group"><label class="form-label">العميل</label><select class="form-select"><option>شركة ألفا للتجارة</option><option>شركة بيتا للتجارة</option></select></div>',
      '<div class="form-group"><label class="form-label">الصنف</label><select class="form-select"><option>Y-5542 — لوط فرد</option><option>TW-1182 — لوط زوى</option></select></div>',
      '<div class="form-group"><label class="form-label">الكمية (كجم)</label><input class="form-input" type="text" placeholder="مثال: 250"></div>',
      '<div class="form-group"><label class="form-label">سبب الإرجاع</label><input class="form-input" type="text" placeholder="عيوب لون / عيوب برم / تلف"></div>'
    ].join(''));
  }
  function renderWorkerIssueFactory() {
    document.getElementById('pageContent').innerHTML = renderWorkerForm('صرف خام لمصنع خارجي', 'تسجيل خام مصروف للتشغيل لدى المصنع الخارجي', [
      '<div class="form-group"><label class="form-label">المصنع الخارجي</label><select class="form-select"><option>مصنع النسيج الحديث (فرد)</option><option>مصنع الخليج (زوى)</option><option>مصنع اليمامة (فرد)</option></select></div>',
      '<div class="form-group"><label class="form-label">نوع الخام</label><select class="form-select"><option>TM-4401 — بوليستر</option><option>Y-7120 — قطن مصري</option></select></div>',
      '<div class="form-group"><label class="form-label">الكمية (كجم)</label><input class="form-input" type="text" placeholder="مثال: 800"></div>',
      '<div class="form-group"><label class="form-label">أمر التشغيل</label><input class="form-input" type="text" placeholder="اختياري — رقم أمر التشغيل"></div>'
    ].join(''));
  }
  function renderWorkerReceiptSingleYarn() {
    document.getElementById('pageContent').innerHTML = renderWorkerForm('استلام لوط فرد', 'تسجيل استلام لوط فرد من مصنع خارجي بعد التشغيل', [
      '<div class="form-group"><label class="form-label">المصنع</label><select class="form-select"><option>مصنع النسيج الحديث (فرد)</option><option>مصنع اليمامة (فرد)</option></select></div>',
      '<div class="form-group"><label class="form-label">نوع اللوط</label><select class="form-select"><option>Y-5542 — فرد قطن</option><option>Y-3310 — فرد بوليستر</option></select></div>',
      '<div class="form-group"><label class="form-label">الكمية (كجم)</label><input class="form-input" type="text" placeholder="مثال: 1200"></div>',
      '<div class="form-group"><label class="form-label">رقم أمر التشغيل</label><input class="form-input" type="text" placeholder="PO-2024-001" dir="ltr" style="text-align:left;"></div>'
    ].join(''));
  }
  function renderWorkerReceiptTwistedYarn() {
    document.getElementById('pageContent').innerHTML = renderWorkerForm('استلام لوط زوى', 'تسجيل استلام لوط زوى (مجمعة) من مصنع خارجي', [
      '<div class="form-group"><label class="form-label">المصنع</label><select class="form-select"><option>مصنع الخليج (زوى)</option><option>مصنع العروبة (زوى)</option><option>مصنع الشرق (زوى)</option></select></div>',
      '<div class="form-group"><label class="form-label">نوع اللوط الزوى</label><select class="form-select"><option>TW-1182 — زوى قطن/بوليستر</option><option>TW-2210 — زوى بوليستر</option></select></div>',
      '<div class="form-group"><label class="form-label">الكمية (كجم)</label><input class="form-input" type="text" placeholder="مثال: 850"></div>',
      '<div class="form-group"><label class="form-label">نسبة البرم</label><input class="form-input" type="text" placeholder="مثال: 2.5%"></div>'
    ].join(''));
  }
  function renderWorkerWipReturn() {
    document.getElementById('pageContent').innerHTML = renderWorkerForm('مرتجع تشغيل / وردية', 'تسجيل هالك أو مرتجع من التشغيل لدى المصنع الخارجي', [
      '<div class="form-group"><label class="form-label">المصنع</label><select class="form-select"><option>مصنع الخليج (زوى)</option><option>مصنع النسيج الحديث (فرد)</option></select></div>',
      '<div class="form-group"><label class="form-label">نوع المرتجع</label><select class="form-select"><option>هالك تشغيل</option><option>مرتجع خام</option><option>وردية (بقايا)</option></select></div>',
      '<div class="form-group"><label class="form-label">الكمية (كجم)</label><input class="form-input" type="text" placeholder="مثال: 120"></div>',
      '<div class="form-group"><label class="form-label">ملاحظات</label><input class="form-input" type="text" placeholder="سبب الهالك / الوصف"></div>'
    ].join(''));
  }
  function renderWorkerQualityTest() {
    document.getElementById('pageContent').innerHTML = renderWorkerForm('إدخال فحص جودة', 'تسجيل نتائج فحص عينات الجودة للخام أو المنتج', [
      '<div class="form-group"><label class="form-label">نوع العينة</label><select class="form-select"><option>خام</option><option>لوط فرد</option><option>لوط زوى</option></select></div>',
      '<div class="form-group"><label class="form-label">رقم العينة</label><input class="form-input" type="text" placeholder="SMP-2024-001" dir="ltr" style="text-align:left;"></div>',
      '<div class="form-group"><label class="form-label">نتيجة الفحص</label><select class="form-select"><option>مطابق</option><option>غير مطابق</option><option>بحاجة إعادة فحص</option></select></div>',
      '<div class="form-group"><label class="form-label">نسبة القوة</label><input class="form-input" type="text" placeholder="مثال: 95%"></div>',
      '<div class="form-group"><label class="form-label">ملاحظات الفحص</label><input class="form-input" type="text" placeholder="أي ملاحظات إضافية"></div>'
    ].join(''));
  }
  function renderWorkerQualityHold() {
    document.getElementById('pageContent').innerHTML = renderWorkerForm('إيقاف / فك إيقاف جودة', 'إدارة أوامر الإيقاف الجودي للخامات أو المنتجات', [
      '<div class="form-group"><label class="form-label">الإجراء</label><select class="form-select"><option>إيقاف</option><option>فك إيقاف</option></select></div>',
      '<div class="form-group"><label class="form-label">الصنف</label><select class="form-select"><option>TM-4401 — بوليستر</option><option>Y-5542 — فرد قطن</option></select></div>',
      '<div class="form-group"><label class="form-label">سبب الإيقاف</label><input class="form-input" type="text" placeholder="سبب الإيقاف"></div>',
      '<div class="form-group"><label class="form-label">الكمية المتأثرة (كجم)</label><input class="form-input" type="text" placeholder="مثال: 500"></div>'
    ].join(''));
  }
  function renderWorkerComplaint() {
    document.getElementById('pageContent').innerHTML = renderWorkerForm('تحقيق شكوى', 'فحص شكوى عميل وتسجيل نتائج التحقيق', [
      '<div class="form-group"><label class="form-label">رقم الشكوى</label><input class="form-input" type="text" value="COMP-2024-004" dir="ltr" style="text-align:left;" disabled></div>',
      '<div class="form-group"><label class="form-label">العميل</label><input class="form-input" type="text" value="شركة بيتا للتجارة" disabled></div>',
      '<div class="form-group"><label class="form-label">نوع العيب</label><select class="form-select"><option>عيوب لون</option><option>عيوب برم</option><option>ضعف قوة</option><option>تلوث</option></select></div>',
      '<div class="form-group"><label class="form-label">نتيجة التحقيق</label><select class="form-select"><option>شكوى صحيحة</option><option>شكوى غير صحيحة</option><option>قيد الفحص</option></select></div>',
      '<div class="form-group"><label class="form-label">تفاصيل التحقيق</label><input class="form-input" type="text" placeholder"></div>'
    ].join(''));
  }
  function renderWorkerActivity() {
    document.getElementById('pageContent').innerHTML = '<div class="card"><div class="card-header"><span class="card-title">آخر نشاطاتي</span></div><div class="timeline">' +
      '<div class="timeline-item"><div class="timeline-dot success"></div><div class="timeline-date ltr">٢٣/٠٦ — ١٠:٣٢</div><div class="timeline-text">استلام منتج مبروم PQ-8821 — ١٬٢٠٠ كجم</div></div>' +
      '<div class="timeline-item"><div class="timeline-dot"></div><div class="timeline-date ltr">٢٣/٠٦ — ٠٩:١٥</div><div class="timeline-text">صرف خام TM-4401 إلى مصنع الخليج — ٨٠٠ كجم</div></div>' +
      '<div class="timeline-item"><div class="timeline-dot"></div><div class="timeline-date ltr">٢٢/٠٦ — ١٥:٢٢</div><div class="timeline-text">استلام خام Y-7120 من المورد S-009 — ٥٬٠٠٠ كجم</div></div>' +
      '<div class="timeline-item"><div class="timeline-dot"></div><div class="timeline-date ltr">٢٢/٠٦ — ١١:٠٠</div><div class="timeline-text">تحويل مخزون من المستودع الرئيسي إلى مستودع جدة — ٢٬٠٠٠ كجم</div></div>' +
      '</div></div>';
  }

  // ============= INVENTORY =============
  function renderInventory() {
    document.getElementById('pageContent').innerHTML = `
      <div class="filter-bar">
        <select class="form-select"><option>جميع المستودعات</option><option>المستودع الرئيسي</option><option>مستودع جدة</option><option>مستودع الدمام</option></select>
        <select class="form-select"><option>جميع الأنواع</option><option>خام</option><option>لوط فرد</option><option>لوط زوى</option></select>
        <input class="form-input" type="text" placeholder="بحث عن صنف…" style="min-width:200px;">
        <button class="btn btn-primary btn-sm"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg> بحث</button>
        <button class="btn btn-ghost btn-sm">تصدير</button>
      </div>
      <div class="card" style="padding:0;overflow:hidden;">
        <div class="table-container" style="border:none;">
          <table>
            <thead><tr><th>الكود</th><th>الصنف</th><th>النوع</th><th>المستودع</th><th>الكمية (كجم)</th><th>الحد الأدنى</th><th>الحالة</th></tr></thead>
            <tbody>
              <tr><td class="ltr">Y-7120</td><td>قطن مصري</td><td>خام</td><td>المستودع الرئيسي</td><td class="ltr">١٢,٤٠٠</td><td class="ltr">٢,٠٠٠</td><td><span class="status-chip approved">متوفر</span></td></tr>
              <tr><td class="ltr">TM-4401</td><td>بوليستر</td><td>خام</td><td>المستودع الرئيسي</td><td class="ltr">٨,٢٠٠</td><td class="ltr">١,٥٠٠</td><td><span class="status-chip approved">متوفر</span></td></tr>
              <tr><td class="ltr">TM-3301</td><td>قطن/بوليستر</td><td>خام</td><td>المستودع الرئيسي</td><td class="ltr">٨٠</td><td class="ltr">١,٠٠٠</td><td><span class="status-chip danger">أقل من الحد</span></td></tr>
              <tr><td class="ltr">Y-5542</td><td>فرد قطن</td><td>لوط فرد</td><td>مستودع جدة</td><td class="ltr">٣,٦٠٠</td><td class="ltr">٥٠٠</td><td><span class="status-chip approved">متوفر</span></td></tr>
              <tr><td class="ltr">TW-1182</td><td>زوى قطن/بوليستر</td><td>لوط زوى</td><td>المستودع الرئيسي</td><td class="ltr">٢,١٠٠</td><td class="ltr">٣٠٠</td><td><span class="status-chip approved">متوفر</span></td></tr>
              <tr><td class="ltr">Y-3310</td><td>فرد بوليستر</td><td>لوط فرد</td><td>مستودع الدمام</td><td class="ltr">١,٨٠٠</td><td class="ltr">٤٠٠</td><td><span class="status-chip approved">متوفر</span></td></tr>
              <tr><td class="ltr">PQ-8821</td><td>زوى بوليستر</td><td>لوط زوى</td><td>المستودع الرئيسي</td><td class="ltr">١,٢٠٠</td><td class="ltr">٣٠٠</td><td><span class="status-chip approved">متوفر</span></td></tr>
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  // ============= WIP =============
  function renderWip() {
    document.getElementById('pageContent').innerHTML = `
      <div class="filter-bar">
        <select class="form-select"><option>جميع المصانع</option><option>مصنع النسيج الحديث (فرد)</option><option>مصنع الخليج (زوى)</option><option>مصنع اليمامة (فرد)</option><option>مصنع العروبة (زوى)</option><option>مصنع الشرق (زوى)</option></select>
        <select class="form-select"><option>جميع الحالات</option><option>قيد التشغيل</option><option>مكتمل</option></select>
      </div>
      <div class="kpi-grid" style="grid-template-columns:repeat(4,1fr)">
        <div class="kpi-card slate"><div class="kpi-card-icon" style="background:var(--primary-bg);color:var(--primary);"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg></div><div class="kpi-card-label">خام مصروف للتشغيل</div><div class="kpi-card-value">٤٥,٣٠٠ <small style="font-size:0.6em;color:var(--text-muted)">كجم</small></div></div>
        <div class="kpi-card info"><div class="kpi-card-icon" style="background:var(--accent-light);color:var(--accent);"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg></div><div class="kpi-card-label">منتج مستلم من التشغيل</div><div class="kpi-card-value">٢٨,١٠٠ <small style="font-size:0.6em;color:var(--text-muted)">كجم</small></div></div>
        <div class="kpi-card warning"><div class="kpi-card-icon" style="background:var(--warning-bg);color:var(--warning);"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></div><div class="kpi-card-label">هالك / مرتجع تشغيل</div><div class="kpi-card-value">٢,١٥٠ <small style="font-size:0.6em;color:var(--text-muted)">كجم</small></div></div>
        <div class="kpi-card slate"><div class="kpi-card-icon" style="background:var(--slate-bg);color:var(--slate);"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg></div><div class="kpi-card-label">مستحقات مصانع خارجية</div><div class="kpi-card-value">٣٤٢,٨٠٠ <small style="font-size:0.6em;color:var(--text-muted)">ر.س</small></div></div>
      </div>
      <div class="card" style="padding:0;overflow:hidden;">
        <div class="table-container" style="border:none;">
          <table>
            <thead><tr><th>أمر التشغيل</th><th>المصنع</th><th>الخام المصروف</th><th>الكمية (كجم)</th><th>تاريخ الصرف</th><th>المستلم (كجم)</th><th>الهالك (كجم)</th><th>الحالة</th></tr></thead>
            <tbody>
              <tr><td class="ltr">PO-001</td><td>النسيج الحديث</td><td>TM-4401</td><td class="ltr">١٢,٠٠٠</td><td class="ltr">٠١/٠٦</td><td class="ltr">٨,٥٠٠</td><td class="ltr">٣٤٠</td><td><span class="status-chip review">قيد التشغيل</span></td></tr>
              <tr><td class="ltr">PO-002</td><td>مصنع الخليج</td><td>Y-7120</td><td class="ltr">٨,٠٠٠</td><td class="ltr">٠٥/٠٦</td><td class="ltr">—</td><td class="ltr">—</td><td><span class="status-chip review">قيد التشغيل</span></td></tr>
              <tr><td class="ltr">PO-003</td><td>مصنع اليمامة</td><td>TM-3301</td><td class="ltr">٦,٠٠٠</td><td class="ltr">١٠/٠٦</td><td class="ltr">٤,٢٠٠</td><td class="ltr">١١٠</td><td><span class="status-chip approved">مكتمل</span></td></tr>
              <tr><td class="ltr">PO-004</td><td>النسيج الحديث</td><td>Y-7120</td><td class="ltr">١٠,٠٠٠</td><td class="ltr">١٥/٠٦</td><td class="ltr">٧,٨٠٠</td><td class="ltr">٢٥٠</td><td><span class="status-chip review">قيد التشغيل</span></td></tr>
              <tr><td class="ltr">PO-005</td><td>مصنع العروبة</td><td>TM-4401</td><td class="ltr">٥,٠٠٠</td><td class="ltr">١٨/٠٦</td><td class="ltr">٣,٦٠٠</td><td class="ltr">—</td><td><span class="status-chip approved">مكتمل</span></td></tr>
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  // ============= SALES =============
  function renderSales() {
    document.getElementById('pageContent').innerHTML = `
      <div class="filter-bar">
        <select class="form-select"><option>جميع الحالات</option><option>بانتظار الاعتماد</option><option>معتمد</option><option>ملغاة</option></select>
        <input class="form-input" type="text" placeholder="بحث عن فاتورة…" style="min-width:200px;">
        <button class="btn btn-primary btn-sm"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg> بحث</button>
        <button class="btn btn-secondary btn-sm" disabled>فاتورة جديدة</button>
      </div>
      <div class="card" style="padding:0;overflow:hidden;">
        <div class="table-container" style="border:none;">
          <table>
            <thead><tr><th>رقم الفاتورة</th><th>العميل</th><th>التاريخ</th><th>الصنف</th><th>الكمية</th><th>المبلغ</th><th>الحالة</th><th></th></tr></thead>
            <tbody>
              <tr><td class="ltr">INV-3321</td><td>شركة ألفا للتجارة</td><td class="ltr">٢٢/٠٦</td><td>لوط زوى TW-1182</td><td class="ltr">٢,٠٠٠ كجم</td><td class="ltr">٤٨,٥٠٠ ر.س</td><td><span class="status-chip pending">بانتظار الاعتماد</span></td><td><button class="btn btn-ghost btn-sm">عرض</button></td></tr>
              <tr><td class="ltr">INV-3319</td><td>شركة جاما للنسيج</td><td class="ltr">١٨/٠٦</td><td>لوط فرد Y-5542</td><td class="ltr">١,٥٠٠ كجم</td><td class="ltr">٣٦,٢٠٠ ر.س</td><td><span class="status-chip approved">معتمد</span></td><td><button class="btn btn-ghost btn-sm">عرض</button></td></tr>
              <tr><td class="ltr">INV-3318</td><td>شركة دلتا للنسيج</td><td class="ltr">١٥/٠٦</td><td>خام قطن Y-7120</td><td class="ltr">٣,٠٠٠ كجم</td><td class="ltr">٥٥,٠٠٠ ر.س</td><td><span class="status-chip approved">معتمد</span></td><td><button class="btn btn-ghost btn-sm">عرض</button></td></tr>
              <tr><td class="ltr">INV-3317</td><td>شركة بيتا للتجارة</td><td class="ltr">١٢/٠٦</td><td>لوط زوى PQ-8821</td><td class="ltr">٨٠٠ كجم</td><td class="ltr">٢١,٠٠٠ ر.س</td><td><span class="status-chip cancelled">ملغاة</span></td><td><button class="btn btn-ghost btn-sm">عرض</button></td></tr>
              <tr><td class="ltr">INV-3316</td><td>شركة ألفا للتجارة</td><td class="ltr">١٠/٠٦</td><td>لوط فرد Y-3310</td><td class="ltr">١,٠٠٠ كجم</td><td class="ltr">٢٤,٠٠٠ ر.س</td><td><span class="status-chip approved">معتمد</span></td><td><button class="btn btn-ghost btn-sm">عرض</button></td></tr>
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  // ============= PAYMENTS =============
  function renderPayments() {
    document.getElementById('pageContent').innerHTML = `
      <div class="filter-bar">
        <select class="form-select"><option>جميع الحالات</option><option>معلق</option><option>تم</option><option>ملغى</option></select>
        <select class="form-select"><option>الكل</option><option>مصانع خارجية</option><option>موردين</option><option>نقل</option></select>
      </div>
      <div class="card" style="padding:0;overflow:hidden;">
        <div class="table-container" style="border:none;">
          <table>
            <thead><tr><th>رقم الدفعة</th><th>الطرف</th><th>النوع</th><th>التاريخ</th><th>المبلغ</th><th>طريقة الدفع</th><th>الحالة</th></tr></thead>
            <tbody>
              <tr><td class="ltr">PMT-001</td><td>مصنع النسيج الحديث</td><td>تشغيل</td><td class="ltr">٢٣/٠٦</td><td class="ltr">٤٥,٠٠٠ ر.س</td><td>بنكي</td><td><span class="status-chip completed">تم</span></td></tr>
              <tr><td class="ltr">PMT-002</td><td>شركة ألفا للتجارة</td><td>سداد فاتورة</td><td class="ltr">٢٢/٠٦</td><td class="ltr">٤٨,٥٠٠ ر.س</td><td>شيك</td><td><span class="status-chip completed">تم</span></td></tr>
              <tr><td class="ltr">PMT-003</td><td>مصنع الخليج</td><td>تشغيل</td><td class="ltr">٢١/٠٦</td><td class="ltr">٣٢,٠٠٠ ر.س</td><td>بنكي</td><td><span class="status-chip pending">معلق</span></td></tr>
              <tr><td class="ltr">PMT-004</td><td>المورد S-009</td><td>خام</td><td class="ltr">٢٠/٠٦</td><td class="ltr">١٢٠,٠٠٠ ر.س</td><td>بنكي</td><td><span class="status-chip completed">تم</span></td></tr>
              <tr><td class="ltr">PMT-005</td><td>شركة الشحن السريع</td><td>نقل</td><td class="ltr">٢٠/٠٦</td><td class="ltr">١٢,٥٠٠ ر.س</td><td>نقدي</td><td><span class="status-chip cancelled">ملغى</span></td></tr>
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  // ============= PARTY BALANCES =============
  function renderPartyBalances() {
    document.getElementById('pageContent').innerHTML = `
      <div class="filter-bar">
        <select class="form-select"><option>جميع الأطراف</option><option>عملاء</option><option>موردين</option><option>مصانع خارجية</option></select>
        <input class="form-input" type="text" placeholder="بحث…" style="min-width:200px;">
      </div>
      <div class="card" style="padding:0;overflow:hidden;">
        <div class="table-container" style="border:none;">
          <table>
            <thead><tr><th>الطرف</th><th>النوع</th><th>رصيد مدين</th><th>رصيد دائن</th><th>آخر حركة</th><th>الحالة</th></tr></thead>
            <tbody>
              <tr><td>شركة ألفا للتجارة</td><td>عميل</td><td class="ltr">٤٨,٥٠٠ ر.س</td><td class="ltr">—</td><td class="ltr">٢٢/٠٦</td><td><span class="status-chip warning">متأخر</span></td></tr>
              <tr><td>مصنع النسيج الحديث</td><td>مصنع خارجي</td><td class="ltr">—</td><td class="ltr">١٢٨,٠٠٠ ر.س</td><td class="ltr">٢٣/٠٦</td><td><span class="status-chip info">مسدد جزئياً</span></td></tr>
              <tr><td>المورد S-009</td><td>مورد</td><td class="ltr">—</td><td class="ltr">٢٤٠,٠٠٠ ر.س</td><td class="ltr">١٥/٠٦</td><td><span class="status-chip approved">جاري</span></td></tr>
              <tr><td>شركة بيتا للتجارة</td><td>عميل</td><td class="ltr">٢١,٠٠٠ ر.س</td><td class="ltr">—</td><td class="ltr">١٢/٠٦</td><td><span class="status-chip danger">متأخر جداً</span></td></tr>
              <tr><td>مصنع الخليج</td><td>مصنع خارجي</td><td class="ltr">—</td><td class="ltr">٩٦,٠٠٠ ر.س</td><td class="ltr">٢١/٠٦</td><td><span class="status-chip info">مسدد جزئياً</span></td></tr>
              <tr><td>مصنع اليمامة</td><td>مصنع خارجي</td><td class="ltr">—</td><td class="ltr">٥٤,٠٠٠ ر.س</td><td class="ltr">١٨/٠٦</td><td><span class="status-chip approved">جاري</span></td></tr>
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  // ============= DIRECT COSTS =============
  function renderDirectCosts() {
    document.getElementById('pageContent').innerHTML = `
      <div class="kpi-grid" style="grid-template-columns:repeat(3,1fr)">
        <div class="kpi-card warning"><div class="kpi-card-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg></div><div class="kpi-card-label">تكاليف تحتاج مراجعة</div><div class="kpi-card-value">٣</div></div>
        <div class="kpi-card info"><div class="kpi-card-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg></div><div class="kpi-card-label">إجمالي التكاليف (هذا الشهر)</div><div class="kpi-card-value">٧٦,٢٠٠ <small style="font-size:0.6em;color:var(--text-muted)">ر.س</small></div></div>
        <div class="kpi-card success"><div class="kpi-card-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg></div><div class="kpi-card-label">تمت المراجعة</div><div class="kpi-card-value">١٢</div></div>
      </div>
      <div class="card"><div class="card-header"><span class="card-title">سجل التكاليف المباشرة</span></div><div class="table-container">
        <table>
          <thead><tr><th>الرقم</th><th>البيان</th><th>الطرف</th><th>المبلغ</th><th>التاريخ</th><th>حالة المراجعة</th></tr></thead>
          <tbody>
            <tr><td class="ltr">DC-001</td><td>تكاليف نقل خام</td><td>شركة الشحن السريع</td><td class="ltr">١٢,٠٠٠ ر.س</td><td class="ltr">٢٢/٠٦</td><td><span class="status-chip approved">تمت المراجعة</span></td></tr>
            <tr><td class="ltr">DC-002</td><td>تكاليف فرز وتدريج</td><td>مستودع الدمام</td><td class="ltr">٨,٥٠٠ ر.س</td><td class="ltr">٢١/٠٦</td><td><span class="status-chip needs-review">بحاجة مراجعة</span></td></tr>
            <tr><td class="ltr">DC-003</td><td>تكاليف تعبئة وتغليف</td><td>مستودع جدة</td><td class="ltr">١٥,٢٠٠ ر.س</td><td class="ltr">٢٠/٠٦</td><td><span class="status-chip pending">معلقة</span></td></tr>
            <tr><td class="ltr">DC-004</td><td>عمولة وسيط</td><td>مؤسسة سالم للتسويق</td><td class="ltr">٢٢,٠٠٠ ر.س</td><td class="ltr">١٨/٠٦</td><td><span class="status-chip needs-review">بحاجة مراجعة</span></td></tr>
            <tr><td class="ltr">DC-005</td><td>رسوم جمركية واردة</td><td>ميناء الملك عبدالعزيز</td><td class="ltr">١٨,٥٠٠ ر.س</td><td class="ltr">١٥/٠٦</td><td><span class="status-chip approved">تمت المراجعة</span></td></tr>
          </tbody>
        </table>
      </div></div>
      <div class="card"><div class="card-header"><span class="card-title">تفاصيل التكلفة — DC-002</span></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;padding:0 20px 20px;">
          <div><label style="font-size:0.75rem;color:var(--text-muted);display:block;">نوع التكلفة</label><span>تكاليف فرز وتدريج</span></div>
          <div><label style="font-size:0.75rem;color:var(--text-muted);display:block;">الطرف</label><span>مستودع الدمام</span></div>
          <div><label style="font-size:0.75rem;color:var(--text-muted);display:block;">المبلغ</label><span class="ltr">٨,٥٠٠ ر.س</span></div>
          <div><label style="font-size:0.75rem;color:var(--text-muted);display:block;">التاريخ</label><span class="ltr">٢١/٠٦/٢٠٢٦</span></div>
          <div><label style="font-size:0.75rem;color:var(--text-muted);display:block;">ملاحظات</label><span>تكاليف فرز ٣ بالات — يحتاج تدقيق الفاتورة</span></div>
        </div>
        <div style="display:flex;gap:8px;padding:0 20px 20px;">
          <button disabled class="btn btn-primary">اعتماد التكلفة</button>
          <button disabled class="btn btn-outline">طلب تعديل</button>
          <button disabled class="btn btn-outline danger">رفض</button>
        </div>
        <div style="padding:0 20px 20px;font-size:0.75rem;color:var(--text-muted)"><em>نموذج واجهة — الأزرار معطلة</em></div>
      </div>
    `;
  }

  // ============= QUALITY & RETURNS =============
  function renderQualityReturns() {
    document.getElementById('pageContent').innerHTML = `
      <div class="kpi-grid" style="grid-template-columns:repeat(4,1fr)">
        <div class="kpi-card accent"><div class="kpi-card-icon" style="background:var(--success-bg);color:var(--success);"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg></div><div class="kpi-card-label">عينات مطابقة</div><div class="kpi-card-value">٨٩٪</div></div>
        <div class="kpi-card danger"><div class="kpi-card-icon" style="background:var(--danger-bg);color:var(--danger);"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></div><div class="kpi-card-label">عينات غير مطابقة</div><div class="kpi-card-value">١١٪</div></div>
        <div class="kpi-card warning"><div class="kpi-card-icon" style="background:var(--warning-bg);color:var(--warning);"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg></div><div class="kpi-card-label">شكاوى مفتوحة</div><div class="kpi-card-value">٤</div></div>
        <div class="kpi-card info"><div class="kpi-card-icon" style="background:var(--primary-bg);color:var(--primary);"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg></div><div class="kpi-card-label">أوامر إيقاف نشطة</div><div class="kpi-card-value">٢</div></div>
      </div>
      <div class="card"><div class="card-header"><span class="card-title">سجل فحوصات الجودة</span></div><div class="table-container" style="border:none;"><table>
        <thead><tr><th>رقم العينة</th><th>الصنف</th><th>التاريخ</th><th>النتيجة</th><th>الفحص بواسطة</th></tr></thead>
        <tbody>
          <tr><td class="ltr">SMP-001</td><td>TM-4401</td><td class="ltr">٢٣/٠٦</td><td><span class="status-chip approved">مطابق</span></td><td>فهد المطيري</td></tr>
          <tr><td class="ltr">SMP-002</td><td>Y-5542</td><td class="ltr">٢٢/٠٦</td><td><span class="status-chip pending">إعادة فحص</span></td><td>فهد المطيري</td></tr>
          <tr><td class="ltr">SMP-003</td><td>Y-7120</td><td class="ltr">٢٢/٠٦</td><td><span class="status-chip approved">مطابق</span></td><td>سعد القحطاني</td></tr>
          <tr><td class="ltr">SMP-004</td><td>TW-1182</td><td class="ltr">٢١/٠٦</td><td><span class="status-chip danger">غير مطابق</span></td><td>فهد المطيري</td></tr>
        </tbody>
      </table></div></div>
    `;
  }

  // ============= TRACEABILITY =============
  function renderTraceability() {
    document.getElementById('pageContent').innerHTML = `
      <div class="filter-bar">
        <input class="form-input" type="text" placeholder="رقم الشحنة أو الباركود…" dir="ltr" style="min-width:250px;text-align:left;">
        <button class="btn btn-primary"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg> تتبع</button>
      </div>
      <div class="card">
        <div class="card-header"><span class="card-title">مسار الشحنة — Y-7120-001</span></div>
        <div class="timeline">
          <div class="timeline-item"><div class="timeline-dot success"></div><div class="timeline-date ltr">٢٣/٠٦ ١٠:٣٢</div><div class="timeline-text"><strong>استلام منتج مبروم</strong> — PQ-8821 من مصنع النسيج الحديث</div></div>
          <div class="timeline-item"><div class="timeline-dot"></div><div class="timeline-date ltr">٢٠/٠٦ ١٤:٠٠</div><div class="timeline-text"><strong>صرف للتشغيل</strong> — إلى مصنع النسيج الحديث بكمية ١٠٬٠٠٠ كجم (أمر PO-004)</div></div>
          <div class="timeline-item"><div class="timeline-dot"></div><div class="timeline-date ltr">١٨/٠٦ ٠٩:٠٠</div><div class="timeline-text"><strong>فحص جودة</strong> — عينة مطابقة (SMP-003)</div></div>
          <div class="timeline-item"><div class="timeline-dot"></div><div class="timeline-date ltr">١٥/٠٦ ٠٨:٠٠</div><div class="timeline-text"><strong>استلام خام</strong> — خام Y-7120 من المورد S-009 بكمية ١٢٬٤٠٠ كجم</div></div>
          <div class="timeline-item"><div class="timeline-dot"></div><div class="timeline-date ltr">١٠/٠٦ ١١:٠٠</div><div class="timeline-text"><strong>تسليم مورد</strong> — وصول الشحنة من المورد إلى المستودع الرئيسي</div></div>
        </div>
      </div>
    `;
  }

  // ============= MIGRATION =============
  function renderMigration() {
    document.getElementById('pageContent').innerHTML = `
      <div class="kpi-grid" style="grid-template-columns:repeat(4,1fr)">
        <div class="kpi-card success"><div class="kpi-card-icon" style="background:var(--success-bg);color:var(--success);"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg></div><div class="kpi-card-label">تم الترحيل</div><div class="kpi-card-value">٤٢٣</div></div>
        <div class="kpi-card warning"><div class="kpi-card-icon" style="background:var(--warning-bg);color:var(--warning);"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/></svg></div><div class="kpi-card-label">قيد المراجعة</div><div class="kpi-card-value">١٢</div></div>
        <div class="kpi-card danger"><div class="kpi-card-icon" style="background:var(--danger-bg);color:var(--danger);"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></div><div class="kpi-card-label">فشل الترحيل</div><div class="kpi-card-value">٣</div></div>
        <div class="kpi-card slate"><div class="kpi-card-icon" style="background:var(--slate-bg);color:var(--slate);"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></div><div class="kpi-card-label">مقفول</div><div class="kpi-card-value">٤١٠</div></div>
      </div>
      <div class="card" style="padding:0;overflow:hidden;margin-bottom:20px;">
        <div class="table-container" style="border:none;">
          <table>
            <thead><tr><th>الدفعة</th><th>عدد السجلات</th><th>تاريخ الرفع</th><th>بواسطة</th><th>حالة الترحيل</th><th>حالة الإقفال</th></tr></thead>
            <tbody>
              <tr><td class="ltr">MIG-2025-01</td><td>١٨٠</td><td class="ltr">١٥/٠٦</td><td>عبدالله محمد</td><td><span class="status-chip approved">معتمد</span></td><td><span class="status-chip locked">مقفول</span></td></tr>
              <tr><td class="ltr">MIG-2025-02</td><td>١٢٠</td><td class="ltr">١٦/٠٦</td><td>نورة الشمري</td><td><span class="status-chip approved">معتمد</span></td><td><span class="status-chip locked">مقفول</span></td></tr>
              <tr><td class="ltr">MIG-2025-03</td><td>٩٠</td><td class="ltr">١٧/٠٦</td><td>خالد الزهراني</td><td><span class="status-chip review">قيد المراجعة</span></td><td><span class="status-chip neutral">مفتوح</span></td></tr>
              <tr><td class="ltr">MIG-2025-04</td><td>٣٥</td><td class="ltr">١٨/٠٦</td><td>محمد العتيبي</td><td><span class="status-chip pending">بانتظار</span></td><td><span class="status-chip neutral">مفتوح</span></td></tr>
              <tr class="locked"><td class="ltr">MIG-2025-00</td><td>١٢</td><td class="ltr">١٠/٠٦</td><td>نظام</td><td><span class="status-chip danger">فشل</span></td><td><span class="status-chip locked">مقفول</span></td></tr>
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  // ============= REPORTS =============
  function renderReports() {
    document.getElementById('pageContent').innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px;">
        <a class="worker-task-card" style="cursor:pointer;"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg><h3>تقرير المخزون</h3><p>المخزون الكامل حسب الموقع والصنف</p></a>
        <a class="worker-task-card" style="cursor:pointer;"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg><h3>تقرير المبيعات</h3><p>المبيعات حسب العميل والفترة</p></a>
        <a class="worker-task-card" style="cursor:pointer;"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg><h3>تقرير التشغيل</h3><p>حالة التشغيل لدى المصانع الخارجية</p></a>
        <a class="worker-task-card" style="cursor:pointer;"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg><h3>تقرير الجودة</h3><p>نتائج الفحوصات والشكاوى</p></a>
        <a class="worker-task-card" style="cursor:pointer;"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg><h3>تقرير الأرباح</h3><p>ربحية تقريبية حسب الشهر</p></a>
        <a class="worker-task-card" style="cursor:pointer;"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg><h3>تقرير التتبع</h3><p>تتبع الشحنات الكامل</p></a>
      </div>
    `;
  }

  // ============= BACKUP =============
  function renderBackup() {
    document.getElementById('pageContent').innerHTML = `
      <div class="kpi-grid" style="grid-template-columns:repeat(3,1fr)">
        <div class="kpi-card info"><div class="kpi-card-icon" style="background:var(--success-bg);color:var(--success);"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg></div><div class="kpi-card-label">آخر نسخة احتياطية</div><div class="kpi-card-value">٢٣/٠٦</div><div class="kpi-card-change up">تمت بنجاح</div></div>
        <div class="kpi-card accent"><div class="kpi-card-icon" style="background:var(--primary-bg);color:var(--primary);"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></div><div class="kpi-card-label">آخر اختبار استعادة</div><div class="kpi-card-value">٢٢/٠٦</div><div class="kpi-card-change up">تم التحقق من السلامة</div></div>
        <div class="kpi-card slate"><div class="kpi-card-icon" style="background:var(--slate-bg);color:var(--slate);"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></div><div class="kpi-card-label">عدد النسخ المتاحة</div><div class="kpi-card-value">١٥</div></div>
      </div>
      <div class="card"><div class="card-header"><span class="card-title">حالة النسخ الاحتياطي</span></div><div class="table-container" style="border:none;"><table>
        <thead><tr><th>التاريخ</th><th>نوع النسخة</th><th>الحجم</th><th>طريقة النسخ</th><th>الحالة</th><th>اختبار الاستعادة</th></tr></thead>
        <tbody>
          <tr><td class="ltr">٢٣/٠٦ ٠٣:٠٠</td><td>كاملة</td><td>١.٢ جيجابايت</td><td>تلقائي</td><td><span class="status-chip approved">ناجحة</span></td><td><span class="status-chip approved">تم</span></td></tr>
          <tr><td class="ltr">٢٢/٠٦ ٠٣:٠٠</td><td>كاملة</td><td>١.٢ جيجابايت</td><td>تلقائي</td><td><span class="status-chip approved">ناجحة</span></td><td><span class="status-chip approved">تم</span></td></tr>
          <tr><td class="ltr">٢١/٠٦ ٠٣:٠٠</td><td>كاملة</td><td>١.١ جيجابايت</td><td>تلقائي</td><td><span class="status-chip approved">ناجحة</span></td><td><span class="status-chip pending">لم يتم</span></td></tr>
          <tr><td class="ltr">٢٠/٠٦ ٠٣:٠٠</td><td>كاملة</td><td>١.١ جيجابايت</td><td>تلقائي</td><td><span class="status-chip danger">فشلت</span></td><td><span class="status-chip neutral">—</span></td></tr>
        </tbody>
      </table></div><p style="margin-top:12px;font-size:0.8rem;color:var(--text-muted);">ملاحظة: التصدير إلى Excel لا يعتبر نسخة احتياطية. النسخ الاحتياطية تتم على خادم آمن.</p></div>
      <div style="margin-top:16px;display:flex;gap:12px;">
        <button class="btn btn-primary" disabled><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> إنشاء نسخة احتياطية</button>
        <button class="btn btn-secondary" disabled><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> اختبار استعادة</button>
        <span style="font-size:0.75rem;color:var(--text-muted);margin-right:12px;display:flex;align-items:center;">نموذج واجهة — الأزرار معطلة</span>
      </div>
    `;
  }

  // ============= USERS =============
  function renderUsers() {
    document.getElementById('pageContent').innerHTML = `
      <div class="card" style="padding:0;overflow:hidden;">
        <div class="table-container" style="border:none;">
          <table>
            <thead><tr><th>الاسم</th><th>البريد الإلكتروني</th><th>الدور</th><th>القسم</th><th>الحالة</th><th>آخر تسجيل دخول</th></tr></thead>
            <tbody>
              <tr><td>عبدالله محمد</td><td dir="ltr" style="text-align:left;">abdullah@example.com</td><td>مالك</td><td>إدارة</td><td><span class="status-chip approved">نشط</span></td><td class="ltr">٢٣/٠٦ ٠٨:٣٠</td></tr>
              <tr><td>نورة الشمري</td><td dir="ltr" style="text-align:left;">noura@example.com</td><td>محاسب</td><td>مالية</td><td><span class="status-chip approved">نشط</span></td><td class="ltr">٢٣/٠٦ ٠٩:٠٠</td></tr>
              <tr><td>خالد الزهراني</td><td dir="ltr" style="text-align:left;">khaled@example.com</td><td>عامل مستودع</td><td>مستودع</td><td><span class="status-chip approved">نشط</span></td><td class="ltr">٢٣/٠٦ ٠٧:٤٥</td></tr>
              <tr><td>فهد المطيري</td><td dir="ltr" style="text-align:left;">fahad@example.com</td><td>عامل جودة</td><td>جودة</td><td><span class="status-chip approved">نشط</span></td><td class="ltr">٢٢/٠٦ ١٤:٠٠</td></tr>
              <tr><td>سعد القحطاني</td><td dir="ltr" style="text-align:left;">saad@example.com</td><td>مشرف تشغيل</td><td>تشغيل</td><td><span class="status-chip approved">نشط</span></td><td class="ltr">٢٣/٠٦ ٠٩:١٥</td></tr>
              <tr><td>محمد العتيبي</td><td dir="ltr" style="text-align:left;">mohamed@example.com</td><td>محاسب تكاليف</td><td>مالية</td><td><span class="status-chip neutral">غير نشط</span></td><td class="ltr">١٠/٠٦ ١٢:٠٠</td></tr>
              <tr><td>أحمد السلمي</td><td dir="ltr" style="text-align:left;">ahmed@example.com</td><td>مستقبل</td><td>مستودع</td><td><span class="status-chip approved">نشط</span></td><td class="ltr">٢١/٠٦ ١٦:٠٠</td></tr>
            </tbody>
          </table>
        </div>
      </div>
      <div style="margin-top:16px;display:flex;gap:12px;">
        <button class="btn btn-primary" disabled>إضافة مستخدم</button>
        <span style="font-size:0.75rem;color:var(--text-muted);display:flex;align-items:center;">نموذج واجهة — الأزرار معطلة</span>
      </div>
    `;
  }

  // ============= SETTINGS =============
  function renderSettings() {
    document.getElementById('pageContent').innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;">
        <div class="card"><div class="card-header"><span class="card-title">الإعدادات العامة</span></div>
          <div class="form-group"><label class="form-label">اسم الشركة</label><input class="form-input" type="text" value="مؤسسة الغزل والتشغيل التجارية"></div>
          <div class="form-group"><label class="form-label">العملة الافتراضية</label><select class="form-select"><option>ريال سعودي (ر.س)</option><option>دولار أمريكي ($)</option></select></div>
          <div class="form-group"><label class="form-label">اللغة</label><select class="form-select"><option>العربية</option><option>English</option></select></div>
        </div>
        <div class="card"><div class="card-header"><span class="card-title">حدود التنبيهات</span></div>
          <div class="form-group"><label class="form-label">الحد الأدنى للمخزون (تنبيه)</label><input class="form-input" type="text" value="٣٠٠ كجم"></div>
          <div class="form-group"><label class="form-label">المهلة للشكوى (أيام)</label><input class="form-input" type="text" value="١٤"></div>
          <div class="form-group"><label class="form-label">نسبة هالك مسموحة</label><input class="form-input" type="text" value="٣٪"></div>
        </div>
      </div>
      <div style="margin-top:16px;display:flex;gap:12px;">
        <button class="btn btn-primary" disabled>حفظ الإعدادات</button>
        <span style="font-size:0.75rem;color:var(--text-muted);display:flex;align-items:center;">نموذج واجهة — الأزرار معطلة</span>
      </div>
    `;
  }

  // ============= SCREEN INDEX =============
  function renderScreenIndex() {
    document.getElementById('pageContent').innerHTML = '';
    document.getElementById('pageTitle').textContent = 'فهرس الشاشات';
    var screens = [
      { code: 'DASH-01', name: 'لوحة المالك', page: 'dashboard-owner' },
      { code: 'DASH-02', name: 'لوحة المحاسب', page: 'dashboard-accountant' },
      { code: 'APPR-01', name: 'مركز المراجعة', page: 'review-center' },
      { code: 'WRK-01', name: 'المهام التشغيلية', page: 'worker-tasks' },
      { code: 'WRK-02', name: 'استلام خام', page: 'worker-receipt-raw' },
      { code: 'WRK-03', name: 'تحويل مخزون', page: 'worker-stock-transfer' },
      { code: 'WRK-04', name: 'استلام مرتجع عميل', page: 'worker-customer-return' },
      { code: 'WRK-05', name: 'صرف خام لمصنع خارجي', page: 'worker-issue-factory' },
      { code: 'WRK-06', name: 'استلام لوط فرد', page: 'worker-receipt-single-yarn' },
      { code: 'WRK-07', name: 'استلام لوط زوى', page: 'worker-receipt-twisted-yarn' },
      { code: 'WRK-08', name: 'مرتجع تشغيل/وردية', page: 'worker-wip-return' },
      { code: 'WRK-09', name: 'إدخال فحص جودة', page: 'worker-quality-test' },
      { code: 'WRK-10', name: 'إيقاف/فك إيقاف جودة', page: 'worker-quality-hold' },
      { code: 'WRK-11', name: 'تحقيق شكوى', page: 'worker-complaint' },
      { code: 'WRK-12', name: 'آخر نشاطاتي', page: 'worker-activity' },
      { code: 'INV-01', name: 'المخزون الكامل', page: 'inventory' },
      { code: 'WIP-01', name: 'تحت التشغيل', page: 'wip' },
      { code: 'SAL-01', name: 'المبيعات', page: 'sales' },
      { code: 'PAY-01', name: 'المدفوعات', page: 'payments' },
      { code: 'BAL-01', name: 'أرصدة الأطراف', page: 'party-balances' },
      { code: 'QRT-01', name: 'الجودة والمرتجعات', page: 'quality-returns' },
      { code: 'TRC-01', name: 'تتبع الشحنات', page: 'traceability' },
      { code: 'MIG-01', name: 'الترحيل التاريخي', page: 'migration' },
      { code: 'RPT-01', name: 'التقارير', page: 'reports' },
      { code: 'BAK-01', name: 'النسخ الاحتياطي', page: 'backup' },
      { code: 'USR-01', name: 'المستخدمون والأدوار', page: 'users' },
      { code: 'SET-01', name: 'الإعدادات', page: 'settings' }
    ];
    var items = screens.map(function (s) {
      return '<a class="screen-index-item" onclick="__app.navigateTo(\'' + s.page + '\')" href="#' + s.page + '"><span class="screen-index-code">' + s.code + '</span><span class="screen-index-name">' + s.name + '</span></a>';
    }).join('');
    document.getElementById('pageContent').innerHTML = '<div class="screen-index-grid">' + items + '</div>';
  }

  // ============= PAGE MAP =============
  var pages = {
    'dashboard-owner': renderDashboardOwner,
    'dashboard-accountant': renderDashboardAccountant,
    'review-center': renderReviewCenter,
    'worker-tasks': renderWorkerTasks,
    'worker-receipt-raw': renderWorkerReceiptRaw,
    'worker-stock-transfer': renderWorkerStockTransfer,
    'worker-customer-return': renderWorkerCustomerReturn,
    'worker-issue-factory': renderWorkerIssueFactory,
    'worker-receipt-single-yarn': renderWorkerReceiptSingleYarn,
    'worker-receipt-twisted-yarn': renderWorkerReceiptTwistedYarn,
    'worker-wip-return': renderWorkerWipReturn,
    'worker-quality-test': renderWorkerQualityTest,
    'worker-quality-hold': renderWorkerQualityHold,
    'worker-complaint': renderWorkerComplaint,
    'worker-activity': renderWorkerActivity,
    'inventory': renderInventory,
    'wip': renderWip,
    'sales': renderSales,
    'payments': renderPayments,
    'party-balances': renderPartyBalances,
    'direct-costs': renderDirectCosts,
    'quality-returns': renderQualityReturns,
    'traceability': renderTraceability,
    'migration': renderMigration,
    'reports': renderReports,
    'backup': renderBackup,
    'users': renderUsers,
    'settings': renderSettings,
    'screen-index': renderScreenIndex
  };

  window.renderPage = function (page) {
    if (typeof __app !== 'undefined' && __app.destroyCharts) __app.destroyCharts();
    if (pages[page]) pages[page]();
    else pages['screen-index']();
  };

})();

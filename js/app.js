(function () {
  'use strict';

  const sidebar = document.getElementById('sidebar');
  const sidebarToggle = document.getElementById('sidebarToggle');
  const sidebarNav = document.getElementById('sidebarNav');
  const pageContent = document.getElementById('pageContent');
  const pageTitle = document.getElementById('pageTitle');
  const drawerOverlay = document.getElementById('drawerOverlay');
  const drawer = document.getElementById('drawer');
  const drawerTitle = document.getElementById('drawerTitle');
  const drawerBody = document.getElementById('drawerBody');
  const drawerClose = document.getElementById('drawerClose');
  const modeSelector = document.getElementById('modeSelector');

  let currentPage = 'dashboard-owner';
  let charts = [];
  let drawerCallback = null;

  // ===== SIDEBAR TOGGLE =====
  sidebarToggle.addEventListener('click', function () {
    sidebar.classList.toggle('collapsed');
  });

  // ===== DRAWER =====
  function openDrawer(title, content) {
    drawerTitle.textContent = title;
    drawerBody.innerHTML = content;
    drawer.classList.add('open');
    drawerOverlay.classList.add('open');
  }

  function closeDrawer() {
    drawer.classList.remove('open');
    drawerOverlay.classList.remove('open');
  }

  drawerClose.addEventListener('click', closeDrawer);
  drawerOverlay.addEventListener('click', closeDrawer);

  // ===== SET PAGE TITLE =====
  var pageTitles = {
    'dashboard-owner': 'لوحة المالك',
    'dashboard-accountant': 'لوحة المحاسب',
    'review-center': 'مركز المراجعة',
    'worker-tasks': 'المهام التشغيلية',
    'worker-receipt-raw': 'استلام خام',
    'worker-stock-transfer': 'تحويل مخزون',
    'worker-customer-return': 'استلام مرتجع عميل',
    'worker-activity': 'آخر نشاطاتي',
    'worker-issue-factory': 'صرف خام لمصنع خارجي',
    'worker-receipt-single-yarn': 'استلام خصلة مفردة',
    'worker-receipt-twisted-yarn': 'استلام خصلة مبرومة',
    'worker-wip-return': 'مرتجع تشغيل / وردية',
    'worker-quality-test': 'إدخال فحص جودة',
    'worker-quality-hold': 'إيقاف / فك إيقاف جودة',
    'worker-complaint': 'تحقيق شكوى',
    'inventory': 'المخزون الكامل',
    'wip': 'تحت التشغيل لدى المصانع الخارجية',
    'sales': 'المبيعات',
    'payments': 'المدفوعات',
    'party-balances': 'أرصدة الأطراف',
    'direct-costs': 'تكاليف مباشرة',
    'quality-returns': 'الجودة والمرتجعات',
    'traceability': 'تتبع الشحنات',
    'migration': 'الترحيل التاريخي',
    'reports': 'التقارير',
    'backup': 'النسخ الاحتياطي والاستعادة',
    'users': 'المستخدمون والأدوار',
    'settings': 'الإعدادات',
    'screen-index': 'فهرس الشاشات'
  };

  // ===== NAVIGATION =====
  sidebarNav.addEventListener('click', function (e) {
    var link = e.target.closest('.nav-item');
    if (!link) return;
    e.preventDefault();
    var page = link.getAttribute('data-page');
    if (page) navigateTo(page);
  });

  window.addEventListener('hashchange', function () {
    var page = window.location.hash.replace('#', '') || 'dashboard-owner';
    if (typeof renderPage === 'function' && pageTitles[page]) {
      navigateTo(page);
    }
  });

  function navigateTo(page) {
    currentPage = page;
    window.location.hash = page;

    document.querySelectorAll('.nav-item').forEach(function (n) {
      n.classList.toggle('active', n.getAttribute('data-page') === page);
    });

    pageTitle.textContent = pageTitles[page] || page;
    renderPage(page);
  }

  // ===== MODE SELECTOR =====
  modeSelector.addEventListener('change', function () {
    var mode = this.value;
    if (mode === 'owner') {
      navigateTo('dashboard-owner');
    } else if (mode === 'accountant') {
      navigateTo('dashboard-accountant');
    } else if (mode === 'worker') {
      navigateTo('worker-tasks');
    }
  });

  // ===== CHART HELPERS =====
  function destroyCharts() {
    charts.forEach(function (c) {
      if (c && typeof c.destroy === 'function') c.destroy();
    });
    charts = [];
  }

  function createChart(canvasId, config) {
    var canvas = document.getElementById(canvasId);
    if (!canvas) return null;
    var ctx = canvas.getContext('2d');
    try {
      var chart = new Chart(ctx, config);
      charts.push(chart);
      return chart;
    } catch (e) {
      return null;
    }
  }

  // ===== EXPOSE GLOBALLY =====
  window.__app = {
    navigateTo: navigateTo,
    openDrawer: openDrawer,
    closeDrawer: closeDrawer,
    destroyCharts: destroyCharts,
    createChart: createChart,
    pageTitles: pageTitles,
    currentPage: function () { return currentPage; }
  };

  // ===== INIT =====
  var initialPage = window.location.hash.replace('#', '') || 'dashboard-owner';
  if (pageTitles[initialPage]) {
    navigateTo(initialPage);
  } else {
    navigateTo('dashboard-owner');
  }

})();

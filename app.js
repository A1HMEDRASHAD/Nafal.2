import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { 
  initializeFirestore, getFirestore, collection, doc, addDoc, updateDoc, onSnapshot 
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// 1. إعدادات الاتصال بقاعدة بيانات فايربيس
const firebaseConfig = {
  apiKey: "AIzaSyAtCSiIDDN9nceKMj2xZbjREy9qXFEv68k",
  authDomain: "rawi-ye02.firebaseapp.com",
  projectId: "rawi-ye02",
  storageBucket: "rawi-ye02.firebasestorage.app",
  messagingSenderId: "247996335759",
  appId: "1:247996335759:web:846f6e93f75175bddc92fa",
  measurementId: "G-0RDKKNKSJJ"
};

let app;
let db;
if (getApps().length === 0) {
  app = initializeApp(firebaseConfig);
  db = initializeFirestore(app, {
    experimentalForceLongPolling: true,
    ignoreUndefinedProperties: true
  });
} else {
  app = getApps()[0];
  db = getFirestore(app);
}

const DEFAULT_COFFEE_IMG = "https://images.unsplash.com/photo-1559056199-641a0ac8b55e?auto=format&fit=crop&w=800&q=80";

// متغيرات المنصة والبيانات الحية
let marketConfig = {
  showMarketplace: true,
  platformName: "سوق نفال — شرورة",
  platformSlogan: "ارحبوا في سوق نفال.. كل متاجر وأسر شرورة بين يديك!",
  platformBanner: "التوصيل والخدمة مخصصة لأهلنا داخل شرورة فقط",
  platformLogo: "",
  marketCategories: ["متاجر القهوة والمحامص", "الأسر المنتجة والحلى", "العسل والسمن والتمور", "العطور والبخور", "متاجر متنوعة"]
};

let allStores = [];
let allProducts = [];

// فلاتر التصفح الحالية
let selectedMarketCat = "all";
let selectedProductType = "all";
let searchQueryText = "";

// حالة العرض الحالية (السوق، متجر معين، أو صفحة منتج مستقلة)
let activeStoreId = null;
let activeStoreInternalCat = "all";
let activeProductId = null;
let activeProductQty = 1;
let selectedRatingStars = 5;

// نظام "عرباتي" (سلة مستقلة لكل متجر يطلب منه الزبون)
// الهيكل: { [storeId]: { storeId, items: [ { id, name, price, qty, maxStock, freeDelivery } ] } }
let multiCarts = JSON.parse(localStorage.getItem("nafal_multi_carts") || "{}");
let activeCheckoutStoreId = null;
let savedInvoices = JSON.parse(localStorage.getItem("nafal_my_invoices") || "[]");

function showToast(msg) {
  const toast = document.getElementById("toast");
  document.getElementById("toastText").textContent = msg;
  toast.classList.remove("hidden");
  setTimeout(() => toast.classList.add("hidden"), 3000);
}

// 2. تحديث بيانات محركات البحث (Google SEO & Schema.org) والروابط العميقة
function updateSeoMeta({ title, description, type = "WebSite", image = "", price = null, storeName = "" }) {
  document.title = title;
  const metaTitle = document.getElementById("pageMetaTitle");
  const metaDesc = document.getElementById("pageMetaDesc");
  const ogTitle = document.getElementById("ogMetaTitle");
  const ogDesc = document.getElementById("ogMetaDesc");
  if (metaTitle) metaTitle.textContent = title;
  if (metaDesc) metaDesc.setAttribute("content", description);
  if (ogTitle) ogTitle.setAttribute("content", title);
  if (ogDesc) ogDesc.setAttribute("content", description);

  const schemaEl = document.getElementById("seoJsonLd");
  if (!schemaEl) return;

  let schemaObj = {
    "@context": "https://schema.org",
    "@type": type,
    "name": title,
    "description": description,
    "url": window.location.href
  };

  if (type === "Product" && price !== null) {
    schemaObj = {
      "@context": "https://schema.org/",
      "@type": "Product",
      "name": title,
      "image": image ? [image] : [],
      "description": description,
      "brand": { "@type": "Brand", "name": storeName || "سوق نفال شرورة" },
      "offers": {
        "@type": "Offer",
        "priceCurrency": "SAR",
        "price": price,
        "availability": "https://schema.org/InStock",
        "url": window.location.href
      }
    };
  } else if (type === "Store") {
    schemaObj = {
      "@context": "https://schema.org",
      "@type": "Store",
      "name": title,
      "description": description,
      "image": image || undefined,
      "address": { "@type": "PostalAddress", "addressLocality": "شرورة", "addressCountry": "SA" }
    };
  }

  schemaEl.textContent = JSON.stringify(schemaObj);
}

// 3. دوال فحص حالة المتجر (الصيانة / الاشتراك / ساعات الدوام)
function isStoreUnderMaintenance(store) {
  if (!store) return true;
  if (store.storeStatus === "maintenance") return true;
  const todayStr = new Date().toISOString().split("T")[0];
  if (store.subExpiry && store.subExpiry < todayStr) return true;
  return false;
}

function checkStoreWorkState(store) {
  if (isStoreUnderMaintenance(store)) {
    return {
      canOrder: false,
      badgeText: "تحت الصيانة حالياً",
      badgeClass: "maint",
      hoursLabel: "المحل تحت الصيانة حالياً",
      reasonMsg: "هذا المحل تحت الصيانة حالياً يا غالي، سلتك محفوظة وتقدر تطلب أول ما يرجع للعمل!"
    };
  }

  const mode = store.workMode || "24h";
  if (mode === "24h") {
    return {
      canOrder: true,
      badgeText: "مفتوح الحين",
      badgeClass: "open",
      hoursLabel: "مفتوح 24 ساعة",
      reasonMsg: ""
    };
  }

  if (mode === "closed") {
    return {
      canOrder: false,
      badgeText: "مقفل الحين",
      badgeClass: "closed",
      hoursLabel: "مغلق مؤقتاً",
      reasonMsg: "المحل مقفل الحين يا غالي.. تقدر تضيف اللي بخاطرك للسلة، وانتظر لين يفتح المحل وأكد طلبك!"
    };
  }

  // فحص جدول ساعات الدوام تلقائياً
  const openStr = store.openTime || "08:00";
  const closeStr = store.closeTime || "23:30";
  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  const [openH, openM] = openStr.split(":").map(Number);
  const [closeH, closeM] = closeStr.split(":").map(Number);
  const openTotal = openH * 60 + openM;
  const closeTotal = closeH * 60 + closeM;

  let isOpenNow = false;
  if (closeTotal >= openTotal) {
    isOpenNow = currentMinutes >= openTotal && currentMinutes <= closeTotal;
  } else {
    // دوام يمتد لبعد منتصف الليل
    isOpenNow = currentMinutes >= openTotal || currentMinutes <= closeTotal;
  }

  const hoursLabel = `الدوام: ${openStr} إلى ${closeStr}`;
  if (isOpenNow) {
    return {
      canOrder: true,
      badgeText: "مفتوح الحين",
      badgeClass: "open",
      hoursLabel,
      reasonMsg: ""
    };
  } else {
    return {
      canOrder: false,
      badgeText: `مقفل (يفتح ${openStr})`,
      badgeClass: "closed",
      hoursLabel,
      reasonMsg: `المحل مقفل الحين (أوقات الدوام من ${openStr} إلى ${closeStr}). سلتك محفوظة، انتظر لين يفتح المحل وأكد طلبك!`
    };
  }
}

function getStoreRatingText(store) {
  if (!store || !store.ratingCount) return "5.0 ★";
  return `${(Number(store.ratingSum || 5) / Number(store.ratingCount || 1)).toFixed(1)} ★`;
}

function getProductImages(prod) {
  const list = [];
  if (Array.isArray(prod.images) && prod.images.length > 0) {
    prod.images.forEach(u => { if (u && typeof u === "string" && u.trim()) list.push(u.trim()); });
  }
  if (prod.imageUrl && !list.includes(prod.imageUrl.trim())) {
    list.unshift(prod.imageUrl.trim());
  }
  if (list.length === 0) list.push(DEFAULT_COFFEE_IMG);
  return list;
}

// 4. الاستماع المباشر لإعدادات المنصة، المتاجر، والمنتجات
function initRealtimeListeners() {
  onSnapshot(doc(db, "nafal_platform", "marketConfig"), snap => {
    if (snap.exists()) {
      marketConfig = { ...marketConfig, ...snap.data() };
      applyPlatformSettings();
    }
  });

  onSnapshot(collection(db, "nafal_stores"), snap => {
    allStores = [];
    snap.forEach(d => allStores.push({ id: d.id, ...d.data() }));
    allStores.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    refreshCurrentViews();
  });

  onSnapshot(collection(db, "nafal_products"), snap => {
    allProducts = [];
    snap.forEach(d => allProducts.push({ id: d.id, ...d.data() }));
    allProducts.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    refreshCurrentViews();
  });
}

function applyPlatformSettings() {
  document.getElementById("platformTitle").textContent = marketConfig.platformName || "سوق نفال";
  document.getElementById("platformSlogan").textContent = marketConfig.platformSlogan || "";
  document.getElementById("platformBannerText").textContent = marketConfig.platformBanner || "شرورة فقط";
  document.getElementById("footerName").textContent = marketConfig.platformName || "سوق نفال — شرورة";

  const logoImg = document.getElementById("platformLogoImg");
  const logoIcon = document.getElementById("platformLogoIcon");
  if (marketConfig.platformLogo) {
    logoImg.src = marketConfig.platformLogo;
    logoImg.classList.remove("hidden");
    logoIcon.classList.add("hidden");
  } else {
    logoImg.classList.add("hidden");
    logoIcon.classList.remove("hidden");
  }

  // إظهار أو إخفاء قسم المتاجر بناءً على قرار الإدارة العليا
  const storesDir = document.getElementById("storesDirectorySection");
  if (marketConfig.showMarketplace === false) {
    storesDir.classList.add("hidden");
  } else {
    storesDir.classList.remove("hidden");
  }

  renderMarketCategoryPills();
}

function renderMarketCategoryPills() {
  const bar = document.getElementById("marketCategoriesBar");
  bar.innerHTML = `
    <button type="button" class="cat-pill ${selectedMarketCat === 'all' ? 'active' : ''}" data-mcat="all">
      <i class="ri-apps-2-line"></i><span>كل المتاجر</span>
    </button>
  `;

  (marketConfig.marketCategories || []).forEach(cat => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `cat-pill ${selectedMarketCat === cat ? "active" : ""}`;
    btn.dataset.mcat = cat;
    btn.innerHTML = `<i class="ri-store-2-line"></i><span>${cat}</span>`;
    bar.appendChild(btn);
  });

  bar.querySelectorAll(".cat-pill").forEach(btn => {
    btn.addEventListener("click", () => {
      selectedMarketCat = btn.dataset.mcat;
      renderMarketCategoryPills();
      renderMarketplaceStores();
    });
  });
}

// 5. التوجيه الذكي بين الواجهات والروابط (Routing)
function handleUrlRouting() {
  const params = new URLSearchParams(window.location.search);
  const prodParam = params.get("product");
  const storeParam = params.get("store");

  if (prodParam) {
    openProductPage(prodParam, false);
  } else if (storeParam) {
    openSingleStore(storeParam, false);
  } else {
    showMarketplaceHome(false);
  }
}

window.addEventListener("popstate", handleUrlRouting);

function refreshCurrentViews() {
  renderMarketplaceStores();
  renderMarketplaceProducts();

  if (activeProductId) {
    const prod = allProducts.find(p => p.id === activeProductId);
    if (prod) populateProductPageUI(prod);
  } else if (activeStoreId) {
    const st = allStores.find(s => s.id === activeStoreId);
    if (st) populateSingleStoreUI(st);
  }

  updateMultiCartsDockUI();
}

function showMarketplaceHome(pushHistory = true) {
  activeStoreId = null;
  activeProductId = null;

  document.getElementById("marketplaceView").classList.remove("hidden");
  document.getElementById("singleStoreView").classList.add("hidden");
  document.getElementById("singleProductPageView").classList.add("hidden");

  if (pushHistory) {
    window.history.pushState({}, "", window.location.pathname);
  }

  updateSeoMeta({
    title: `${marketConfig.platformName} | متاجر وأسر شرورة بين يديك`,
    description: marketConfig.platformSlogan,
    type: "WebSite"
  });

  window.scrollTo({ top: 0, behavior: "smooth" });
}

document.getElementById("goHomeBrandBtn").addEventListener("click", () => showMarketplaceHome(true));
document.getElementById("dockHomeBtn").addEventListener("click", () => showMarketplaceHome(true));
document.getElementById("backToMarketBtn").addEventListener("click", () => showMarketplaceHome(true));

// 6. عرض المتاجر والمنتجات في السوق الشعبي الرئيسي
function renderMarketplaceStores() {
  const grid = document.getElementById("storesGrid");
  grid.innerHTML = "";

  const q = searchQueryText.trim().toLowerCase();
  const filteredStores = allStores.filter(st => {
    const matchCat = selectedMarketCat === "all" || st.marketCategory === selectedMarketCat;
    const matchSearch = !q || (st.name || "").toLowerCase().includes(q) || (st.description || "").toLowerCase().includes(q);
    return matchCat && matchSearch;
  });

  if (filteredStores.length === 0) {
    grid.innerHTML = `
      <div class="loading-box glass-panel">
        <i class="ri-store-2-line"></i>
        <span>ما لقينا متاجر مطابقة لبحثك حالياً</span>
      </div>
    `;
    return;
  }

  filteredStores.forEach(st => {
    const workState = checkStoreWorkState(st);
    const prodCount = allProducts.filter(p => p.storeId === st.id).length;

    const card = document.createElement("div");
    card.className = "store-card";
    card.innerHTML = `
      <div class="store-card-head">
        <div class="store-card-logo">
          ${st.logo ? `<img src="${st.logo}" alt="${st.name}">` : `<i class="ri-store-2-line"></i>`}
        </div>
        <div class="store-card-info">
          <div class="store-card-title-row">
            <h3 class="store-card-title">${st.name}</h3>
            <span class="rating-chip">${getStoreRatingText(st)}</span>
          </div>
          <p class="store-card-desc">${st.description || st.marketCategory || "متجر محلي في شرورة"}</p>
        </div>
      </div>

      <div class="store-card-footer">
        <span><i class="ri-shopping-bag-3-line"></i> ${prodCount} منتج | التوصيل: ${st.baseDeliveryFee ?? 15} ريال</span>
        <span class="work-status-chip ${workState.badgeClass}">${workState.badgeText}</span>
      </div>
    `;

    card.addEventListener("click", () => openSingleStore(st.id, true));
    grid.appendChild(card);
  });
}

function renderMarketplaceProducts() {
  const grid = document.getElementById("marketProductsGrid");
  grid.innerHTML = "";

  const q = searchQueryText.trim().toLowerCase();
  const visibleProducts = allProducts.filter(prod => {
    const parentStore = allStores.find(s => s.id === prod.storeId);
    // إخفاء منتجات المتاجر التي تحت الصيانة من الصفحة العامة للسوق
    if (parentStore && isStoreUnderMaintenance(parentStore)) return false;

    const matchType = selectedProductType === "all" || prod.productType === selectedProductType;
    const matchSearch = !q || 
      (prod.name || "").toLowerCase().includes(q) || 
      (prod.description || "").toLowerCase().includes(q) || 
      (prod.storeName || "").toLowerCase().includes(q);
    return matchType && matchSearch;
  });

  if (visibleProducts.length === 0) {
    grid.innerHTML = `
      <div class="loading-box glass-panel">
        <i class="ri-cup-line"></i>
        <span>لا توجد منتجات مطابقة حالياً</span>
      </div>
    `;
    return;
  }

  visibleProducts.forEach(prod => {
    grid.appendChild(createProductCardElement(prod, true));
  });
}

document.querySelectorAll(".quick-type-filter .mini-filter-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".quick-type-filter .mini-filter-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    selectedProductType = btn.dataset.ptype;
    renderMarketplaceProducts();
  });
});

// محرك البحث الفوري
document.getElementById("globalSearchInput").addEventListener("input", (e) => {
  searchQueryText = e.target.value;
  const clearBtn = document.getElementById("clearSearchBtn");
  if (searchQueryText.trim() !== "") {
    clearBtn.classList.remove("hidden");
  } else {
    clearBtn.classList.add("hidden");
  }

  if (activeStoreId) {
    const st = allStores.find(s => s.id === activeStoreId);
    if (st) renderSingleStoreProducts(st);
  } else {
    renderMarketplaceStores();
    renderMarketplaceProducts();
  }
});

document.getElementById("clearSearchBtn").addEventListener("click", () => {
  document.getElementById("globalSearchInput").value = "";
  searchQueryText = "";
  document.getElementById("clearSearchBtn").classList.add("hidden");
  refreshCurrentViews();
});

// بناء بطاقة منتج قياسية (شبكي 2 بالجوال و 4 بالكمبيوتر)
function createProductCardElement(prod, showStoreName = true) {
  const outOfStock = Number(prod.stock) <= 0;
  const images = getProductImages(prod);
  const parentStore = allStores.find(s => s.id === prod.storeId);
  const storeName = parentStore ? parentStore.name : (prod.storeName || "متجر نفال");

  const card = document.createElement("div");
  card.className = "product-card";
  card.innerHTML = `
    <div class="product-img-wrap">
      <img src="${images[0]}" alt="${prod.name}" loading="lazy">
      ${prod.productType === "bundle" ? `<span class="badge-bundle">🔥 بكج توفير</span>` : ""}
      ${prod.freeDelivery ? `<span class="badge-free-delivery"><i class="ri-truck-line"></i> توصيل مجاني</span>` : ""}
      <span class="badge-category">${prod.category || "عام"}</span>
      ${images.length > 1 ? `<span class="multi-img-indicator"><i class="ri-image-2-line"></i> ${images.length}</span>` : ""}
    </div>
    <div class="product-info">
      ${showStoreName ? `<div class="prod-store-mini"><i class="ri-store-2-line"></i><span>${storeName}</span></div>` : ""}
      <h3 class="product-title">${prod.name}</h3>
      <p class="product-desc">${prod.description || "اضغط لعرض التفاصيل الكاملة"}</p>
      <div class="product-footer">
        <span class="product-price">
          ${prod.price} <small>ريال</small>
          ${prod.oldPrice ? `<del>${prod.oldPrice}</del>` : ""}
        </span>
        <button type="button" class="btn-add" ${outOfStock ? "disabled" : ""}>
          <i class="${outOfStock ? 'ri-forbid-2-line' : 'ri-add-line'}"></i>
          <span>${outOfStock ? "نفذت" : "أضف"}</span>
        </button>
      </div>
    </div>
  `;

  card.addEventListener("click", (e) => {
    if (e.target.closest(".btn-add")) return;
    openProductPage(prod.id, true);
  });

  if (!outOfStock) {
    card.querySelector(".btn-add").addEventListener("click", (e) => {
      e.stopPropagation();
      addItemToStoreCart(prod, 1);
    });
  }

  return card;
}

// 7. واجهة المتجر الفردي (Single Store View)
function openSingleStore(storeId, pushHistory = true) {
  activeStoreId = storeId;
  activeProductId = null;
  activeStoreInternalCat = "all";

  document.getElementById("marketplaceView").classList.add("hidden");
  document.getElementById("singleProductPageView").classList.add("hidden");
  document.getElementById("singleStoreView").classList.remove("hidden");

  if (pushHistory) {
    window.history.pushState({}, "", `?store=${storeId}`);
  }

  const st = allStores.find(s => s.id === storeId);
  if (st) {
    populateSingleStoreUI(st);
  }
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function populateSingleStoreUI(st) {
  const workState = checkStoreWorkState(st);

  document.getElementById("stViewName").textContent = st.name;
  document.getElementById("stViewDesc").textContent = st.description || "أهلاً بكم في متجرنا بسوق نفال شرورة";
  document.getElementById("stViewRatingBadge").textContent = getStoreRatingText(st);

  const workBadge = document.getElementById("stViewWorkBadge");
  workBadge.textContent = workState.badgeText;
  workBadge.className = `work-status-chip ${workState.badgeClass}`;

  document.getElementById("stViewHoursText").innerHTML = `<i class="ri-time-line"></i> ${workState.hoursLabel}`;
  document.getElementById("stViewMinOrderText").innerHTML = `<i class="ri-shopping-basket-line"></i> ${st.minOrderAmount ? `الحد الأدنى: ${st.minOrderAmount} ريال` : "بدون حد أدنى"}`;
  document.getElementById("stViewDeliveryText").innerHTML = `<i class="ri-e-bike-2-line"></i> التوصيل: ${st.baseDeliveryFee ?? 15} ريال`;

  const logoImg = document.getElementById("stViewLogoImg");
  const logoIcon = document.getElementById("stViewLogoIcon");
  if (st.logo) {
    logoImg.src = st.logo;
    logoImg.classList.remove("hidden");
    logoIcon.classList.add("hidden");
  } else {
    logoImg.classList.add("hidden");
    logoIcon.classList.remove("hidden");
  }

  // روابط موقع المحل والتواصل
  toggleElementLink("stViewMapsLink", st.mapsUrl);
  toggleElementLink("stViewSnapLink", st.snapchatUrl);
  toggleElementLink("stViewTiktokLink", st.tiktokUrl);
  toggleElementLink("stViewInstaLink", st.instagramUrl);

  // شريط عروض التوصيل
  const promoStrip = document.getElementById("stViewPromoStrip");
  if (st.promoMessage) {
    document.getElementById("stViewPromoText").textContent = st.promoMessage;
    promoStrip.classList.remove("hidden");
  } else {
    promoStrip.classList.add("hidden");
  }

  // تنبيه إذا كان المحل تحت الصيانة أو مغلق حالياً
  const stateNotice = document.getElementById("stViewStateNotice");
  if (!workState.canOrder) {
    stateNotice.textContent = workState.reasonMsg;
    stateNotice.classList.remove("hidden");
  } else {
    stateNotice.classList.add("hidden");
  }

  // تحديث SEO للمتجر
  updateSeoMeta({
    title: `${st.name} | سوق نفال شرورة`,
    description: st.description || `تصفح منتجات ${st.name} واطلب مباشرة داخل شرورة`,
    type: "Store",
    image: st.logo || ""
  });

  renderSingleStoreCategories(st);
  renderSingleStoreProducts(st);
}

function toggleElementLink(id, url) {
  const el = document.getElementById(id);
  if (!el) return;
  if (url && url.trim() !== "") {
    el.href = url.trim();
    el.classList.remove("hidden");
  } else {
    el.classList.add("hidden");
  }
}

function renderSingleStoreCategories(st) {
  const bar = document.getElementById("stViewCategoriesBar");
  bar.innerHTML = `
    <button type="button" class="cat-pill ${activeStoreInternalCat === 'all' ? 'active' : ''}" data-scat="all">
      <i class="ri-apps-2-line"></i><span>كل أقسام المحل</span>
    </button>
  `;

  (st.categories || []).forEach(cat => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `cat-pill ${activeStoreInternalCat === cat ? "active" : ""}`;
    btn.dataset.scat = cat;
    btn.innerHTML = `<i class="ri-price-tag-3-line"></i><span>${cat}</span>`;
    bar.appendChild(btn);
  });

  bar.querySelectorAll(".cat-pill").forEach(btn => {
    btn.addEventListener("click", () => {
      activeStoreInternalCat = btn.dataset.scat;
      renderSingleStoreCategories(st);
      renderSingleStoreProducts(st);
    });
  });
}

function renderSingleStoreProducts(st) {
  const grid = document.getElementById("stViewProductsGrid");
  grid.innerHTML = "";

  // إذا كان المتجر تحت الصيانة، نعرض رسالة صيانة أنيقة
  if (isStoreUnderMaintenance(st)) {
    grid.innerHTML = `
      <div class="loading-box glass-panel">
        <i class="ri-tools-line"></i>
        <span>هذا المحل تحت الصيانة حالياً وسيرجع لخدمتكم قريباً بإذن الله</span>
      </div>
    `;
    return;
  }

  const q = searchQueryText.trim().toLowerCase();
  const storeProds = allProducts.filter(p => {
    if (p.storeId !== st.id) return false;
    const matchCat = activeStoreInternalCat === "all" || p.category === activeStoreInternalCat;
    const matchSearch = !q || (p.name || "").toLowerCase().includes(q) || (p.description || "").toLowerCase().includes(q);
    return matchCat && matchSearch;
  });

  if (storeProds.length === 0) {
    grid.innerHTML = `
      <div class="loading-box glass-panel">
        <i class="ri-shopping-bag-3-line"></i>
        <span>لا توجد منتجات مضافة في هذا القسم حالياً</span>
      </div>
    `;
    return;
  }

  storeProds.forEach(prod => {
    grid.appendChild(createProductCardElement(prod, false));
  });
}

// مشاركة رابط المتجر وتقييم المتجر بالنجوم
document.getElementById("shareStoreBtn").addEventListener("click", () => {
  if (!activeStoreId) return;
  const url = `${window.location.origin}${window.location.pathname}?store=${activeStoreId}`;
  navigator.clipboard.writeText(url).then(() => showToast("تم نسخ رابط المحل! شاركه مع من تحب"));
});

document.getElementById("rateStoreBtn").addEventListener("click", () => {
  if (!activeStoreId) return;
  document.getElementById("ratingModal").classList.remove("hidden");
});

document.getElementById("closeRatingModalBtn").addEventListener("click", () => {
  document.getElementById("ratingModal").classList.add("hidden");
});

document.querySelectorAll("#starsSelector button").forEach(btn => {
  btn.addEventListener("click", () => {
    selectedRatingStars = Number(btn.dataset.star);
    document.querySelectorAll("#starsSelector button").forEach(b => {
      b.classList.toggle("active", Number(b.dataset.star) <= selectedRatingStars);
    });
  });
});

document.getElementById("submitRatingBtn").addEventListener("click", async () => {
  if (!activeStoreId) return;
  const ratedList = JSON.parse(localStorage.getItem("nafal_rated_stores") || "[]");
  if (ratedList.includes(activeStoreId)) {
    showToast("يعطيك العافية، سبق وقيّمت هذا المحل!");
    document.getElementById("ratingModal").classList.add("hidden");
    return;
  }

  const st = allStores.find(s => s.id === activeStoreId);
  if (!st) return;

  await updateDoc(doc(db, "nafal_stores", activeStoreId), {
    ratingSum: Number(st.ratingSum || 5) + selectedRatingStars,
    ratingCount: Number(st.ratingCount || 1) + 1
  });

  ratedList.push(activeStoreId);
  localStorage.setItem("nafal_rated_stores", JSON.stringify(ratedList));
  document.getElementById("ratingModal").classList.add("hidden");
  showToast("شكراً لك! تم تسجيل تقييمك للمحل بنجاح ★");
});

// 8. صفحة المنتج المستقلة برابطها الخاص (Single Product Page View - SEO Ready)
function openProductPage(productId, pushHistory = true) {
  activeProductId = productId;
  activeProductQty = 1;

  document.getElementById("marketplaceView").classList.add("hidden");
  document.getElementById("singleStoreView").classList.add("hidden");
  document.getElementById("singleProductPageView").classList.remove("hidden");

  if (pushHistory) {
    window.history.pushState({}, "", `?product=${productId}`);
  }

  const prod = allProducts.find(p => p.id === productId);
  if (prod) {
    populateProductPageUI(prod);
  }
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function populateProductPageUI(prod) {
  const images = getProductImages(prod);
  const outOfStock = Number(prod.stock) <= 0;
  const parentStore = allStores.find(s => s.id === prod.storeId);
  const storeName = parentStore ? parentStore.name : (prod.storeName || "متجر نفال");

  document.getElementById("prodPageTitle").textContent = prod.name;
  document.getElementById("prodPagePrice").textContent = prod.price;
  document.getElementById("prodPageStoreName").textContent = storeName;
  document.getElementById("prodPageStoreBtnName").textContent = `زيارة ${storeName}`;
  document.getElementById("prodPageCategoryBadge").textContent = prod.category || "عام";

  const oldPriceEl = document.getElementById("prodPageOldPrice");
  if (prod.oldPrice && Number(prod.oldPrice) > Number(prod.price)) {
    oldPriceEl.textContent = `${prod.oldPrice} ريال`;
    oldPriceEl.classList.remove("hidden");
  } else {
    oldPriceEl.classList.add("hidden");
  }

  document.getElementById("prodPageBundleBadge").classList.toggle("hidden", prod.productType !== "bundle");
  document.getElementById("prodPageFreeBadge").classList.toggle("hidden", !prod.freeDelivery);

  const stockEl = document.getElementById("prodPageStockStatus");
  if (outOfStock) {
    stockEl.className = "stock-pill out";
    stockEl.innerHTML = `<i class="ri-close-circle-fill"></i> نفذت الكمية حالياً`;
  } else {
    stockEl.className = "stock-pill";
    stockEl.innerHTML = `<i class="ri-checkbox-circle-fill"></i> متوفر حالياً (${prod.stock} في المخزون)`;
  }

  // معرض الصور (حتى 4 صور)
  const mainImg = document.getElementById("prodPageMainImg");
  const thumbsRow = document.getElementById("prodPageThumbnails");
  mainImg.src = images[0];
  thumbsRow.innerHTML = "";

  if (images.length > 1) {
    thumbsRow.classList.remove("hidden");
    images.forEach((imgUrl, idx) => {
      const th = document.createElement("div");
      th.className = `thumb-item ${idx === 0 ? "active" : ""}`;
      th.innerHTML = `<img src="${imgUrl}" alt="صورة ${idx + 1}">`;
      th.addEventListener("click", () => {
        mainImg.src = imgUrl;
        thumbsRow.querySelectorAll(".thumb-item").forEach(t => t.classList.remove("active"));
        th.classList.add("active");
      });
      thumbsRow.appendChild(th);
    });
  } else {
    thumbsRow.classList.add("hidden");
  }

  // المواصفات
  const specsGrid = document.getElementById("prodPageSpecsGrid");
  specsGrid.innerHTML = "";
  const specs = [
    { label: "الوزن / الحجم", val: prod.weight, icon: "ri-scales-3-line" },
    { label: "الإيحاءات / المكونات", val: prod.notes, icon: "ri-sparkling-line" }
  ].filter(s => s.val && String(s.val).trim() !== "");

  if (specs.length > 0) {
    specsGrid.classList.remove("hidden");
    specs.forEach(sp => {
      const d = document.createElement("div");
      d.className = "spec-card";
      d.innerHTML = `<i class="${sp.icon}"></i><div><small>${sp.label}</small><strong>${sp.val}</strong></div>`;
      specsGrid.appendChild(d);
    });
  } else {
    specsGrid.classList.add("hidden");
  }

  document.getElementById("prodPageFullDesc").textContent = prod.fullDescription || prod.description || "منتج مميز مقدم لكم من متاجر شرورة عبر سوق نفال.";

  updateProductPageQtyUI(prod);

  // تحديث بيانات محركات البحث (Google Product Rich Snippet)
  updateSeoMeta({
    title: `${prod.name} — ${storeName} | سوق نفال شرورة`,
    description: prod.description || `اطلب ${prod.name} من ${storeName} في شرورة بسعر ${prod.price} ريال`,
    type: "Product",
    image: images[0],
    price: prod.price,
    storeName
  });
}

function updateProductPageQtyUI(prod) {
  const outOfStock = Number(prod.stock) <= 0;
  document.getElementById("prodPageQtyVal").textContent = activeProductQty;
  const addBtn = document.getElementById("prodPageAddToCartBtn");
  const addText = document.getElementById("prodPageAddBtnText");

  if (outOfStock) {
    addBtn.disabled = true;
    addText.textContent = "نفذت الكمية";
  } else {
    addBtn.disabled = false;
    addText.textContent = `أضف لسلة المحل (${Number(prod.price) * activeProductQty} ريال)`;
  }
}

document.getElementById("prodPageQtyMinus").addEventListener("click", () => {
  const prod = allProducts.find(p => p.id === activeProductId);
  if (!prod) return;
  if (activeProductQty > 1) {
    activeProductQty -= 1;
    updateProductPageQtyUI(prod);
  }
});

document.getElementById("prodPageQtyPlus").addEventListener("click", () => {
  const prod = allProducts.find(p => p.id === activeProductId);
  if (!prod) return;
  if (activeProductQty < Number(prod.stock)) {
    activeProductQty += 1;
    updateProductPageQtyUI(prod);
  } else {
    showToast("وصلت للكمية المتوفرة في المخزون");
  }
});

document.getElementById("prodPageAddToCartBtn").addEventListener("click", () => {
  const prod = allProducts.find(p => p.id === activeProductId);
  if (!prod) return;
  addItemToStoreCart(prod, activeProductQty);
});

document.getElementById("backFromProductBtn").addEventListener("click", () => {
  if (activeStoreId) {
    openSingleStore(activeStoreId, true);
  } else {
    showMarketplaceHome(true);
  }
});

document.getElementById("goToProductStoreBtn").addEventListener("click", () => {
  const prod = allProducts.find(p => p.id === activeProductId);
  if (prod && prod.storeId) openSingleStore(prod.storeId, true);
});

document.getElementById("prodPageStoreBanner").addEventListener("click", () => {
  const prod = allProducts.find(p => p.id === activeProductId);
  if (prod && prod.storeId) openSingleStore(prod.storeId, true);
});

document.getElementById("shareProductUrlBtn").addEventListener("click", () => {
  if (!activeProductId) return;
  const url = `${window.location.origin}${window.location.pathname}?product=${activeProductId}`;
  navigator.clipboard.writeText(url).then(() => showToast("تم نسخ رابط المنتج المباشر!"));
});

// ============================================================================
// 9. نظام "عرباتي" (السلات المتعددة لكل محل على حدة)
// ============================================================================
function saveMultiCarts() {
  // تنظيف أي سلة فارغة
  Object.keys(multiCarts).forEach(stId => {
    if (!multiCarts[stId] || !Array.isArray(multiCarts[stId].items) || multiCarts[stId].items.length === 0) {
      delete multiCarts[stId];
    }
  });
  localStorage.setItem("nafal_multi_carts", JSON.stringify(multiCarts));
  updateMultiCartsDockUI();
}

function addItemToStoreCart(product, qtyToAdd = 1) {
  const stId = product.storeId || "default_store";
  if (!multiCarts[stId]) {
    multiCarts[stId] = {
      storeId: stId,
      storeName: product.storeName || "متجر نفال",
      items: []
    };
  }

  const storeCart = multiCarts[stId];
  const existing = storeCart.items.find(i => i.id === product.id);
  const maxStock = Number(product.stock);

  if (existing) {
    if (existing.qty + qtyToAdd <= maxStock) {
      existing.qty += qtyToAdd;
    } else {
      existing.qty = maxStock;
      showToast("أضفنا لك كل الكمية المتبقية في المخزون");
    }
  } else {
    storeCart.items.push({
      id: product.id,
      name: product.name,
      price: Number(product.price),
      freeDelivery: !!product.freeDelivery,
      qty: Math.min(qtyToAdd, maxStock),
      maxStock
    });
  }

  saveMultiCarts();
  const parentStore = allStores.find(s => s.id === stId);
  const sName = parentStore ? parentStore.name : (product.storeName || "المحل");
  showToast(`تمت الإضافة لسلة "${sName}" في عرباتك`);
}

function updateMultiCartsDockUI() {
  const storeIds = Object.keys(multiCarts);
  let totalItems = 0;
  storeIds.forEach(id => {
    totalItems += (multiCarts[id].items || []).reduce((s, i) => s + i.qty, 0);
  });

  document.getElementById("totalCartsItemsBadge").textContent = totalItems;
  document.getElementById("totalCartsStoresCount").textContent = storeIds.length;
}

// فتح نافذة "عرباتي"
document.getElementById("dockCartsBtn").addEventListener("click", () => {
  openMultiCartsModal();
});

document.getElementById("closeCartsModalBtn").addEventListener("click", () => {
  document.getElementById("multiCartsModal").classList.add("hidden");
});

document.getElementById("backToCartsListBtn").addEventListener("click", () => {
  activeCheckoutStoreId = null;
  renderCartsListView();
});

function openMultiCartsModal() {
  document.getElementById("multiCartsModal").classList.remove("hidden");
  const storeIds = Object.keys(multiCarts);
  // إذا كان العميل داخل محل معين وله سلة، أو لا توجد إلا سلة محل واحد، نعرض قائمة العربات بوضوح
  renderCartsListView();
}

function renderCartsListView() {
  document.getElementById("cartsModalTitle").textContent = "عرباتي (سلات المحلات)";
  document.getElementById("cartsListView").classList.remove("hidden");
  document.getElementById("activeStoreCartCheckoutView").classList.add("hidden");

  const container = document.getElementById("storeCartsCardsContainer");
  container.innerHTML = "";

  const storeIds = Object.keys(multiCarts);
  if (storeIds.length === 0) {
    container.innerHTML = `
      <div class="loading-box glass-inset">
        <i class="ri-shopping-basket-2-line"></i>
        <span>عرباتك فاضية حالياً يا غالي.. تصفح المحلات وأضف اللي يعجبك!</span>
      </div>
    `;
    return;
  }

  storeIds.forEach(stId => {
    const cartObj = multiCarts[stId];
    const store = allStores.find(s => s.id === stId) || { id: stId, name: cartObj.storeName || "متجر في نفال" };
    const workState = checkStoreWorkState(store);

    const itemsCount = cartObj.items.reduce((s, i) => s + i.qty, 0);
    const subtotal = cartObj.items.reduce((s, i) => s + (i.price * i.qty), 0);

    const card = document.createElement("div");
    card.className = "store-cart-card";
    card.innerHTML = `
      <div class="sc-right">
        <div class="sc-logo">
          ${store.logo ? `<img src="${store.logo}" alt="${store.name}">` : `<i class="ri-store-2-line"></i>`}
        </div>
        <div class="sc-info">
          <h4>سلة: ${store.name}</h4>
          <p>${itemsCount} منتجات — المجموع: <strong>${subtotal} ريال</strong></p>
          <span class="work-status-chip ${workState.badgeClass}" style="display:inline-block; margin-top:4px;">${workState.badgeText}</span>
        </div>
      </div>

      <div class="sc-left">
        <span class="sc-open-btn">
          <span>افتح السلة</span>
          <i class="ri-arrow-left-s-line"></i>
        </span>
      </div>
    `;

    card.addEventListener("click", () => {
      openStoreCartCheckout(stId);
    });

    container.appendChild(card);
  });
}

// فتح سلة محل معين لإتمام الطلب منه لوحده
function openStoreCartCheckout(storeId) {
  activeCheckoutStoreId = storeId;
  const cartObj = multiCarts[storeId];
  if (!cartObj || !cartObj.items.length) {
    renderCartsListView();
    return;
  }

  const store = allStores.find(s => s.id === storeId) || {
    id: storeId,
    name: cartObj.storeName || "متجر نفال",
    baseDeliveryFee: 15,
    enableSmartOffers: true,
    tier1Threshold: 100,
    tier1Fee: 5,
    tier2Threshold: 300,
    tier2Fee: 0,
    minOrderAmount: 0,
    workMode: "24h"
  };

  document.getElementById("cartsModalTitle").textContent = `سلة: ${store.name}`;
  document.getElementById("cartsListView").classList.add("hidden");
  document.getElementById("activeStoreCartCheckoutView").classList.remove("hidden");

  // هيدر المحل داخل السلة
  document.getElementById("checkoutStoreHeader").innerHTML = `
    <div style="display:flex; align-items:center; gap:10px;">
      <i class="ri-store-3-fill" style="color:var(--caramel); font-size:1.4rem;"></i>
      <div>
        <strong style="font-size:1rem;">${store.name}</strong>
        <div class="hint-text">الطلب بيروح مباشرة لواتساب صاحب هذا المحل</div>
      </div>
    </div>
    <button type="button" id="clearThisStoreCartBtn" class="btn-glass-sm" style="color:var(--danger);">
      <i class="ri-delete-bin-line"></i><span>إفراغ السلة</span>
    </button>
  `;

  document.getElementById("clearThisStoreCartBtn").addEventListener("click", () => {
    delete multiCarts[storeId];
    saveMultiCarts();
    renderCartsListView();
  });

  // عرض عناصر السلة
  const itemsListEl = document.getElementById("checkoutCartItemsList");
  itemsListEl.innerHTML = "";

  cartObj.items.forEach((item, idx) => {
    const row = document.createElement("div");
    row.className = "cart-item";
    row.innerHTML = `
      <div class="cart-item-info">
        <h4>${item.name}</h4>
        <span>${item.price} ريال × ${item.qty} = ${item.price * item.qty} ريال</span>
      </div>
      <div class="qty-controls">
        <button type="button" class="qty-btn dec-btn"><i class="ri-subtract-line"></i></button>
        <strong>${item.qty}</strong>
        <button type="button" class="qty-btn inc-btn"><i class="ri-add-line"></i></button>
      </div>
    `;

    row.querySelector(".dec-btn").addEventListener("click", () => {
      if (item.qty > 1) {
        item.qty -= 1;
      } else {
        cartObj.items.splice(idx, 1);
      }
      saveMultiCarts();
      if (!multiCarts[storeId]) {
        renderCartsListView();
      } else {
        openStoreCartCheckout(storeId);
      }
    });

    row.querySelector(".inc-btn").addEventListener("click", () => {
      if (item.qty < item.maxStock) {
        item.qty += 1;
        saveMultiCarts();
        openStoreCartCheckout(storeId);
      } else {
        showToast("وصلت للكمية المتوفرة في مخزون المحل");
      }
    });

    itemsListEl.appendChild(row);
  });

  // حساب الإجمالي وعروض التوصيل الخاصة بهذا المحل
  const totals = calculateStoreCartTotals(store, cartObj.items);
  document.getElementById("checkoutSmartHint").innerHTML = `<i class="ri-truck-line"></i><span>${totals.hint}</span>`;
  document.getElementById("chkSubtotal").textContent = totals.subtotal;
  document.getElementById("chkDelivery").textContent = totals.deliveryFee;
  document.getElementById("chkTotal").textContent = totals.total;

  // فحص حالة الدوام والحد الأدنى للطلب لمنع الإحالة للواتساب إذا كان المحل مقفل
  const workState = checkStoreWorkState(store);
  const minOrder = Number(store.minOrderAmount || 0);
  const blockerEl = document.getElementById("checkoutBlockerNotice");
  const submitBtn = document.getElementById("submitOrderBtn");
  const submitBtnText = document.getElementById("submitOrderBtnText");

  if (!workState.canOrder) {
    blockerEl.textContent = workState.reasonMsg;
    blockerEl.classList.remove("hidden");
    submitBtn.disabled = true;
    submitBtnText.textContent = "المحل مقفل الحين — انتظر لين يفتح المحل";
  } else if (minOrder > 0 && totals.subtotal < minOrder) {
    const diff = minOrder - totals.subtotal;
    blockerEl.textContent = `الحد الأدنى للطلب من "${store.name}" هو ${minOrder} ريال. أضف منتجات بقيمة ${diff} ريال عشان تقدر تأكد طلبك!`;
    blockerEl.classList.remove("hidden");
    submitBtn.disabled = true;
    submitBtnText.textContent = `أضف بـ ${diff} ريال للوصول للحد الأدنى`;
  } else {
    blockerEl.classList.add("hidden");
    submitBtn.disabled = false;
    submitBtnText.textContent = `أكد طلبك وأرسله لواتساب ${store.name}`;
  }
}

function calculateStoreCartTotals(store, items) {
  const subtotal = items.reduce((s, i) => s + (i.price * i.qty), 0);
  const allFree = items.every(i => i.freeDelivery === true);
  if (allFree) {
    return { subtotal, deliveryFee: 0, total: subtotal, hint: "منتجاتك المختارة تشمل توصيل مجاني داخل شرورة!" };
  }

  let deliveryFee = Number(store.baseDeliveryFee ?? 15);
  let hint = `رسوم توصيل المحل داخل شرورة: ${deliveryFee} ريال`;

  if (store.enableSmartOffers) {
    const t1 = Number(store.tier1Threshold || 100);
    const f1 = Number(store.tier1Fee ?? 5);
    const t2 = Number(store.tier2Threshold || 300);
    const f2 = Number(store.tier2Fee ?? 0);

    if (subtotal >= t2) {
      deliveryFee = f2;
      hint = f2 === 0 
        ? `كفو! فاتورتك وصلت ${t2} ريال وحصلت على توصيل مجاني من المحل` 
        : `حصلت على عرض التوصيل المخفض (${f2} ريال فقط)`;
    } else if (subtotal >= t1) {
      deliveryFee = f1;
      const rem2 = t2 - subtotal;
      hint = `التوصيل الحين بـ ${f1} ريال بس! زوّد سلتك بـ ${rem2} ريال ويصير التوصيل ${f2 === 0 ? "مجاني" : f2 + " ريال"}`;
    } else {
      const rem1 = t1 - subtotal;
      hint = `زوّد سلتك بـ ${rem1} ريال ويصير التوصيل بـ ${f1} ريال بدال ${deliveryFee} ريال!`;
    }
  }

  return { subtotal, deliveryFee, total: subtotal + deliveryFee, hint };
}

// 10. تحديد الموقع الجغرافي (GPS) للزبون
document.getElementById("getGpsBtn").addEventListener("click", () => {
  const statusText = document.getElementById("gpsStatusText");
  const gpsInput = document.getElementById("custGpsUrl");

  if (!navigator.geolocation) {
    statusText.textContent = "متصفحك ما يدعم تحديد الموقع، اكتب عنوانك بالأسفل.";
    gpsInput.removeAttribute("readonly");
    return;
  }

  statusText.textContent = "جاري التقاط موقعك بالـ GPS...";
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      gpsInput.value = `https://maps.google.com/?q=${pos.coords.latitude},${pos.coords.longitude}`;
      statusText.textContent = "تم تحديد موقعك الجغرافي بنجاح!";
    },
    () => {
      statusText.textContent = "تعذر التقاط الـ GPS، تأكد من تفعيل الموقع في جوالك أو اكتب حيّك بالأسفل.";
      gpsInput.removeAttribute("readonly");
      gpsInput.placeholder = "اكتب اسم الحي والشارع هنا";
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
});

// 11. توليد رقم فاتورة مستحيل التكرار (رمز التاجر + السنة والشهر + كود فريد لا نهائي)
function generateUniqueStoreInvoiceNumber(storePrefix = "NF") {
  const cleanPrefix = (storePrefix || "NF").replace(/[^A-Za-z0-9]/g, "").toUpperCase() || "NF";
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const timePart = Date.now().toString(36).slice(-3).toUpperCase();
  const randPart = Math.random().toString(36).substring(2, 5).toUpperCase();
  return `${cleanPrefix}-${yy}${mm}-${timePart}${randPart}`;
}

// إرسال الطلب وحقن الفاتورة في واتساب التاجر المعني
document.getElementById("checkoutForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!activeCheckoutStoreId || !multiCarts[activeCheckoutStoreId]) return;

  const store = allStores.find(s => s.id === activeCheckoutStoreId);
  if (!store) return;

  // تحقق أخير من أن المحل مفتوح
  const workState = checkStoreWorkState(store);
  if (!workState.canOrder) {
    showToast(workState.reasonMsg);
    return;
  }

  const cartItems = multiCarts[activeCheckoutStoreId].items;
  const totals = calculateStoreCartTotals(store, cartItems);
  const invoiceNumber = generateUniqueStoreInvoiceNumber(store.invoicePrefix || "NF");

  const submitBtn = document.getElementById("submitOrderBtn");
  submitBtn.disabled = true;

  const orderData = {
    storeId: store.id,
    storeName: store.name,
    invoiceNumber,
    customerName: document.getElementById("custName").value.trim(),
    customerPhone: document.getElementById("custPhone").value.trim(),
    gpsLocation: document.getElementById("custGpsUrl").value.trim(),
    customerAddress: document.getElementById("custAddress").value.trim() || "داخل شرورة",
    items: cartItems.map(i => ({ id: i.id, name: i.name, price: i.price, qty: i.qty })),
    subtotal: totals.subtotal,
    deliveryFee: totals.deliveryFee,
    totalAmount: totals.total,
    status: "جديد - قيد المراجعة",
    createdAt: Date.now()
  };

  try {
    await addDoc(collection(db, "nafal_orders"), orderData);

    // خصم الكميات من المخزون
    for (const item of cartItems) {
      const prod = allProducts.find(p => p.id === item.id);
      if (prod) {
        const nextStock = Math.max(0, Number(prod.stock) - item.qty);
        await updateDoc(doc(db, "nafal_products", item.id), { stock: nextStock });
      }
    }

    // حفظ رقم الفاتورة في جهاز الزبون لمتابعتها
    if (!savedInvoices.includes(invoiceNumber)) {
      savedInvoices.unshift(invoiceNumber);
      localStorage.setItem("nafal_my_invoices", JSON.stringify(savedInvoices));
    }

    const storeWa = (store.whatsappNumber || "").replace(/[^0-9]/g, "");
    const itemsLines = orderData.items.map(i => `• ${i.name} (الكمية: ${i.qty})`).join("\n");

    const waText = encodeURIComponent(
      `*طلب جديد عبر سوق نفال — ${store.name}*\n` +
      `*رقم الفاتورة:* #${invoiceNumber}\n` +
      `*الزبون:* ${orderData.customerName}\n` +
      `*الجوال:* ${orderData.customerPhone}\n` +
      `*الموقع (GPS):* ${orderData.gpsLocation}\n` +
      `*العنوان:* ${orderData.customerAddress}\n` +
      `------------------\n` +
      `*الطلبات:*\n${itemsLines}\n` +
      `------------------\n` +
      `*التوصيل:* ${orderData.deliveryFee} ريال\n` +
      `*الإجمالي النهائي:* ${orderData.totalAmount} ريال`
    );

    // حذف سلة هذا المحل فقط مع الإبقاء على سلات المحلات الأخرى
    delete multiCarts[activeCheckoutStoreId];
    saveMultiCarts();

    document.getElementById("checkoutForm").reset();
    document.getElementById("multiCartsModal").classList.add("hidden");

    // فتح نافذة "فواتيري" للزبون ليتابع طلبه مباشرة
    document.getElementById("ordersModal").classList.remove("hidden");
    listenToCustomerInvoices();

    window.open(`https://wa.me/${storeWa}?text=${waText}`, "_blank");
  } catch (err) {
    console.error("Order Submit Error:", err);
    showToast("حصل خطأ أثناء إصدار الفاتورة، حاول مرة ثانية");
  } finally {
    submitBtn.disabled = false;
  }
});

// ============================================================================
// 12. نافذة "فواتيري" ومتابعة حالة الطلب ورقم المندوب
// ============================================================================
let unsubCustomerOrders = null;

function listenToCustomerInvoices(searchCode = "") {
  const container = document.getElementById("customerOrdersList");
  const targetInvoices = searchCode ? [searchCode.toUpperCase()] : savedInvoices;

  if (targetInvoices.length === 0) {
    container.innerHTML = `<p class="hint-text">ما عندك فواتير محفوظة حالياً. تقدر تبحث برقم فاتورتك فوق.</p>`;
    return;
  }

  if (unsubCustomerOrders) unsubCustomerOrders();

  unsubCustomerOrders = onSnapshot(collection(db, "nafal_orders"), snap => {
    container.innerHTML = "";
    const matched = [];

    snap.forEach(d => {
      const data = d.data();
      if (targetInvoices.includes((data.invoiceNumber || "").toUpperCase())) {
        matched.push(data);
      }
    });

    matched.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    if (matched.length === 0) {
      container.innerHTML = `<p class="hint-text">ما لقينا فاتورة بهذا الرقم.</p>`;
      return;
    }

    const stepsMeta = [
      { label: "قيد المراجعة", full: "جديد - قيد المراجعة", icon: "ri-time-line" },
      { label: "جاري التجهيز", full: "جاري التجهيز", icon: "ri-fire-line" },
      { label: "جاهز للمندوب", full: "جاهز للمندوب", icon: "ri-archive-drawer-line" },
      { label: "مع المندوب", full: "مع المندوب للتوصيل", icon: "ri-e-bike-2-line" },
      { label: "تم التوصيل", full: "تم التوصيل", icon: "ri-checkbox-circle-line" }
    ];

    matched.forEach((order, idx) => {
      const isCanceled = order.status === "ملغي";
      const currentIdx = stepsMeta.findIndex(s => s.full === order.status);

      const stepsHtml = isCanceled
        ? `<div class="blocker-notice">تم إلغاء هذا الطلب</div>`
        : `<div class="status-steps">
            ${stepsMeta.map((st, i) => `
              <div class="step-box ${i <= currentIdx ? "done" : ""}">
                <i class="${st.icon}"></i>
                <span>${st.label}</span>
              </div>
            `).join("")}
          </div>`;

      // إظهار اسم ورقم المندوب للزبون فور استلام المندوب للطلب
      const courierBoxHtml = order.courierName
        ? `<div class="courier-call-box">
            <div><i class="ri-e-bike-2-fill"></i> طلبك مع المندوب: <strong>${order.courierName}</strong></div>
            ${order.courierPhone ? `<a href="tel:${order.courierPhone}" class="btn-glass-sm">اتصال: ${order.courierPhone}</a>` : ""}
          </div>`
        : "";

      const itemsText = (order.items || []).map(i => `• ${i.name} (الكمية: ${i.qty})`).join("<br>");

      const acc = document.createElement("div");
      acc.className = `cust-invoice-accordion ${idx === 0 ? "open" : ""}`;
      acc.innerHTML = `
        <button type="button" class="cust-inv-header">
          <div class="cust-inv-right">
            <div class="cust-arrow"><i class="ri-arrow-down-s-line"></i></div>
            <div>
              <strong style="font-size:0.98rem; color:var(--espresso);">فاتورة #${order.invoiceNumber} — ${order.storeName || "متجر نفال"}</strong>
              <div class="hint-text">الإجمالي: ${order.totalAmount} ريال — ${new Date(order.createdAt || Date.now()).toLocaleDateString("ar-SA")}</div>
            </div>
          </div>
          <span class="status-pill ${isCanceled ? 'canceled' : ''}">${order.status}</span>
        </button>

        <div class="cust-inv-body">
          ${stepsHtml}
          ${courierBoxHtml}
          <div class="glass-inset" style="padding:12px; font-size:0.86rem; line-height:1.7;">
            <strong>المنتجات المطلوبة من ${order.storeName || "المحل"}:</strong><br>
            ${itemsText}
            <div style="margin-top:6px; padding-top:6px; border-top:1px dashed rgba(30,19,13,0.12); font-weight:800;">
              التوصيل: ${order.deliveryFee} ريال | الإجمالي: ${order.totalAmount} ريال
            </div>
          </div>
        </div>
      `;

      acc.querySelector(".cust-inv-header").addEventListener("click", () => {
        acc.classList.toggle("open");
      });

      container.appendChild(acc);
    });
  });
}

document.getElementById("dockOrdersBtn").addEventListener("click", () => {
  document.getElementById("ordersModal").classList.remove("hidden");
  listenToCustomerInvoices();
});

document.getElementById("closeOrdersBtn").addEventListener("click", () => {
  document.getElementById("ordersModal").classList.add("hidden");
});

document.getElementById("searchInvoiceBtn").addEventListener("click", () => {
  const val = document.getElementById("searchInvoiceInput").value.trim();
  listenToCustomerInvoices(val);
});

// إغلاق النوافذ عند الضغط في الخلفية
document.querySelectorAll(".modal-overlay").forEach(ov => {
  ov.addEventListener("click", (e) => {
    if (e.target === ov) ov.classList.add("hidden");
  });
});

// تشغيل المنصة وفحص الروابط العميقة
initRealtimeListeners();
updateMultiCartsDockUI();
handleUrlRouting();

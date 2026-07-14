const CLOUD_BACKEND = "https://kopral-coffee-central.onrender.com";
// Determine base URL: prefer current origin when the site is served from the kasir server
// (served under /pelanggan) or when running on localhost.
const servedFromKasir =
  window.location.pathname.startsWith("/pelanggan") ||
  window.location.hostname === "localhost" ||
  window.location.hostname === "127.0.0.1" ||
  new URLSearchParams(window.location.search).get("local") === "1";
const BASE_BACKEND = servedFromKasir ? window.location.origin : CLOUD_BACKEND;
const BACKEND_KASIR_API = `${BASE_BACKEND}/api/pesanan-masuk`;
const MENU_API_URL = BASE_BACKEND;
const SOCKET_BASE = BASE_BACKEND;

let cart = JSON.parse(localStorage.getItem("kopral_cart")) || [];
let buktiUrlCloudinary = "";
let socket = null;
let currentCategory = null;

// ------------------------------
// Cloudinary upload widget
// ------------------------------
function bukaWidgetUpload() {
  const myWidget = cloudinary.createUploadWidget(
    {
      cloudName: "wiosnp5g",
      uploadPreset: "kopral_preset",
      sources: ["local", "camera"],
      multiple: false,
    },
    (error, result) => {
      if (!error && result && result.event === "success") {
        buktiUrlCloudinary = result.info.secure_url;
        const fileNameDisplay = document.getElementById("file-name-display");
        if (fileNameDisplay) {
          fileNameDisplay.innerText = "✅ Bukti Transfer Terupload!";
          fileNameDisplay.classList.add("text-green-600");
        }
      }
    },
  );
  myWidget.open();
}

// ------------------------------
// Menu stock sync and data helpers
// ------------------------------
function mergeMenuStockData(data) {
  const categories = Object.keys(menuDatabase);
  categories.forEach((category) => {
    const incomingItems = Array.isArray(data?.[category]) ? data[category] : [];
    (menuDatabase[category] || []).forEach((item) => {
      const incomingItem = incomingItems.find(
        (entry) =>
          (entry.id && entry.id === item.id) || entry.name === item.name,
      );
      if (incomingItem) {
        if (incomingItem.stock !== undefined && incomingItem.stock !== null) {
          item.stock = Number(incomingItem.stock);
        }
        if (incomingItem.id) item.id = incomingItem.id;
      }
    });
  });
}

function applyStockUpdate(update) {
  const targetStock = Number(update?.stock);
  if (!Number.isFinite(targetStock)) return;
  Object.values(menuDatabase).forEach((items) => {
    items.forEach((item) => {
      if (
        (update?.id && item.id === update.id) ||
        (update?.name && item.name === update.name)
      ) {
        item.stock = targetStock;
      }
    });
  });

  try {
    localStorage.setItem("kopral_menu_cache", JSON.stringify(menuDatabase));
  } catch (e) {
    console.warn("Gagal menyimpan cache menu:", e);
  }

  refreshMenuView();
}

function refreshMenuView() {
  if (currentCategory) {
    openMenuModal(currentCategory);
  }
}

async function syncMenuData() {
  try {
    const response = await fetch(MENU_API_URL + "?action=getMenu");
    if (!response.ok) throw new Error("Network response not ok");
    const data = await response.json();
    mergeMenuStockData(data);
    try {
      localStorage.setItem("kopral_menu_cache", JSON.stringify(menuDatabase));
    } catch (e) {
      console.warn("Gagal simpan cache menu:", e);
    }
    refreshMenuView();
    console.log("Stok berhasil disinkronkan");
    return true;
  } catch (e) {
    console.warn("Gagal sinkronisasi, mencoba cache lokal jika ada.", e);
    try {
      const cache = localStorage.getItem("kopral_menu_cache");
      if (cache) {
        const cached = JSON.parse(cache);
        mergeMenuStockData(cached);
        refreshMenuView();
        console.log("Menggunakan cache menu lokal.");
        return false;
      }
    } catch (err) {
      console.warn("Tidak ada cache lokal atau cache rusak.", err);
    }

    Object.values(menuDatabase).forEach((items) => {
      items.forEach((item) => {
        if (item.stock === undefined || item.stock === null) return;
        if (item.stock === 0) item.stock = null;
      });
    });
    refreshMenuView();
    return false;
  }
}

// ------------------------------
// Device and menu helpers
// ------------------------------
function updateDeviceMode() {
  const isMobile = window.matchMedia("(max-width: 767px)").matches;
  document.body.classList.toggle("device-mobile", isMobile);
  document.body.classList.toggle("device-desktop", !isMobile);
  const label = document.getElementById("device-label");
  if (label) {
    label.textContent = `Perangkat: ${isMobile ? "Mobile" : "Desktop"}`;
  }
}

window.addEventListener("resize", updateDeviceMode);

function toggleMobileMenu() {
  const mobileMenu = document.getElementById("mobile-menu");
  if (!mobileMenu) return;
  const isOpen = mobileMenu.classList.toggle("open");
  document.body.classList.toggle("mobile-menu-open", isOpen);
  const menuButton = document.getElementById("mobile-menu-button");
  if (menuButton) {
    menuButton.setAttribute("aria-expanded", isOpen ? "true" : "false");
  }
}

// ------------------------------
// Menu modal and category UI
// ------------------------------
function openMenuModal(categoryKey) {
  currentCategory = categoryKey;
  const grid = document.getElementById("modal-menu-grid");
  const categoryTitle = document.getElementById("modal-category-title");
  if (!grid || !categoryTitle) return;

  categoryTitle.innerText = categoryKey.toUpperCase() + " SERIES";
  grid.innerHTML = "";

  (menuDatabase[categoryKey] || []).forEach((item) => {
    const isDisabled = typeof item.stock === "number" ? item.stock <= 0 : false;
    const buttonClass = isDisabled
      ? "bg-gray-400 cursor-not-allowed"
      : "bg-[#1e140a]";
    const buttonText = isDisabled ? "Habis" : "+ Tambah";
    const safeId = String(item.id || "").replace(/'/g, "\\'");
    const safeName = String(item.name || "").replace(/'/g, "\\'");
    const onclickValue = isDisabled
      ? ""
      : "handleAddToCart(this, '" +
        safeId +
        "', '" +
        safeName +
        "', " +
        item.price +
        ")";

    grid.innerHTML += `
      <div class="bg-slate-950 p-4 rounded-2xl border border-slate-800 flex flex-col justify-between text-slate-100">
        <img src="${item.img}" onerror="this.src='${item.fallback}'" class="w-full h-36 object-cover rounded-xl mb-3" />
        <h4 class="font-bold text-sm text-slate-100">${item.name}</h4>
        <p class="text-xs text-slate-400 mb-2">${item.desc}</p>
        <div class="flex justify-between items-center mb-2">
          <p class="text-xs font-bold text-amber-300">Rp ${item.price.toLocaleString("id-ID")}</p>
          <span class="text-xs bg-slate-900/80 text-slate-200 px-2 py-1 rounded-lg font-semibold">
            ${isDisabled ? "❌ Habis" : typeof item.stock === "number" ? `📦 ${item.stock} pcs` : `📦 -`}
          </span>
        </div>
        <button
          onclick="${onclickValue}"
          class="w-full ${buttonClass} text-white py-2 rounded-xl text-xs font-bold btn-add-menu"
          ${isDisabled ? "disabled" : ""}>
          ${buttonText}
        </button>
      </div>`;
  });

  document.getElementById("menu-modal").classList.remove("hidden");
}

function closeMenuModal() {
  const menuModal = document.getElementById("menu-modal");
  if (!menuModal) return;
  menuModal.classList.add("hidden");
}

function switchCartTab(tab) {
  const itemsPanel = document.querySelector(".cart-items-panel");
  const detailPanel = document.querySelector(".cart-detail-panel");
  const itemsBtn = document.getElementById("cart-tab-btn-items");
  const detailBtn = document.getElementById("cart-tab-btn-detail");
  if (!itemsPanel || !detailPanel || !itemsBtn || !detailBtn) return;
  if (tab === "detail") {
    itemsPanel.classList.remove("active");
    detailPanel.classList.add("active");
    itemsBtn.classList.remove("active");
    detailBtn.classList.add("active");
  } else {
    detailPanel.classList.remove("active");
    itemsPanel.classList.add("active");
    detailBtn.classList.remove("active");
    itemsBtn.classList.add("active");
  }
}

function toggleCart() {
  const cartModal = document.getElementById("cart-modal");
  if (!cartModal) return;
  const opened = !cartModal.classList.contains("hidden");
  cartModal.classList.toggle("hidden");
  if (!opened) {
    switchCartTab("items");
  }
}

function toggleQrisModal() {
  const qrisModal = document.getElementById("qris-modal");
  if (qrisModal) {
    qrisModal.classList.toggle("hidden");
  }
}

function saveToStorage() {
  localStorage.setItem("kopral_cart", JSON.stringify(cart));
}

function renderStatusPesanan(orderId) {
  const container = document.getElementById("cart-items");
  const footer = document.getElementById("cart-footer");
  if (!container || !footer) return;
  container.innerHTML = `<div class="text-center py-10"><div class="text-emerald-600 text-5xl mb-4"><i class="fas fa-check-circle"></i></div><h3 class="font-bold text-lg">Pesanan Aktif!</h3><p class="text-sm text-gray-600 mb-2">ID: ${orderId}</p><button onclick="bersihkanPesanan()" class="text-xs underline text-gray-500">Pesan Lagi</button></div>`;
  footer.classList.add("hidden");
}

let queuePopupTimeout = null;
function showQueuePopup(queueNumber, orderId) {
  const popup = document.getElementById("queue-popup");
  const numberEl = document.getElementById("queue-number");
  const infoEl = document.getElementById("queue-info");
  if (!popup || !numberEl || !infoEl) return;

  numberEl.textContent = queueNumber;
  infoEl.textContent = `Pesanan ${orderId} sudah dikirim. Tunjukkan nomor antrean ini ke barista.`;
  popup.classList.add("show");

  clearTimeout(queuePopupTimeout);
  queuePopupTimeout = setTimeout(() => {
    popup.classList.remove("show");
  }, 7000);
}

function hideQueuePopup() {
  const popup = document.getElementById("queue-popup");
  if (!popup) return;
  popup.classList.remove("show");
  clearTimeout(queuePopupTimeout);
}

function bersihkanPesanan() {
  localStorage.removeItem("active_order_id");
  localStorage.removeItem("kopral_cart");
  location.reload();
}

// ------------------------------
// Cart operations
// ------------------------------
function handleAddToCart(sourceElement, id, name, price) {
  addToCart(id, name, price);
  animateCartToOrder(sourceElement);
}

function animateCartToOrder(sourceElement) {
  const target = document.getElementById("cart-count");
  if (!target || !sourceElement) return;

  const sourceRect = sourceElement.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  const flyIcon = document.createElement("div");

  flyIcon.className = "fly-cart-icon visible";
  flyIcon.innerHTML = `<i class="fas fa-shopping-cart"></i>`;
  flyIcon.style.left = `${sourceRect.left + sourceRect.width / 2 - 28}px`;
  flyIcon.style.top = `${sourceRect.top + sourceRect.height / 2 - 28}px`;
  flyIcon.style.width = "3.2rem";
  flyIcon.style.height = "3.2rem";
  flyIcon.style.fontSize = "1.2rem";
  flyIcon.style.opacity = "0.95";

  document.body.appendChild(flyIcon);

  requestAnimationFrame(() => {
    flyIcon.style.transform = `translate(${targetRect.left + targetRect.width / 2 - (sourceRect.left + sourceRect.width / 2)}px, ${targetRect.top + targetRect.height / 2 - (sourceRect.top + sourceRect.height / 2)}px) scale(0.4)`;
    flyIcon.style.opacity = "0";
  });

  setTimeout(() => {
    flyIcon.remove();
    target.classList.add("cart-bounce");
    setTimeout(() => target.classList.remove("cart-bounce"), 300);
  }, 1400);
}

function addToCart(id, name, price) {
  const existing = cart.find((item) => item.id === id);
  if (existing) existing.quantity += 1;
  else cart.push({ id, name, price, quantity: 1, note: "" });
  updateCartUI();
}

function changeQuantity(index, delta) {
  cart[index].quantity += delta;
  if (cart[index].quantity <= 0) cart.splice(index, 1);
  updateCartUI();
}

function updateCartUI() {
  const container = document.getElementById("cart-items");
  const totalEl = document.getElementById("cart-total");
  const countEl = document.getElementById("cart-count");
  if (!container || !totalEl || !countEl) return;

  saveToStorage();

  if (cart.length === 0) {
    container.innerHTML =
      '<p class="text-gray-500 text-center py-8">Keranjang kosong.</p>';
    totalEl.innerText = "Rp 0";
    countEl.classList.add("hidden");
    return;
  }

  let total = 0;
  let totalItems = 0;
  container.innerHTML = "";

  cart.forEach((item, index) => {
    total += item.price * item.quantity;
    totalItems += item.quantity;
    const subtotal = item.price * item.quantity;

    container.innerHTML += `<div class="cart-item-card p-5 rounded-[2rem] border border-slate-800 text-slate-100">
      <div class="flex items-start justify-between gap-4 mb-4">
        <div class="flex items-center gap-3">
          <div class="flex h-12 w-12 items-center justify-center rounded-3xl bg-slate-900 text-lg font-bold text-amber-300">${index + 1}</div>
          <div>
            <h4 class="font-semibold text-base text-white">${item.name}</h4>
            <p class="text-xs uppercase tracking-[0.18em] text-slate-500">Harga per item</p>
          </div>
        </div>
        <div class="text-right">
          <p class="text-sm text-slate-400">Rp ${item.price.toLocaleString("id-ID")}</p>
          <p class="mt-1 text-amber-300 font-semibold">Subtotal Rp ${subtotal.toLocaleString("id-ID")}</p>
        </div>
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-[auto_1fr] gap-4 items-center">
        <div class="flex items-center gap-2">
          <button onclick="changeQuantity(${index}, -1)" class="w-11 h-11 bg-slate-800 rounded-2xl flex items-center justify-center text-lg text-slate-100">-</button>
          <span class="min-w-[2.5rem] text-center text-base font-semibold text-white">${item.quantity}</span>
          <button onclick="changeQuantity(${index}, 1)" class="w-11 h-11 bg-amber-400 rounded-2xl flex items-center justify-center text-lg text-slate-950">+</button>
        </div>
        <div class="text-sm text-slate-400">Jumlah item dalam keranjang. Gunakan tombol di kiri untuk menambah atau mengurangi pesanan.</div>
      </div>
      <div class="mt-4">
        <label class="text-xs uppercase tracking-[0.15em] text-slate-500">Catatan</label>
        <input type="text" placeholder="Contoh: es/panas, gula, tambahan sirup" value="${item.note || ""}" onchange="updateNote(${index}, this.value)" class="mt-2 w-full cart-input text-sm p-3 rounded-2xl outline-none" />
      </div>
    </div>`;
  });

  totalEl.innerText = "Rp " + total.toLocaleString("id-ID");
  countEl.innerText = totalItems;
  countEl.classList.remove("hidden");
}

function updateNote(index, value) {
  cart[index].note = value;
  saveToStorage();
}

// ------------------------------
// Order submission
// ------------------------------
async function kirimKeKasir() {
  const btn = document.getElementById("btn-kirim");
  const nama = document.getElementById("cust-name").value.trim();
  const meja = document.getElementById("cust-table").value.trim();
  const metodePembayaran = document.getElementById("payment-method").value;
  const tujuan = document.getElementById("payment-destination").value;
  const pengirim = document.getElementById("sender-name").value.trim();

  if (!nama || !meja || cart.length === 0) {
    alert("Mohon lengkapi Nama, Nomor Meja, dan pilih menu!");
    return;
  }

  if (
    metodePembayaran === "Transfer" &&
    (!tujuan || !pengirim || !buktiUrlCloudinary)
  ) {
    alert(
      "Lengkapi data pembayaran (Tujuan, Nama Pengirim, dan Upload Bukti Transfer)!",
    );
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.innerText = "Mengirim...";
  }

  const payload = {
    id_pesanan: "KPRL-" + Date.now(),
    nama,
    meja,
    metode: document.getElementById("order-method").value,
    pembayaran: metodePembayaran,
    tujuan_pembayaran: tujuan,
    nama_pengirim: pengirim,
    bukti_transfer: buktiUrlCloudinary,
    items: cart.map((item) => ({
      id: item.id,
      name: item.name,
      price: item.price,
      quantity: item.quantity,
      note: item.note || "",
    })),
    total: cart.reduce((s, i) => s + i.price * i.quantity, 0),
    status_pesanan: "Menunggu",
    waktu_pesan: new Date().toISOString(),
  };

  try {
    const response = await fetch(BACKEND_KASIR_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (response.ok) {
      const responseData = await response.json().catch(() => ({}));
      const queueNumber =
        responseData?.queue_number ||
        `#${String(Math.floor(100 + (Date.now() % 900))).padStart(3, "0")}`;

      localStorage.setItem("active_order_id", payload.id_pesanan);
      cart = [];
      localStorage.removeItem("kopral_cart");

      if (typeof syncMenuData === "function") {
        await syncMenuData();
      }

      renderStatusPesanan(payload.id_pesanan);
      showQueuePopup(queueNumber, payload.id_pesanan);
    } else {
      throw new Error("Response not ok");
    }
  } catch (e) {
    alert("Gagal mengirim pesanan. Cek koneksi.");
    if (btn) {
      btn.disabled = false;
      btn.innerText = "Kirim ke Kasir";
    }
  }
}

// ------------------------------
// Menu data definition
// ------------------------------
const menuDatabase = {
  coffee: [
    {
      id: "c01",
      name: "Espresso Roman",
      price: 22000,
      stock: 0,
      desc: "Ekstrak kopi pekat murni.",
      img: "",
      fallback:
        "https://images.unsplash.com/photo-1541167760496-1628856ab772?q=80&w=500",
    },
    {
      id: "c02",
      name: "Creamy Latte",
      price: 28000,
      stock: 0,
      desc: "Espresso lembut dengan susu segar foam.",
      img: "",
      fallback:
        "https://images.unsplash.com/photo-1570968915860-54d5c301fc9f?q=80&w=500",
    },
    {
      name: "Americano",
      price: 22000,
      stock: 0,
      desc: "Espresso yang dicampur dengan air panas.",
      img: "",
      fallback:
        "https://images.unsplash.com/photo-1555507036-ab1f4038808a?q=80&w=500",
    },
    {
      name: "Cappuccino",
      price: 22000,
      stock: 0,
      desc: "Espresso dengan takaran susu yang lebih sedikit dibanding latte dan lapisan buih (foam) yang tebal.",
      img: "",
      fallback:
        "https://images.unsplash.com/photo-1555507036-ab1f4038808a?q=80&w=500",
    },
    {
      name: "Caramel Macchiato",
      price: 22000,
      stock: 0,
      desc: "Espresso, susu panas, dan sirup karamel.",
      img: "",
      fallback:
        "https://images.unsplash.com/photo-1555507036-ab1f4038808a?q=80&w=500",
    },
    {
      name: "Manual Brew",
      price: 22000,
      stock: 0,
      desc: " Kopi seduh saring seperti V60, Japanese Drip, atau Tubruk.",
      img: "",
      fallback:
        "https://images.unsplash.com/photo-1555507036-ab1f4038808a?q=80&w=500",
    },
    {
      name: "Kopi Gula Aren",
      price: 25000,
      stock: 0,
      desc: "Kopi susu dengan manisnya aren asli.",
      img: "",
      fallback:
        "https://images.unsplash.com/photo-1517701604599-bb29b565090c?q=80&w=500",
    },
  ],
  "non-coffee": [
    {
      name: "Pure Matcha Latte",
      price: 27000,
      stock: 0,
      desc: "Matcha jepang asli dipadu susu segar.",
      img: "",
      fallback:
        "https://images.unsplash.com/photo-1536256263959-770b48d82b0a?q=80&w=500",
    },
    {
      name: "Chocolate",
      price: 22000,
      stock: 0,
      desc: "Es atau panas, baik dark chocolate atau varian signature.",
      img: "",
      fallback:
        "https://images.unsplash.com/photo-1555507036-ab1f4038808a?q=80&w=500",
    },
    {
      name: "Milkshake",
      price: 22000,
      stock: 0,
      desc: " Minuman susu yang diblender dengan varian rasa seperti cokelat atau stroberi.",
      img: "",
      fallback:
        "https://images.unsplash.com/photo-1555507036-ab1f4038808a?q=80&w=500",
    },
    {
      name: "Mocktail",
      price: 22000,
      stock: 0,
      desc: "Racikan minuman segar berbahan dasar sirup buah, soda, dan terkadang dicampur espresso.",
      img: "",
      fallback:
        "https://images.unsplash.com/photo-1555507036-ab1f4038808a?q=80&w=500",
    },
    {
      name: "Lychee Tea",
      price: 22000,
      stock: 0,
      desc: "Espresso yang dicampur dengan air panas.",
      img: "",
      fallback:
        "https://images.unsplash.com/photo-1555507036-ab1f4038808a?q=80&w=500",
    },
    {
      name: "Lemon Tea",
      price: 22000,
      stock: 0,
      desc: "Espresso yang dicampur dengan air panas.",
      img: "",
      fallback:
        "https://images.unsplash.com/photo-1555507036-ab1f4038808a?q=80&w=500",
    },
    {
      name: "Signature Chocolate",
      price: 26000,
      stock: 0,
      desc: "Cokelat pekat premium manis gurih.",
      img: "",
      fallback:
        "https://images.unsplash.com/photo-1544787219-7f47ccb76574?q=80&w=500",
    },
  ],
  snacks: [
    {
      name: "Butter Croissant",
      price: 22000,
      stock: 0,
      desc: "Pastry renyah berlapis khas Prancis.",
      img: "",
      fallback:
        "https://images.unsplash.com/photo-1555507036-ab1f4038808a?q=80&w=500",
    },
    {
      name: "Mie Goreng",
      price: 10000,
      stock: 0,
      desc: "Mie Goreng Dengan Telur dan Sambal.",
      img: "",
      fallback:
        "https://images.unsplash.com/photo-1555507036-ab1f4038808a?q=80&w=500",
    },
    {
      name: "Pastry",
      price: 22000,
      stock: 0,
      desc: "Croissant (polos atau dengan isian seperti cokelat/almond), Danish, dan Cinnamon Roll.",
      img: "",
      fallback:
        "https://images.unsplash.com/photo-1555507036-ab1f4038808a?q=80&w=500",
    },
    {
      name: "Onion Rings",
      price: 22000,
      stock: 0,
      desc: "Espresso yang dicampur dengan air panas.",
      img: "",
      fallback:
        "https://images.unsplash.com/photo-1555507036-ab1f4038808a?q=80&w=500",
    },
    {
      name: "Tahu Crispy",
      price: 22000,
      stock: 0,
      desc: "Espresso yang dicampur dengan air panas.",
      img: "",
      fallback:
        "https://images.unsplash.com/photo-1555507036-ab1f4038808a?q=80&w=500",
    },
    {
      name: "Nasi Goreng",
      price: 22000,
      stock: 0,
      desc: "Espresso yang dicampur dengan air panas.",
      img: "",
      fallback:
        "https://images.unsplash.com/photo-1555507036-ab1f4038808a?q=80&w=500",
    },
    {
      name: "French Fries",
      price: 18000,
      stock: 0,
      desc: "Kentang goreng renyah bumbu gurih.",
      img: "",
      fallback:
        "https://images.unsplash.com/photo-1573080496219-bb080dd4f877?q=80&w=500",
    },
  ],
};

function normalizeMenuIds() {
  Object.keys(menuDatabase).forEach((category) => {
    menuDatabase[category].forEach((item, index) => {
      if (!item.id) {
        const slug = item.name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/(^-|-$)/g, "");
        item.id = `${category.charAt(0)}${String(index + 1).padStart(2, "0")}-${slug}`;
      }
    });
  });
}

function normalizeMenuStockDefaults() {
  Object.values(menuDatabase).forEach((items) => {
    items.forEach((item) => {
      if (item.stock === 0) {
        item.stock = null;
      }
    });
  });
}

normalizeMenuIds();
normalizeMenuStockDefaults();

window.onload = async () => {
  updateDeviceMode();
  socket = io(SOCKET_BASE, {
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
  });
  socket.on("connect", () => {
    console.log("Socket terkoneksi untuk stok real-time");
    syncMenuData();
  });
  socket.on("connect_error", () => {
    console.warn("Socket stok tidak terhubung");
  });
  socket.on("update-stok-realtime", (update) => {
    applyStockUpdate(update);
  });

  await syncMenuData();
  updateCartUI();
  toggleBuktiField();
  const id = localStorage.getItem("active_order_id");
  if (id) renderStatusPesanan(id);
};

function toggleBuktiField() {
  const method = document.getElementById("payment-method").value;
  const dest = document.getElementById("payment-destination").value;
  const buktiContainer = document.getElementById("bukti-container");
  const destContainer = document.getElementById("destination-container");
  const btnQris = document.getElementById("btn-show-qris");
  const btnUpload = document.getElementById("btn-upload-bukti");
  const actionHint = document.getElementById("payment-action-hint");

  if (
    !buktiContainer ||
    !destContainer ||
    !btnQris ||
    !btnUpload ||
    !actionHint
  )
    return;

  const isTransfer = method === "Transfer";
  const qrisActive = isTransfer && dest === "QRIS";
  const uploadActive = isTransfer && dest !== "";

  destContainer.classList.toggle("hidden", !isTransfer);
  btnQris.disabled = !qrisActive;
  btnUpload.disabled = !uploadActive;
  btnQris.classList.toggle("hidden", !qrisActive);
  btnUpload.classList.toggle("hidden", !uploadActive);
  buktiContainer.classList.toggle("hidden", !uploadActive || dest === "QRIS");

  if (!isTransfer) {
    actionHint.innerText =
      "Pilih metode Transfer untuk menampilkan opsi QRIS dan upload bukti.";
  } else if (dest === "") {
    actionHint.innerText =
      "Pilih tujuan pembayaran agar tombol yang sesuai aktif.";
  } else if (qrisActive) {
    actionHint.innerText =
      "Tekan tombol QRIS untuk melihat barcode, dan upload bukti setelah transfer.";
  } else if (uploadActive) {
    actionHint.innerText =
      "Tekan upload untuk mengirim bukti transfer setelah melakukan pembayaran.";
  }
}

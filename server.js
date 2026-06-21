/* =========================================================
   FIREGAME SHOP — Backend Server
   Node.js + Express + JSON file storage
   ========================================================= */

const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const cookieParser = require('cookie-parser');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'products.json');
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

ensureDataDir();

/* ---------------------------------------------------------
   Initial setup: admin password (default "admin1234")
   Change this by editing data/config.json after first run,
   or set ADMIN_PASSWORD env variable before first launch.
--------------------------------------------------------- */
function ensureConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    const defaultPassword = process.env.ADMIN_PASSWORD || 'admin1234';
    const hash = bcrypt.hashSync(defaultPassword, 10);
    fs.writeFileSync(CONFIG_PATH, JSON.stringify({ adminPasswordHash: hash }, null, 2));
    console.log('========================================');
    console.log(' สร้างรหัสผ่านแอดมินเริ่มต้นแล้ว');
    console.log(' รหัสผ่าน: ' + defaultPassword);
    console.log(' (กรุณาเปลี่ยนรหัสผ่านในหน้า /admin หลังล็อกอินครั้งแรก)');
    console.log('========================================');
  }
}
ensureConfig();

function readConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
}
function writeConfig(cfg) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
}

/* ---------------------------------------------------------
   Simple JSON "database" helpers
--------------------------------------------------------- */
function readProducts() {
  if (!fs.existsSync(DB_PATH)) return [];
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
}
function writeProducts(list) {
  fs.writeFileSync(DB_PATH, JSON.stringify(list, null, 2));
}
function genId() {
  return 'FF-' + Math.floor(1000 + Math.random() * 9000) + Date.now().toString().slice(-3);
}

/* ---------------------------------------------------------
   Middleware
--------------------------------------------------------- */
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());
app.use(session({
  secret: process.env.SESSION_SECRET || 'firegame-shop-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 1000 * 60 * 60 * 8, // 8 ชั่วโมง
    httpOnly: true
  }
}));

app.use(express.static(path.join(__dirname, 'public')));

function requireAuth(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  return res.status(401).json({ error: 'unauthorized' });
}

/* ===========================================================
   AUTH ROUTES
=========================================================== */
app.post('/api/login', (req, res) => {
  const { password } = req.body;
  const cfg = readConfig();
  if (!password) return res.status(400).json({ error: 'กรุณากรอกรหัสผ่าน' });

  const ok = bcrypt.compareSync(password, cfg.adminPasswordHash);
  if (!ok) return res.status(401).json({ error: 'รหัสผ่านไม่ถูกต้อง' });

  req.session.isAdmin = true;
  res.json({ ok: true });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

app.get('/api/me', (req, res) => {
  res.json({ isAdmin: !!(req.session && req.session.isAdmin) });
});

app.post('/api/change-password', requireAuth, (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const cfg = readConfig();

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'กรุณากรอกข้อมูลให้ครบ' });
  }
  if (!bcrypt.compareSync(currentPassword, cfg.adminPasswordHash)) {
    return res.status(401).json({ error: 'รหัสผ่านเดิมไม่ถูกต้อง' });
  }
  if (newPassword.length < 6) {
    return res.status(400).json({ error: 'รหัสผ่านใหม่ต้องมีอย่างน้อย 6 ตัวอักษร' });
  }

  cfg.adminPasswordHash = bcrypt.hashSync(newPassword, 10);
  writeConfig(cfg);
  res.json({ ok: true });
});

/* ===========================================================
   PUBLIC PRODUCT ROUTES (หน้าร้าน)
=========================================================== */

// รายการสินค้าทั้งหมด — หน้าร้านเห็นเฉพาะสถานะ available / sold (ไม่เห็น hidden)
app.get('/api/products', (req, res) => {
  const all = readProducts();
  const visible = all.filter(p => p.status !== 'hidden');
  res.json(visible);
});

// รายละเอียดสินค้าชิ้นเดียว
app.get('/api/products/:id', (req, res) => {
  const all = readProducts();
  const item = all.find(p => p.id === req.params.id);
  if (!item || item.status === 'hidden') return res.status(404).json({ error: 'not found' });
  res.json(item);
});

/* ===========================================================
   ADMIN PRODUCT ROUTES (ต้องล็อกอิน)
=========================================================== */

// แอดมินเห็นสินค้าทั้งหมดรวม hidden
app.get('/api/admin/products', requireAuth, (req, res) => {
  res.json(readProducts());
});

// เพิ่มสินค้าใหม่
app.post('/api/admin/products', requireAuth, (req, res) => {
  const body = req.body;
  if (!body.name || !body.price) {
    return res.status(400).json({ error: 'กรุณากรอกชื่อสินค้าและราคา' });
  }

  const list = readProducts();
  const newProduct = {
    id: body.id && body.id.trim() ? body.id.trim() : genId(),
    name: body.name || '',
    rank: body.rank || '',
    tier: body.tier || 'กลาง',
    price: Number(body.price) || 0,
    oldPrice: Number(body.oldPrice) || 0,
    tags: Array.isArray(body.tags) ? body.tags : (body.tags ? String(body.tags).split(',').map(t => t.trim()).filter(Boolean) : []),
    level: Number(body.level) || 0,
    skins: Number(body.skins) || 0,
    diamonds: body.diamonds || '',
    desc: body.desc || '',
    color: body.color || '#ff4d5e',
    status: body.status || 'available',
    image: body.image || '',
    createdAt: new Date().toISOString()
  };

  if (list.some(p => p.id === newProduct.id)) {
    return res.status(409).json({ error: 'รหัสไอดีนี้ถูกใช้แล้ว กรุณาใช้รหัสอื่น' });
  }

  list.unshift(newProduct);
  writeProducts(list);
  res.json({ ok: true, product: newProduct });
});

// แก้ไขสินค้า (รวมแก้สถานะ)
app.put('/api/admin/products/:id', requireAuth, (req, res) => {
  const list = readProducts();
  const idx = list.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'not found' });

  const body = req.body;
  const existing = list[idx];

  const tags = Array.isArray(body.tags)
    ? body.tags
    : (body.tags !== undefined ? String(body.tags).split(',').map(t => t.trim()).filter(Boolean) : existing.tags);

  list[idx] = {
    ...existing,
    name: body.name ?? existing.name,
    rank: body.rank ?? existing.rank,
    tier: body.tier ?? existing.tier,
    price: body.price !== undefined ? Number(body.price) : existing.price,
    oldPrice: body.oldPrice !== undefined ? Number(body.oldPrice) : existing.oldPrice,
    tags,
    level: body.level !== undefined ? Number(body.level) : existing.level,
    skins: body.skins !== undefined ? Number(body.skins) : existing.skins,
    diamonds: body.diamonds ?? existing.diamonds,
    desc: body.desc ?? existing.desc,
    color: body.color ?? existing.color,
    status: body.status ?? existing.status,
    image: body.image ?? existing.image
  };

  writeProducts(list);
  res.json({ ok: true, product: list[idx] });
});

// ลบสินค้า
app.delete('/api/admin/products/:id', requireAuth, (req, res) => {
  const list = readProducts();
  const next = list.filter(p => p.id !== req.params.id);
  if (next.length === list.length) return res.status(404).json({ error: 'not found' });
  writeProducts(next);
  res.json({ ok: true });
});

/* ===========================================================
   START SERVER
=========================================================== */
app.listen(PORT, () => {
  console.log(`FIREGAME SHOP server is running:`);
  console.log(`  หน้าร้าน:   http://localhost:${PORT}/`);
  console.log(`  หลังบ้าน:   http://localhost:${PORT}/admin.html`);
});

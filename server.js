require('dotenv').config();

const express = require('express');
const path = require('path');
const https = require('https');
const session = require('express-session');
const fs = require('fs');
const { Pool } = require('pg');

const TelegramBot = require('node-telegram-bot-api');

const app = express();

// ============================================
// 🔒 ДАННЫЕ ИЗ ПЕРЕМЕННЫХ ОКРУЖЕНИЯ
// ============================================
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const YOUR_GUILD_ID = process.env.YOUR_GUILD_ID;
const BOT_TOKEN = process.env.BOT_TOKEN;
const REDIRECT_URI = 'https://aurora-mc.onrender.com/auth/callback';

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;
const OWNER_DISCORD_ID = process.env.OWNER_DISCORD_ID;
const YOOMONEY_WALLET = process.env.YOOMONEY_WALLET;

// Supabase PostgreSQL
const DB_HOST = process.env.DB_HOST;
const DB_PORT = parseInt(process.env.DB_PORT) || 5432;
const DB_USER = process.env.DB_USER;
const DB_PASSWORD = process.env.DB_PASSWORD;
const DB_NAME = process.env.DB_NAME;

// Товар
const PRODUCT = {
    name: 'Поддержка сервера 🍪',
    price: 200,
    commands: [
        'lp user {player} parent add sponsor'
    ]
};

// ============================================
// 💾 JSON ХРАНИЛИЩЕ (резерв)
// ============================================
const DATA_DIR = path.join(__dirname, 'data');
const ORDERS_FILE = path.join(DATA_DIR, 'orders.json');
const NEWS_FILE = path.join(DATA_DIR, 'news.json');
const CITIES_FILE = path.join(DATA_DIR, 'cities.json');
const FRIENDS_FILE = path.join(DATA_DIR, 'friends.json');
const FORUM_FILE = path.join(DATA_DIR, 'forum.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

function readJSON(file, defaultData = []) {
    if (!fs.existsSync(file)) return defaultData;
    return JSON.parse(fs.readFileSync(file));
}

function writeJSON(file, data) {
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// Инициализация JSON файлов
if (!fs.existsSync(ORDERS_FILE)) writeJSON(ORDERS_FILE, []);
if (!fs.existsSync(NEWS_FILE)) writeJSON(NEWS_FILE, []);
if (!fs.existsSync(CITIES_FILE)) writeJSON(CITIES_FILE, []);
if (!fs.existsSync(FRIENDS_FILE)) writeJSON(FRIENDS_FILE, {});
if (!fs.existsSync(FORUM_FILE)) writeJSON(FORUM_FILE, []);

// ============================================
// 🗄️ ПОДКЛЮЧЕНИЕ К PostgreSQL (с резервом)
// ============================================
let pool = null;
let useDB = false;

async function initDB() {
    if (!DB_HOST || !DB_USER || !DB_PASSWORD) {
        console.log('⚠️ Переменные БД не заданы, используем JSON хранилище');
        return;
    }
    
    try {
        pool = new Pool({
            host: DB_HOST,
            port: DB_PORT,
            user: DB_USER,
            password: DB_PASSWORD,
            database: DB_NAME,
            ssl: { rejectUnauthorized: false },
            max: 5,
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 10000
        });
        
        const client = await pool.connect();
        await client.query('SELECT 1');
        client.release();
        console.log('✅ PostgreSQL подключена (Supabase)');
        useDB = true;
    } catch (err) {
        console.error('⚠️ Ошибка подключения к БД:', err.message);
        console.log('⚠️ Переключаемся на JSON хранилище');
        useDB = false;
    }
}

// ============================================
// 🤖 TELEGRAM БОТ
// ============================================
let bot = null;
if (TELEGRAM_BOT_TOKEN) {
    bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });
    console.log('🤖 Telegram бот запущен');
    bot.on('polling_error', (err) => console.log('Polling error:', err.code));
}

// ============================================
// 🛡️ RCON ФУНКЦИЯ
// ============================================
const RCON_HOST = process.env.RCON_HOST;
const RCON_PORT = parseInt(process.env.RCON_PORT) || 25575;
const RCON_PASSWORD = process.env.RCON_PASSWORD;
const Rcon = require('rcon');

async function sendRconCommand(playerName, command) {
    return new Promise((resolve, reject) => {
        const rcon = new Rcon(RCON_HOST, RCON_PORT, RCON_PASSWORD);
        rcon.on('auth', () => {
            rcon.send(command.replace('{player}', playerName));
            rcon.disconnect();
            resolve(true);
        });
        rcon.on('error', reject);
        rcon.connect();
    });
}

async function grantSponsor(playerName) {
    if (RCON_HOST && RCON_PASSWORD) {
        try {
            for (const cmd of PRODUCT.commands) {
                await sendRconCommand(playerName, cmd);
            }
            console.log(`✅ Привилегии выданы игроку ${playerName}`);
            return true;
        } catch (err) {
            console.error('❌ RCON ошибка:', err.message);
        }
    }
    console.log(`⚠️ RCON не настроен, нужно выдать вручную: lp user ${playerName} parent add sponsor`);
    return false;
}

// ============================================
// 🛡️ MIDDLEWARE
// ============================================
app.set('trust proxy', 1);
app.use(express.json());
app.use(express.static(__dirname));
app.use(session({
    secret: 'aurora-secret-key-2024',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: true, httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 24 * 7 }
}));

function checkAuth(req, res, next) {
    if (req.session.userId) return next();
    res.status(401).json({ error: 'Войдите через Discord' });
}

function checkOwner(req, res, next) {
    if (req.session.userId === OWNER_DISCORD_ID) return next();
    res.status(403).json({ error: 'Доступ запрещён' });
}

// ============================================
// 📦 API ЗАКАЗОВ
// ============================================

async function saveOrder(order) {
    if (useDB && pool) {
        try {
            await pool.query(
                'INSERT INTO orders (id, playerName, product, price, status, userId, userName, createdAt) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
                [order.id, order.playerName, order.product, order.price, order.status, order.userId, order.userName, order.createdAt]
            );
            return true;
        } catch (err) { console.error('DB save error:', err.message); }
    }
    const orders = readJSON(ORDERS_FILE);
    orders.push(order);
    writeJSON(ORDERS_FILE, orders);
    return true;
}

async function getOrder(orderId) {
    if (useDB && pool) {
        try {
            const res = await pool.query('SELECT * FROM orders WHERE id = $1', [orderId]);
            if (res.rows.length > 0) return res.rows[0];
        } catch (err) { console.error('DB get error:', err.message); }
    }
    const orders = readJSON(ORDERS_FILE);
    return orders.find(o => o.id === orderId);
}

async function updateOrderStatus(orderId, status, userId = null) {
    if (useDB && pool) {
        try {
            if (userId) {
                await pool.query('UPDATE orders SET status = $1 WHERE id = $2 AND userId = $3', [status, orderId, userId]);
            } else {
                await pool.query('UPDATE orders SET status = $1 WHERE id = $2', [status, orderId]);
            }
            return true;
        } catch (err) { console.error('DB update error:', err.message); }
    }
    const orders = readJSON(ORDERS_FILE);
    const order = orders.find(o => o.id === orderId);
    if (order && (!userId || order.userId === userId)) {
        order.status = status;
        writeJSON(ORDERS_FILE, orders);
    }
    return true;
}

async function getPendingOrders() {
    if (useDB && pool) {
        try {
            const res = await pool.query('SELECT * FROM orders WHERE status = $1 ORDER BY createdAt DESC', ['awaiting_confirmation']);
            return res.rows;
        } catch (err) { console.error('DB get pending error:', err.message); }
    }
    const orders = readJSON(ORDERS_FILE);
    return orders.filter(o => o.status === 'awaiting_confirmation');
}

async function getHistoryOrders() {
    if (useDB && pool) {
        try {
            const res = await pool.query('SELECT * FROM orders WHERE status IN ($1, $2) ORDER BY createdAt DESC', ['completed', 'cancelled']);
            return res.rows;
        } catch (err) { console.error('DB get history error:', err.message); }
    }
    const orders = readJSON(ORDERS_FILE);
    return orders.filter(o => o.status === 'completed' || o.status === 'cancelled');
}

async function completeOrder(orderId, playerName) {
    if (useDB && pool) {
        try {
            await grantSponsor(playerName);
            await pool.query('UPDATE orders SET status = $1, completedAt = $2 WHERE id = $3', ['completed', new Date().toISOString(), orderId]);
            return true;
        } catch (err) { console.error('DB complete error:', err.message); }
    }
    const orders = readJSON(ORDERS_FILE);
    const order = orders.find(o => o.id === orderId);
    if (order && order.status === 'awaiting_confirmation') {
        await grantSponsor(playerName);
        order.status = 'completed';
        order.completedAt = new Date().toISOString();
        writeJSON(ORDERS_FILE, orders);
    }
    return true;
}

app.post('/api/create-order', checkAuth, async (req, res) => {
    const { playerName } = req.body;
    if (!playerName) return res.status(400).json({ error: 'Укажите ник' });
    
    const orderId = Date.now().toString();
    const newOrder = {
        id: orderId,
        playerName,
        product: PRODUCT.name,
        price: PRODUCT.price,
        status: 'pending',
        userId: req.session.userId,
        userName: req.session.username,
        createdAt: new Date().toISOString()
    };
    
    await saveOrder(newOrder);
    
    const paymentUrl = `https://yoomoney.ru/quickpay/confirm.xml?receiver=${YOOMONEY_WALLET}&quickpay-form=shop&targets=Покупка+${encodeURIComponent(PRODUCT.name)}+для+${playerName}&sum=${PRODUCT.price}&paymentType=AC&label=${orderId}`;
    
    res.json({ success: true, orderId, paymentUrl });
});

app.get('/api/order/:id', async (req, res) => {
    const order = await getOrder(req.params.id);
    if (!order) return res.status(404).json({ error: 'Заказ не найден' });
    res.json(order);
});

app.post('/api/confirm-order', checkAuth, async (req, res) => {
    const { orderId } = req.body;
    const order = await getOrder(orderId);
    
    if (!order) return res.status(404).json({ error: 'Заказ не найден' });
    if (order.userId !== req.session.userId) return res.status(403).json({ error: 'Не ваш заказ' });
    if (order.status !== 'pending') return res.status(400).json({ error: 'Заказ уже обработан' });
    
    await updateOrderStatus(orderId, 'awaiting_confirmation');
    
    if (bot && ADMIN_CHAT_ID) {
        bot.sendMessage(ADMIN_CHAT_ID, `🆕 Новая покупка!\n👤 Игрок: ${order.playername || order.playerName}\n💰 Сумма: ${order.price}₽\n🆔 Заказ: ${orderId}`);
    }
    
    res.json({ success: true });
});

app.post('/api/cancel-order', checkAuth, async (req, res) => {
    const { orderId } = req.body;
    await updateOrderStatus(orderId, 'cancelled', req.session.userId);
    res.json({ success: true });
});

// ============================================
// 👑 АДМИН ПАНЕЛЬ API
// ============================================

app.get('/api/admin/orders', checkAuth, checkOwner, async (req, res) => {
    const orders = await getPendingOrders();
    res.json(orders);
});

app.get('/api/admin/history', checkAuth, checkOwner, async (req, res) => {
    const orders = await getHistoryOrders();
    res.json(orders);
});

app.post('/api/admin/grant', checkAuth, checkOwner, async (req, res) => {
    const { orderId } = req.body;
    const orders = await getPendingOrders();
    const order = orders.find(o => o.id === orderId);
    
    if (!order) return res.status(404).json({ error: 'Заказ не найден' });
    
    await completeOrder(orderId, order.playername || order.playerName);
    
    if (bot && ADMIN_CHAT_ID) {
        bot.sendMessage(ADMIN_CHAT_ID, `✅ Привилегии выданы игроку ${order.playername || order.playerName} (заказ #${orderId})`);
    }
    
    res.json({ success: true });
});

app.post('/api/admin/cancel', checkAuth, checkOwner, async (req, res) => {
    const { orderId } = req.body;
    await updateOrderStatus(orderId, 'cancelled');
    res.json({ success: true });
});

// ============================================
// 🏙️ API ГОРОДА (JSON, пока без БД)
// ============================================

app.get('/api/cities', (req, res) => {
    res.json(readJSON(CITIES_FILE));
});

app.post('/api/cities', checkAuth, (req, res) => {
    const { name, description } = req.body;
    const cities = readJSON(CITIES_FILE);
    cities.push({ id: Date.now(), name, description, ownerId: req.session.userId, ownerName: req.session.username, createdAt: new Date().toISOString() });
    writeJSON(CITIES_FILE, cities);
    res.json({ success: true });
});

app.delete('/api/cities/:id', checkAuth, (req, res) => {
    let cities = readJSON(CITIES_FILE);
    cities = cities.filter(c => c.id != req.params.id || c.ownerId !== req.session.userId);
    writeJSON(CITIES_FILE, cities);
    res.json({ success: true });
});

// ============================================
// 📄 СТРАНИЦЫ
// ============================================
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/payment-status', (req, res) => res.sendFile(path.join(__dirname, 'payment-status.html')));
app.get('/news', checkAuth, (req, res) => res.sendFile(path.join(__dirname, 'views', 'news.html')));
app.get('/cities', checkAuth, (req, res) => res.sendFile(path.join(__dirname, 'views', 'cities.html')));
app.get('/friends', checkAuth, (req, res) => res.sendFile(path.join(__dirname, 'views', 'friends.html')));
app.get('/forum', checkAuth, (req, res) => res.sendFile(path.join(__dirname, 'views', 'forum.html')));

app.get('/admin', (req, res) => {
    if (!req.session.userId) {
        return res.send(`<!DOCTYPE html><html><head><title>Доступ запрещён</title><style>body{background:#1a1d24;display:flex;justify-content:center;align-items:center;height:100vh;font-family:system-ui;color:white;margin:0}.error-box{text-align:center;background:#20232b;padding:40px;border-radius:24px;border:1px solid #ff4444}.back-link{color:#2ecc2e;text-decoration:none}</style></head><body><div class="error-box"><h1>🔒 Доступ запрещён</h1><p>Войдите через Discord.</p><a href="/" class="back-link">← На главную</a></div></body></html>`);
    }
    if (req.session.userId !== OWNER_DISCORD_ID) {
        return res.status(403).send(`<!DOCTYPE html><html><head><title>Доступ запрещён</title><style>body{background:#1a1d24;display:flex;justify-content:center;align-items:center;height:100vh;font-family:system-ui;color:white;margin:0}.error-box{text-align:center;background:#20232b;padding:40px;border-radius:24px;border:1px solid #ff4444}.back-link{color:#2ecc2e;text-decoration:none}</style></head><body><div class="error-box"><h1>⛔ Нет прав</h1><p>У вас нет доступа.</p><a href="/" class="back-link">← На главную</a></div></body></html>`);
    }
    res.sendFile(path.join(__dirname, 'admin.html'));
});

// ============================================
// 📊 API СТАТУС СЕРВЕРА
// ============================================
app.get('/api/server-status', async (req, res) => {
    try {
        const response = await fetch('https://api.mcsrvstat.us/2/213.171.18.141:32803');
        const data = await response.json();
        res.json(data);
    } catch {
        res.json({ online: false, players: { online: 0, max: 99 } });
    }
});

app.get('/api/user', (req, res) => {
    if (req.session.userId) {
        res.json({
            authenticated: true,
            id: req.session.userId,
            username: req.session.username,
            role: req.session.userRole,
            level: req.session.userLevel
        });
    } else {
        res.json({ authenticated: false });
    }
});

// ============================================
// 🔐 DISCORD OAuth2
// ============================================
const agent = new https.Agent({ rejectUnauthorized: false, keepAlive: true });

async function fetchWithRetry(url, options, retries = 3) {
    for (let i = 0; i < retries; i++) {
        try {
            const response = await fetch(url, { ...options, agent });
            if (response.ok) return response;
            throw new Error(`HTTP ${response.status}`);
        } catch (error) { if (i === retries - 1) throw error; await new Promise(r => setTimeout(r, 2000)); }
    }
}

app.get('/auth/discord', (req, res) => {
    const url = `https://discord.com/api/oauth2/authorize?client_id=${DISCORD_CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=identify%20guilds%20guilds.members.read`;
    res.redirect(url);
});

const ROLE_PRIORITY = [
    'SUPREME ADMINISTRATION', 'ADMINISTRATION', 'MODERATION', 'HEAD OF DISCORD',
    'HEAD OF MEDIA', 'COMPOSITION MONITOR', 'COMPOSITION OF AURORA', 'MEDIA',
    'SPONSOR', 'ADVERTISING MANAGER', 'HALLWAY', 'beginner'
];

const ROLE_IDS = {
    'SUPREME ADMINISTRATION': '1508797925554126959',
    'ADMINISTRATION': '1508797941152878684',
    'MODERATION': '1508797937810145361',
    'HEAD OF DISCORD': '1508190877149958154',
    'HEAD OF MEDIA': '1508191987117854870',
    'COMPOSITION MONITOR': '1508190618323779624',
    'COMPOSITION OF AURORA': '1508193203009093723',
    'MEDIA': '1508191854523318322',
    'SPONSOR': '1508191402255843468',
    'ADVERTISING MANAGER': '1508859389514088668',
    'HALLWAY': '1508172721035677899',
    'beginner': '1508183843910193303'
};

const ROLE_DISPLAY = {
    'SUPREME ADMINISTRATION': '👑 Supreme Administration', 'ADMINISTRATION': '⭐ Administration',
    'MODERATION': '🛡️ Moderation', 'HEAD OF DISCORD': '📢 Head of Discord',
    'HEAD OF MEDIA': '🎬 Head of Media', 'COMPOSITION MONITOR': '🔍 Composition Monitor',
    'COMPOSITION OF AURORA': '🤝 Composition of Aurora', 'MEDIA': '📹 Media',
    'SPONSOR': '💎 Sponsor', 'ADVERTISING MANAGER': '📢 Advertising Manager',
    'HALLWAY': '🚪 Hallway', 'beginner': '🌱 Beginner'
};

const ROLE_LEVEL = {
    'SUPREME ADMINISTRATION': '👑 Легендарный', 'ADMINISTRATION': '⭐ Элитный',
    'MODERATION': '🛡️ Продвинутый', 'HEAD OF DISCORD': '📢 Глава Discord',
    'HEAD OF MEDIA': '🎬 Глава медиа', 'COMPOSITION MONITOR': '🔍 Следящий',
    'COMPOSITION OF AURORA': '🤝 Команда Aurora', 'MEDIA': '📹 Медиа-партнер',
    'SPONSOR': '💎 Спонсор', 'ADVERTISING MANAGER': '📢 Рекламный менеджер',
    'HALLWAY': '🚪 Hallway', 'beginner': '🌱 Новичок'
};

function getHighestRoleById(userRoleIds) {
    for (const roleName of ROLE_PRIORITY) {
        const roleId = ROLE_IDS[roleName];
        if (roleId && userRoleIds.includes(roleId)) return { name: roleName, displayName: ROLE_DISPLAY[roleName], level: ROLE_LEVEL[roleName] };
    }
    return { name: 'beginner', displayName: '🌱 Beginner', level: '🌱 Новичок' };
}

app.get('/auth/callback', async (req, res) => {
    const { code } = req.query;
    if (!code) return res.status(400).send('Нет кода');
    try {
        const tokenParams = new URLSearchParams();
        tokenParams.append('client_id', DISCORD_CLIENT_ID);
        tokenParams.append('client_secret', DISCORD_CLIENT_SECRET);
        tokenParams.append('grant_type', 'authorization_code');
        tokenParams.append('code', code);
        tokenParams.append('redirect_uri', REDIRECT_URI);
        const tokenRes = await fetchWithRetry('https://discord.com/api/oauth2/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: tokenParams });
        const tokenData = await tokenRes.json();
        const accessToken = tokenData.access_token;
        const userRes = await fetchWithRetry('https://discord.com/api/users/@me', { headers: { Authorization: `Bearer ${accessToken}` } });
        const userData = await userRes.json();
        let userRoleIds = [];
        try {
            const memberRes = await fetchWithRetry(`https://discord.com/api/guilds/${YOUR_GUILD_ID}/members/${userData.id}`, { headers: { Authorization: `Bot ${BOT_TOKEN}` } });
            const memberData = await memberRes.json();
            userRoleIds = memberData.roles || [];
        } catch (err) {}
        const highestRole = getHighestRoleById(userRoleIds);
        req.session.userId = userData.id;
        req.session.username = userData.username;
        req.session.userRole = highestRole.name;
        req.session.userLevel = highestRole.level;
        const result = { id: userData.id, username: userData.username, avatar: userData.avatar, displayRole: highestRole.displayName, level: highestRole.level };
        res.send(`<!DOCTYPE html><html><head><title>Авторизация Aurora</title><style>body{background:#1a1d24;display:flex;justify-content:center;align-items:center;height:100vh;font-family:system-ui;color:white;margin:0}.success-box{text-align:center;background:#20232b;padding:40px;border-radius:24px;border:1px solid #2ecc2e}.spinner{width:40px;height:40px;border:3px solid #2ecc2e;border-top-color:transparent;border-radius:50%;animation:spin 0.8s linear infinite;margin:20px auto}@keyframes spin{to{transform:rotate(360deg)}}</style></head><body><div class="success-box"><div class="spinner"></div><div style="color:#2ecc2e;font-size:24px;">✅ Вход выполнен!</div><p>👤 ${userData.username}</p><p>🏷️ Роль: ${highestRole.displayName}</p><p>📊 Уровень: ${highestRole.level}</p><p>🔄 Перенаправление...</p></div><script>localStorage.setItem('aurora_user','${JSON.stringify(result).replace(/'/g, "\\'")}');setTimeout(()=>{window.location.href='/'},1500);</script></body></html>`);
    } catch (error) { res.status(500).send('Ошибка авторизации'); }
});

// ============================================
// 🚀 ЗАПУСК
// ============================================
const PORT = process.env.PORT || 3001;

async function start() {
    await initDB();
    app.listen(PORT, () => {
        console.log('='.repeat(50));
        console.log('🚀 Aurora Server запущен!');
        console.log(`📍 http://localhost:${PORT}`);
        console.log('='.repeat(50));
        console.log(`👑 Владелец ID: ${OWNER_DISCORD_ID || '❌'}`);
        console.log(`🤖 Telegram: ${TELEGRAM_BOT_TOKEN ? '✅' : '❌'}`);
        console.log(`💳 ЮMoney: ${YOOMONEY_WALLET ? '✅' : '❌'}`);
        console.log(`🗄️ Режим: ${useDB ? 'PostgreSQL' : 'JSON (резерв)'}`);
    });
}

start();
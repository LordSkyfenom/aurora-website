require('dotenv').config();

const express = require('express');
const path = require('path');
const https = require('https');
const session = require('express-session');
const fs = require('fs');

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

// Товар
const PRODUCT = {
    name: 'Поддержка сервера 🍪',
    price: 200,
    commands: [
        'lp user {player} parent add sponsor'
    ]
};

// ============================================
// 💾 JSON ХРАНИЛИЩЕ
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
// 🤖 TELEGRAM БОТ
// ============================================
let bot = null;
if (TELEGRAM_BOT_TOKEN) {
    bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });
    console.log('🤖 Telegram бот запущен');
    bot.on('polling_error', (err) => console.log('Polling error:', err.code));
}

// ============================================
// 🛡️ RCON ФУНКЦИЯ (отключена - ручная выдача)
// ============================================
async function grantSponsor(playerName) {
    console.log(`========================================`);
    console.log(`🎁 НУЖНО ВЫДАТЬ ПРИВИЛЕГИЮ ВРУЧНУЮ:`);
    console.log(`lp user ${playerName} parent add sponsor`);
    console.log(`========================================`);
    return Promise.resolve(true);
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

app.post('/api/create-order', checkAuth, (req, res) => {
    const { playerName } = req.body;
    if (!playerName) return res.status(400).json({ error: 'Укажите ник' });
    
    const orders = readJSON(ORDERS_FILE);
    const newOrder = {
        id: Date.now().toString(),
        playerName,
        product: PRODUCT.name,
        price: PRODUCT.price,
        status: 'pending',
        userId: req.session.userId,
        userName: req.session.username,
        createdAt: new Date().toISOString()
    };
    orders.push(newOrder);
    writeJSON(ORDERS_FILE, orders);
    
    const paymentUrl = `https://yoomoney.ru/quickpay/confirm.xml?receiver=${YOOMONEY_WALLET}&quickpay-form=shop&targets=Покупка+${encodeURIComponent(PRODUCT.name)}+для+${playerName}&sum=${PRODUCT.price}&paymentType=AC&label=${newOrder.id}`;
    
    res.json({ success: true, orderId: newOrder.id, paymentUrl });
});

app.get('/api/order/:id', (req, res) => {
    const orders = readJSON(ORDERS_FILE);
    const order = orders.find(o => o.id === req.params.id);
    if (!order) return res.status(404).json({ error: 'Заказ не найден' });
    res.json(order);
});

app.post('/api/confirm-order', checkAuth, (req, res) => {
    const { orderId } = req.body;
    const orders = readJSON(ORDERS_FILE);
    const order = orders.find(o => o.id === orderId);
    
    if (!order) return res.status(404).json({ error: 'Заказ не найден' });
    if (order.userId !== req.session.userId) return res.status(403).json({ error: 'Не ваш заказ' });
    if (order.status !== 'pending') return res.status(400).json({ error: 'Заказ уже обработан' });
    
    order.status = 'awaiting_confirmation';
    writeJSON(ORDERS_FILE, orders);
    
    if (bot && ADMIN_CHAT_ID) {
        bot.sendMessage(ADMIN_CHAT_ID, `🆕 Новая покупка!\n👤 Игрок: ${order.playerName}\n💰 Сумма: ${order.price}₽\n🆔 Заказ: ${orderId}`);
    }
    
    res.json({ success: true });
});

app.post('/api/cancel-order', checkAuth, (req, res) => {
    const { orderId } = req.body;
    const orders = readJSON(ORDERS_FILE);
    const order = orders.find(o => o.id === orderId);
    if (order && order.userId === req.session.userId) {
        order.status = 'cancelled';
        writeJSON(ORDERS_FILE, orders);
    }
    res.json({ success: true });
});

// ============================================
// 👑 АДМИН ПАНЕЛЬ API
// ============================================

app.get('/api/admin/orders', checkAuth, checkOwner, (req, res) => {
    const orders = readJSON(ORDERS_FILE);
    const pendingOrders = orders.filter(o => o.status === 'awaiting_confirmation');
    res.json(pendingOrders);
});

app.get('/api/admin/history', checkAuth, checkOwner, (req, res) => {
    const orders = readJSON(ORDERS_FILE);
    const history = orders.filter(o => o.status === 'completed' || o.status === 'cancelled');
    res.json(history);
});

app.post('/api/admin/grant', checkAuth, checkOwner, async (req, res) => {
    const { orderId } = req.body;
    const orders = readJSON(ORDERS_FILE);
    const order = orders.find(o => o.id === orderId);
    
    if (!order || order.status !== 'awaiting_confirmation') return res.status(404).json({ error: 'Заказ не найден' });
    
    await grantSponsor(order.playerName);
    order.status = 'completed';
    order.completedAt = new Date().toISOString();
    writeJSON(ORDERS_FILE, orders);
    
    if (bot && ADMIN_CHAT_ID) {
        bot.sendMessage(ADMIN_CHAT_ID, `✅ Привилегии выданы игроку ${order.playerName} (заказ #${orderId})`);
    }
    
    res.json({ success: true });
});

app.post('/api/admin/cancel', checkAuth, checkOwner, (req, res) => {
    const { orderId } = req.body;
    const orders = readJSON(ORDERS_FILE);
    const order = orders.find(o => o.id === orderId);
    if (order && order.status === 'awaiting_confirmation') {
        order.status = 'cancelled';
        writeJSON(ORDERS_FILE, orders);
    }
    res.json({ success: true });
});

// ============================================
// 📰 API НОВОСТИ
// ============================================

app.get('/api/news', (req, res) => {
    const news = readJSON(NEWS_FILE);
    res.json(news);
});

app.post('/api/news', checkAuth, (req, res) => {
    const { title, content } = req.body;
    const news = readJSON(NEWS_FILE);
    news.unshift({ id: Date.now(), title, content, authorId: req.session.userId, authorName: req.session.username, createdAt: new Date().toISOString() });
    writeJSON(NEWS_FILE, news);
    res.json({ success: true });
});

app.delete('/api/news/:id', checkAuth, (req, res) => {
    let news = readJSON(NEWS_FILE);
    news = news.filter(n => n.id !== req.params.id);
    writeJSON(NEWS_FILE, news);
    res.json({ success: true });
});

// ============================================
// 🏙️ API ГОРОДА
// ============================================

app.get('/api/cities', (req, res) => {
    const cities = readJSON(CITIES_FILE);
    res.json(cities);
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
    cities = cities.filter(c => c.id !== req.params.id || c.ownerId !== req.session.userId);
    writeJSON(CITIES_FILE, cities);
    res.json({ success: true });
});

// ============================================
// 👥 API ДРУЗЬЯ
// ============================================

app.get('/api/friends/data', checkAuth, (req, res) => {
    const data = readJSON(FRIENDS_FILE);
    res.json(data[req.session.userId] || { friends: [], messages: [] });
});

app.post('/api/friends/add', checkAuth, (req, res) => {
    const { friendId } = req.body;
    const data = readJSON(FRIENDS_FILE);
    if (!data[req.session.userId]) data[req.session.userId] = { friends: [], messages: [] };
    if (!data[req.session.userId].friends.includes(friendId)) {
        data[req.session.userId].friends.push(friendId);
        if (!data[friendId]) data[friendId] = { friends: [], messages: [] };
        if (!data[friendId].friends.includes(req.session.userId)) data[friendId].friends.push(req.session.userId);
        writeJSON(FRIENDS_FILE, data);
    }
    res.json({ success: true });
});

app.post('/api/friends/message', checkAuth, (req, res) => {
    const { toId, message } = req.body;
    const data = readJSON(FRIENDS_FILE);
    const msg = { id: Date.now(), from: req.session.userId, fromName: req.session.username, to: toId, message, timestamp: new Date().toISOString() };
    if (!data[req.session.userId]) data[req.session.userId] = { friends: [], messages: [] };
    if (!data[req.session.userId].messages) data[req.session.userId].messages = [];
    data[req.session.userId].messages.push(msg);
    if (!data[toId]) data[toId] = { friends: [], messages: [] };
    if (!data[toId].messages) data[toId].messages = [];
    data[toId].messages.push(msg);
    writeJSON(FRIENDS_FILE, data);
    res.json({ success: true });
});

// ============================================
// 📝 API ФОРУМ
// ============================================

app.get('/api/forum', (req, res) => {
    const forum = readJSON(FORUM_FILE);
    res.json(forum);
});

app.post('/api/forum', checkAuth, (req, res) => {
    const { title, content } = req.body;
    const forum = readJSON(FORUM_FILE);
    forum.push({ id: Date.now(), title, content, authorId: req.session.userId, authorName: req.session.username, createdAt: new Date().toISOString(), answers: [] });
    writeJSON(FORUM_FILE, forum);
    res.json({ success: true });
});

app.post('/api/forum/:id/answer', checkAuth, (req, res) => {
    const { content } = req.body;
    const forum = readJSON(FORUM_FILE);
    const post = forum.find(p => p.id === req.params.id);
    if (post) {
        post.answers.push({ id: Date.now(), authorId: req.session.userId, authorName: req.session.username, content, createdAt: new Date().toISOString() });
        writeJSON(FORUM_FILE, forum);
        res.json({ success: true });
    } else res.status(404).json({ error: 'Пост не найден' });
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
app.listen(PORT, () => {
    console.log('='.repeat(50));
    console.log('🚀 Aurora Server запущен!');
    console.log(`📍 http://localhost:${PORT}`);
    console.log('='.repeat(50));
    console.log(`👑 Владелец ID: ${OWNER_DISCORD_ID || '❌'}`);
    console.log(`🤖 Telegram: ${TELEGRAM_BOT_TOKEN ? '✅' : '❌'}`);
    console.log(`💳 ЮMoney: ${YOOMONEY_WALLET ? '✅' : '❌'}`);
});
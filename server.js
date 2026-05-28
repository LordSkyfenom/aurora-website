require('dotenv').config();

const express = require('express');
const path = require('path');
const https = require('https');
const session = require('express-session');
const fs = require('fs');
const mysql = require('mysql2/promise');

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

// База данных Beget
const DB_HOST = process.env.DB_HOST;
const DB_PORT = parseInt(process.env.DB_PORT) || 3306;
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
// 🗄️ ПОДКЛЮЧЕНИЕ К БД (с увеличенным wait_timeout)
// ============================================
let pool;

async function initDB() {
    pool = mysql.createPool({
        host: DB_HOST,
        port: DB_PORT,
        user: DB_USER,
        password: DB_PASSWORD,
        database: DB_NAME,
        waitForConnections: true,
        connectionLimit: 5,
        queueLimit: 0,
        enableKeepAlive: true,
        keepAliveInitialDelay: 10000,
        connectTimeout: 10000
    });
    
    // Увеличиваем wait_timeout для сессии (решение от поддержки Beget)
    const connection = await pool.getConnection();
    await connection.query('SET SESSION wait_timeout = 28800');
    await connection.query('SET SESSION interactive_timeout = 28800');
    connection.release();
    
    const [rows] = await pool.execute('SELECT 1');
    console.log('✅ База данных MySQL подключена (Beget)');
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

app.post('/api/create-order', checkAuth, async (req, res) => {
    const { playerName } = req.body;
    if (!playerName) return res.status(400).json({ error: 'Укажите ник' });
    
    const orderId = Date.now().toString();
    const createdAt = new Date().toISOString().slice(0, 19).replace('T', ' ');
    
    await pool.execute(
        'INSERT INTO orders (id, playerName, product, price, status, userId, userName, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [orderId, playerName, PRODUCT.name, PRODUCT.price, 'pending', req.session.userId, req.session.username, createdAt]
    );
    
    const paymentUrl = `https://yoomoney.ru/quickpay/confirm.xml?receiver=${YOOMONEY_WALLET}&quickpay-form=shop&targets=Покупка+${encodeURIComponent(PRODUCT.name)}+для+${playerName}&sum=${PRODUCT.price}&paymentType=AC&label=${orderId}`;
    
    res.json({ success: true, orderId, paymentUrl });
});

app.get('/api/order/:id', async (req, res) => {
    const [rows] = await pool.execute('SELECT * FROM orders WHERE id = ?', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Заказ не найден' });
    res.json(rows[0]);
});

app.post('/api/confirm-order', checkAuth, async (req, res) => {
    const { orderId } = req.body;
    
    const [rows] = await pool.execute('SELECT * FROM orders WHERE id = ? AND userId = ?', [orderId, req.session.userId]);
    if (rows.length === 0) return res.status(404).json({ error: 'Заказ не найден' });
    
    const order = rows[0];
    if (order.status !== 'pending') return res.status(400).json({ error: 'Заказ уже обработан' });
    
    await pool.execute('UPDATE orders SET status = ? WHERE id = ?', ['awaiting_confirmation', orderId]);
    
    if (bot && ADMIN_CHAT_ID) {
        bot.sendMessage(ADMIN_CHAT_ID, `🆕 Новая покупка!\n👤 Игрок: ${order.playerName}\n💰 Сумма: ${order.price}₽\n🆔 Заказ: ${orderId}`);
    }
    
    res.json({ success: true });
});

app.post('/api/cancel-order', checkAuth, async (req, res) => {
    const { orderId } = req.body;
    await pool.execute('UPDATE orders SET status = ? WHERE id = ? AND userId = ?', ['cancelled', orderId, req.session.userId]);
    res.json({ success: true });
});

// ============================================
// 👑 АДМИН ПАНЕЛЬ API
// ============================================

app.get('/api/admin/orders', checkAuth, checkOwner, async (req, res) => {
    const [rows] = await pool.execute('SELECT * FROM orders WHERE status = ? ORDER BY createdAt DESC', ['awaiting_confirmation']);
    res.json(rows);
});

app.get('/api/admin/history', checkAuth, checkOwner, async (req, res) => {
    const [rows] = await pool.execute('SELECT * FROM orders WHERE status IN (?, ?) ORDER BY createdAt DESC', ['completed', 'cancelled']);
    res.json(rows);
});

app.post('/api/admin/grant', checkAuth, checkOwner, async (req, res) => {
    const { orderId } = req.body;
    
    const [rows] = await pool.execute('SELECT * FROM orders WHERE id = ? AND status = ?', [orderId, 'awaiting_confirmation']);
    if (rows.length === 0) return res.status(404).json({ error: 'Заказ не найден' });
    
    const order = rows[0];
    await grantSponsor(order.playerName);
    
    const completedAt = new Date().toISOString().slice(0, 19).replace('T', ' ');
    await pool.execute('UPDATE orders SET status = ?, completedAt = ? WHERE id = ?', ['completed', completedAt, orderId]);
    
    if (bot && ADMIN_CHAT_ID) {
        bot.sendMessage(ADMIN_CHAT_ID, `✅ Привилегии выданы игроку ${order.playerName} (заказ #${orderId})`);
    }
    
    res.json({ success: true });
});

app.post('/api/admin/cancel', checkAuth, checkOwner, async (req, res) => {
    const { orderId } = req.body;
    await pool.execute('UPDATE orders SET status = ? WHERE id = ?', ['cancelled', orderId]);
    res.json({ success: true });
});

// ============================================
// 📰 API НОВОСТИ
// ============================================

app.get('/api/news', async (req, res) => {
    const [rows] = await pool.execute('SELECT * FROM news ORDER BY createdAt DESC');
    res.json(rows);
});

app.post('/api/news', checkAuth, async (req, res) => {
    const { title, content } = req.body;
    const id = Date.now().toString();
    const createdAt = new Date().toISOString().slice(0, 19).replace('T', ' ');
    await pool.execute(
        'INSERT INTO news (id, title, content, authorId, authorName, createdAt) VALUES (?, ?, ?, ?, ?, ?)',
        [id, title, content, req.session.userId, req.session.username, createdAt]
    );
    res.json({ success: true });
});

app.delete('/api/news/:id', checkAuth, async (req, res) => {
    await pool.execute('DELETE FROM news WHERE id = ?', [req.params.id]);
    res.json({ success: true });
});

// ============================================
// 🏙️ API ГОРОДА
// ============================================

app.get('/api/cities', async (req, res) => {
    const [rows] = await pool.execute('SELECT * FROM cities ORDER BY createdAt DESC');
    res.json(rows);
});

app.post('/api/cities', checkAuth, async (req, res) => {
    const { name, description } = req.body;
    const id = Date.now().toString();
    const createdAt = new Date().toISOString().slice(0, 19).replace('T', ' ');
    await pool.execute(
        'INSERT INTO cities (id, name, description, ownerId, ownerName, createdAt) VALUES (?, ?, ?, ?, ?, ?)',
        [id, name, description, req.session.userId, req.session.username, createdAt]
    );
    res.json({ success: true });
});

app.delete('/api/cities/:id', checkAuth, async (req, res) => {
    await pool.execute('DELETE FROM cities WHERE id = ? AND ownerId = ?', [req.params.id, req.session.userId]);
    res.json({ success: true });
});

// ============================================
// 👥 API ДРУЗЬЯ
// ============================================

app.get('/api/friends/data', checkAuth, async (req, res) => {
    const [rows] = await pool.execute('SELECT data FROM friends WHERE userId = ?', [req.session.userId]);
    if (rows.length === 0) {
        res.json({ friends: [], messages: [] });
    } else {
        res.json(rows[0].data);
    }
});

app.post('/api/friends/add', checkAuth, async (req, res) => {
    const { friendId } = req.body;
    const [rows] = await pool.execute('SELECT data FROM friends WHERE userId = ?', [req.session.userId]);
    let data = rows.length > 0 ? rows[0].data : { friends: [], messages: [] };
    
    if (!data.friends.includes(friendId)) {
        data.friends.push(friendId);
        await pool.execute(
            'INSERT INTO friends (userId, data) VALUES (?, ?) ON DUPLICATE KEY UPDATE data = ?',
            [req.session.userId, JSON.stringify(data), JSON.stringify(data)]
        );
    }
    res.json({ success: true });
});

app.post('/api/friends/message', checkAuth, async (req, res) => {
    const { toId, message } = req.body;
    const msg = { id: Date.now(), from: req.session.userId, fromName: req.session.username, to: toId, message, timestamp: new Date().toISOString() };
    
    // Сообщение отправителю
    let [rows] = await pool.execute('SELECT data FROM friends WHERE userId = ?', [req.session.userId]);
    let data = rows.length > 0 ? rows[0].data : { friends: [], messages: [] };
    if (!data.messages) data.messages = [];
    data.messages.push(msg);
    await pool.execute('INSERT INTO friends (userId, data) VALUES (?, ?) ON DUPLICATE KEY UPDATE data = ?',
        [req.session.userId, JSON.stringify(data), JSON.stringify(data)]);
    
    // Сообщение получателю
    [rows] = await pool.execute('SELECT data FROM friends WHERE userId = ?', [toId]);
    data = rows.length > 0 ? rows[0].data : { friends: [], messages: [] };
    if (!data.messages) data.messages = [];
    data.messages.push(msg);
    await pool.execute('INSERT INTO friends (userId, data) VALUES (?, ?) ON DUPLICATE KEY UPDATE data = ?',
        [toId, JSON.stringify(data), JSON.stringify(data)]);
    
    res.json({ success: true });
});

// ============================================
// 📝 API ФОРУМ
// ============================================

app.get('/api/forum', async (req, res) => {
    const [rows] = await pool.execute('SELECT * FROM forum ORDER BY createdAt DESC');
    res.json(rows);
});

app.post('/api/forum', checkAuth, async (req, res) => {
    const { title, content } = req.body;
    const id = Date.now().toString();
    const createdAt = new Date().toISOString().slice(0, 19).replace('T', ' ');
    await pool.execute(
        'INSERT INTO forum (id, title, content, authorId, authorName, createdAt, answers) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [id, title, content, req.session.userId, req.session.username, createdAt, '[]']
    );
    res.json({ success: true });
});

app.post('/api/forum/:id/answer', checkAuth, async (req, res) => {
    const { content } = req.body;
    const [rows] = await pool.execute('SELECT answers FROM forum WHERE id = ?', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Пост не найден' });
    
    let answers = rows[0].answers || [];
    answers.push({ id: Date.now(), authorId: req.session.userId, authorName: req.session.username, content, createdAt: new Date().toISOString() });
    
    await pool.execute('UPDATE forum SET answers = ? WHERE id = ?', [JSON.stringify(answers), req.params.id]);
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
        console.log(`🗄️ MySQL: ${DB_HOST ? '✅' : '❌'}`);
    });
}

start();
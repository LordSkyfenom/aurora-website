require('dotenv').config();

const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');

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

const DATABASE_URL = process.env.DATABASE_URL;

const PRODUCT = {
    name: 'Поддержка сервера 🍪',
    price: 200,
    commands: ['lp user {player} parent add sponsor']
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

if (!fs.existsSync(ORDERS_FILE)) writeJSON(ORDERS_FILE, []);
if (!fs.existsSync(NEWS_FILE)) writeJSON(NEWS_FILE, []);
if (!fs.existsSync(CITIES_FILE)) writeJSON(CITIES_FILE, []);
if (!fs.existsSync(FRIENDS_FILE)) writeJSON(FRIENDS_FILE, {});
if (!fs.existsSync(FORUM_FILE)) writeJSON(FORUM_FILE, []);

// ============================================
// 🗄️ БАЗА ДАННЫХ (Neon)
// ============================================
let pool = null;
let useDB = false;

async function initDB() {
    if (!DATABASE_URL) {
        console.log('⚠️ DATABASE_URL не задана, используем JSON');
        return;
    }
    try {
        pool = new Pool({
            connectionString: DATABASE_URL,
            ssl: { rejectUnauthorized: false }
        });
        await pool.connect();
        console.log('✅ PostgreSQL подключена');
        useDB = true;
    } catch (err) {
        console.error('⚠️ Ошибка БД:', err.message);
        useDB = false;
    }
}

// ============================================
// 🤖 TELEGRAM БОТ
// ============================================
let bot = null;
if (TELEGRAM_BOT_TOKEN) {
    bot = new TelegramBot(TELEGRAM_BOT_TOKEN);
    console.log('🤖 Telegram бот создан (webhook mode)');
}

app.post('/webhook/telegram', express.json(), (req, res) => {
    console.log('📥 Получен webhook от Telegram');
    res.status(200).send('OK');
});

// ============================================
// 🛡️ RCON
// ============================================
const RCON_HOST = process.env.RCON_HOST;
const RCON_PORT = parseInt(process.env.RCON_PORT) || 25575;
const RCON_PASSWORD = process.env.RCON_PASSWORD;
const Rcon = require('rcon');

async function grantSponsor(playerName) {
    if (RCON_HOST && RCON_PASSWORD) {
        return new Promise((resolve) => {
            const rcon = new Rcon(RCON_HOST, RCON_PORT, RCON_PASSWORD);
            rcon.on('auth', () => {
                rcon.send(`lp user ${playerName} parent add sponsor`);
                rcon.disconnect();
                resolve(true);
            });
            rcon.on('error', () => resolve(false));
            rcon.connect();
        });
    }
    console.log(`⚠️ Выдайте вручную: lp user ${playerName} parent add sponsor`);
    return false;
}

// ============================================
// 🛡️ MIDDLEWARE (СЕССИИ ДО ВСЕХ МАРШРУТОВ!)
// ============================================
app.set('trust proxy', 1);
app.use(express.json());
app.use(express.static(__dirname));

// НАСТРОЙКА СЕССИЙ - ДО ВСЕХ МАРШРУТОВ
app.use(session({
    secret: 'aurora-secret-key-2024',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: false,
        httpOnly: true, 
        sameSite: 'lax', 
        maxAge: 1000 * 60 * 60 * 24 * 7
    }
}));

function checkAuth(req, res, next) {
    if (req.session.userId) return next();
    res.status(401).sendFile(path.join(__dirname, 'unauthorized.html'));
}

function checkOwner(req, res, next) {
    if (req.session.userId === OWNER_DISCORD_ID) return next();
    res.status(403).sendFile(path.join(__dirname, 'forbidden.html'));
}

// ============================================
// 📦 ЗАКАЗЫ
// ============================================
async function saveOrder(order) {
    if (useDB && pool) {
        try {
            await pool.query(
                'INSERT INTO orders (id, playerName, product, price, status, userId, userName, createdAt) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
                [order.id, order.playerName, order.product, order.price, order.status, order.userId, order.userName, order.createdAt]
            );
            return;
        } catch (err) { console.error('DB save error:', err.message); }
    }
    const orders = readJSON(ORDERS_FILE);
    orders.push(order);
    writeJSON(ORDERS_FILE, orders);
}

async function getOrder(orderId) {
    if (useDB && pool) {
        try {
            const res = await pool.query('SELECT * FROM orders WHERE id = $1', [orderId]);
            if (res.rows.length) {
                const order = res.rows[0];
                order.userId = order.userid;
                return order;
            }
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
            return;
        } catch (err) { console.error('DB update error:', err.message); }
    }
    const orders = readJSON(ORDERS_FILE);
    const order = orders.find(o => o.id === orderId);
    if (order && (!userId || order.userId === userId)) {
        order.status = status;
        writeJSON(ORDERS_FILE, orders);
    }
}

async function getPendingOrders() {
    if (useDB && pool) {
        try {
            const res = await pool.query('SELECT * FROM orders WHERE status = $1 ORDER BY createdAt DESC', ['awaiting_confirmation']);
            return res.rows.map(order => {
                order.userId = order.userid;
                return order;
            });
        } catch (err) { console.error('DB get pending error:', err.message); }
    }
    const orders = readJSON(ORDERS_FILE);
    return orders.filter(o => o.status === 'awaiting_confirmation');
}

async function getHistoryOrders() {
    if (useDB && pool) {
        try {
            const res = await pool.query('SELECT * FROM orders WHERE status IN ($1, $2) ORDER BY createdAt DESC', ['completed', 'cancelled']);
            return res.rows.map(order => {
                order.userId = order.userid;
                return order;
            });
        } catch (err) { console.error('DB get history error:', err.message); }
    }
    const orders = readJSON(ORDERS_FILE);
    return orders.filter(o => o.status === 'completed' || o.status === 'cancelled');
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
        bot.sendMessage(ADMIN_CHAT_ID, `🆕 Новая покупка!\n👤 Игрок: ${order.playerName}\n💰 Сумма: ${order.price}₽\n🆔 Заказ: ${orderId}`);
    }
    
    res.json({ success: true });
});

app.post('/api/cancel-order', checkAuth, async (req, res) => {
    const { orderId } = req.body;
    await updateOrderStatus(orderId, 'cancelled', req.session.userId);
    res.json({ success: true });
});

// ============================================
// 👑 АДМИН ПАНЕЛЬ
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
    
    await grantSponsor(order.playerName);
    await updateOrderStatus(orderId, 'completed');
    
    if (bot && ADMIN_CHAT_ID) {
        bot.sendMessage(ADMIN_CHAT_ID, `✅ Привилегии выданы ${order.playerName} (заказ #${orderId})`);
    }
    res.json({ success: true });
});

app.post('/api/admin/cancel', checkAuth, checkOwner, async (req, res) => {
    const { orderId } = req.body;
    await updateOrderStatus(orderId, 'cancelled');
    res.json({ success: true });
});

// ============================================
// 📰 НОВОСТИ (JSON)
// ============================================
app.get('/api/news', (req, res) => res.json(readJSON(NEWS_FILE)));
app.post('/api/news', checkAuth, (req, res) => {
    const { title, content } = req.body;
    const news = readJSON(NEWS_FILE);
    news.unshift({ id: Date.now(), title, content, authorId: req.session.userId, authorName: req.session.username, createdAt: new Date().toISOString() });
    writeJSON(NEWS_FILE, news);
    res.json({ success: true });
});
app.delete('/api/news/:id', checkAuth, (req, res) => {
    let news = readJSON(NEWS_FILE);
    news = news.filter(n => n.id != req.params.id);
    writeJSON(NEWS_FILE, news);
    res.json({ success: true });
});

// ============================================
// 🏙️ ГОРОДА (JSON + PostgreSQL)
// ============================================
app.get('/api/cities', async (req, res) => {
    if (useDB && pool) {
        try {
            const result = await pool.query('SELECT * FROM cities ORDER BY createdAt DESC');
            return res.json(result.rows);
        } catch (err) { console.error('DB cities error:', err.message); }
    }
    const cities = readJSON(CITIES_FILE);
    res.json(cities);
});

app.post('/api/cities', checkAuth, async (req, res) => {
    const { name, description } = req.body;
    const id = Date.now().toString();
    const createdAt = new Date().toISOString();
    
    if (useDB && pool) {
        try {
            await pool.query(
                'INSERT INTO cities (id, name, description, ownerId, ownerName, createdAt) VALUES ($1, $2, $3, $4, $5, $6)',
                [id, name, description, req.session.userId, req.session.username, createdAt]
            );
            return res.json({ success: true });
        } catch (err) { console.error('DB cities insert error:', err.message); }
    }
    
    const cities = readJSON(CITIES_FILE);
    cities.push({ id, name, description, ownerId: req.session.userId, ownerName: req.session.username, createdAt });
    writeJSON(CITIES_FILE, cities);
    res.json({ success: true });
});

// ИСПРАВЛЕННОЕ УДАЛЕНИЕ ГОРОДА
app.delete('/api/cities/:id', checkAuth, async (req, res) => {
    console.log(`🗑️ Удаление города ${req.params.id}, userId: ${req.session.userId}`);
    
    if (useDB && pool) {
        try {
            const result = await pool.query('SELECT ownerId, ownerid FROM cities WHERE id = $1', [req.params.id]);
            if (result.rows.length === 0) {
                return res.status(404).json({ error: 'Город не найден' });
            }
            
            const dbOwnerId = result.rows[0].ownerid || result.rows[0].ownerId;
            console.log(`Сравнение: ${dbOwnerId} === ${req.session.userId}`);
            
            if (String(dbOwnerId) !== String(req.session.userId)) {
                return res.status(403).json({ error: 'Нет прав на удаление' });
            }
            
            await pool.query('DELETE FROM cities WHERE id = $1', [req.params.id]);
            return res.json({ success: true });
        } catch (err) { 
            console.error('DB cities delete error:', err.message); 
        }
    }
    
    // JSON резерв
    let cities = readJSON(CITIES_FILE);
    const city = cities.find(c => c.id == req.params.id);
    if (!city) return res.status(404).json({ error: 'Город не найден' });
    if (String(city.ownerId) !== String(req.session.userId)) {
        return res.status(403).json({ error: 'Нет прав на удаление' });
    }
    cities = cities.filter(c => c.id != req.params.id);
    writeJSON(CITIES_FILE, cities);
    res.json({ success: true });
});

// ============================================
// 👥 ДРУЗЬЯ (JSON)
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
// 📝 ФОРУМ (JSON)
// ============================================
app.get('/api/forum', (req, res) => res.json(readJSON(FORUM_FILE)));
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
    const post = forum.find(p => p.id == req.params.id);
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
    if (!req.session.userId) return res.sendFile(path.join(__dirname, 'unauthorized.html'));
    if (req.session.userId !== OWNER_DISCORD_ID) return res.status(403).sendFile(path.join(__dirname, 'forbidden.html'));
    res.sendFile(path.join(__dirname, 'admin.html'));
});

// ============================================
// 📊 СТАТУСЫ
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
        res.json({ authenticated: true, id: req.session.userId, username: req.session.username, role: req.session.userRole, level: req.session.userLevel });
    } else {
        res.json({ authenticated: false });
    }
});

app.get('/api/debug-session', (req, res) => {
    res.json({ userId: req.session.userId, username: req.session.username });
});

app.get('/api/db-status', (req, res) => {
    res.json({ useDB, message: useDB ? 'PostgreSQL подключена' : 'JSON резерв' });
});

// ============================================
// 🔐 DISCORD OAUTH
// ============================================
const agent = new https.Agent({ rejectUnauthorized: false, keepAlive: true });

async function fetchWithRetry(url, options, retries = 3) {
    for (let i = 0; i < retries; i++) {
        try {
            const response = await fetch(url, { ...options, agent });
            if (response.ok) return response;
            throw new Error(`HTTP ${response.status}`);
        } catch (error) {
            if (i === retries - 1) throw error;
            await new Promise(r => setTimeout(r, 2000));
        }
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
        if (roleId && userRoleIds.includes(roleId)) {
            return { name: roleName, displayName: ROLE_DISPLAY[roleName], level: ROLE_LEVEL[roleName] };
        }
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
        
        const tokenRes = await fetchWithRetry('https://discord.com/api/oauth2/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: tokenParams
        });
        const tokenData = await tokenRes.json();
        const accessToken = tokenData.access_token;
        
        const userRes = await fetchWithRetry('https://discord.com/api/users/@me', {
            headers: { Authorization: `Bearer ${accessToken}` }
        });
        const userData = await userRes.json();
        
        let userRoleIds = [];
        try {
            const memberRes = await fetchWithRetry(`https://discord.com/api/guilds/${YOUR_GUILD_ID}/members/${userData.id}`, {
                headers: { Authorization: `Bot ${BOT_TOKEN}` }
            });
            const memberData = await memberRes.json();
            userRoleIds = memberData.roles || [];
            console.log('📋 ID ролей:', userRoleIds);
        } catch (err) {
            console.log('⚠️ Ошибка получения ролей:', err.message);
        }
        
        const highestRole = getHighestRoleById(userRoleIds);
        console.log(`🏆 Роль: ${highestRole.displayName}`);
        
        req.session.userId = userData.id;
        req.session.username = userData.username;
        req.session.userRole = highestRole.name;
        req.session.userLevel = highestRole.level;
        
        req.session.save((err) => {
            if (err) console.error('❌ Ошибка сохранения сессии:', err);
            else console.log('✅ Сессия сохранена, userId:', req.session.userId);
        });
        
        const result = {
            id: userData.id,
            username: userData.username,
            avatar: userData.avatar,
            displayRole: highestRole.displayName,
            level: highestRole.level
        };
        
        res.send(`<!DOCTYPE html>
        <html>
        <head>
            <title>Авторизация Aurora</title>
            <style>
                body{background:#1a1d24;display:flex;justify-content:center;align-items:center;height:100vh;font-family:system-ui;color:white;margin:0}
                .success-box{text-align:center;background:#20232b;padding:40px;border-radius:24px;border:1px solid #2ecc2e}
                .spinner{width:40px;height:40px;border:3px solid #2ecc2e;border-top-color:transparent;border-radius:50%;animation:spin 0.8s linear infinite;margin:20px auto}
                @keyframes spin{to{transform:rotate(360deg)}}
            </style>
        </head>
        <body>
            <div class="success-box">
                <div class="spinner"></div>
                <div style="color:#2ecc2e;font-size:24px;">✅ Вход выполнен!</div>
                <p>👤 ${userData.username}</p>
                <p>🏷️ Роль: ${highestRole.displayName}</p>
                <p>📊 Уровень: ${highestRole.level}</p>
                <p>🔄 Перенаправление...</p>
            </div>
            <script>
                localStorage.setItem('aurora_user', '${JSON.stringify(result).replace(/'/g, "\\'")}');
                setTimeout(() => { window.location.href = '/'; }, 1500);
            </script>
        </body>
        </html>`);
    } catch (error) {
        console.error('Ошибка авторизации:', error);
        res.status(500).send('Ошибка авторизации');
    }
});

// ============================================
// 🚀 ЗАПУСК
// ============================================
const PORT = process.env.PORT || 3001;

async function start() {
    await initDB();
    
    if (bot && TELEGRAM_BOT_TOKEN) {
        const webhookUrl = `https://aurora-mc.onrender.com/webhook/telegram`;
        try {
            await bot.setWebHook(webhookUrl);
            console.log(`✅ Webhook установлен: ${webhookUrl}`);
        } catch (err) {
            console.error(`❌ Ошибка webhook: ${err.message}`);
        }
    }
    
    app.listen(PORT, () => {
        console.log('='.repeat(50));
        console.log('🚀 Сервер запущен');
        console.log(`📍 http://localhost:${PORT}`);
        console.log('='.repeat(50));
    });
}

start();
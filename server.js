require('dotenv').config();

const express = require('express');
const path = require('path');
const https = require('https');
const session = require('express-session');
const fs = require('fs');

const Rcon = require('rcon');
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

const RCON_HOST = process.env.RCON_HOST;
const RCON_PORT = parseInt(process.env.RCON_PORT) || 25575;
const RCON_PASSWORD = process.env.RCON_PASSWORD;

// Товар
const PRODUCT = {
    name: 'Поддержка сервера 🍪',
    price: 10,
    commands: [
        'lp user {player} parent add sponsor'
    ]
};

// ============================================
// 💾 ХРАНИЛИЩЕ ЗАКАЗОВ (JSON файл)
// ============================================
const DATA_DIR = path.join(__dirname, 'data');
const ORDERS_FILE = path.join(DATA_DIR, 'orders.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

function readOrders() {
    if (!fs.existsSync(ORDERS_FILE)) return [];
    return JSON.parse(fs.readFileSync(ORDERS_FILE));
}

function saveOrders(orders) {
    fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders, null, 2));
}

// ============================================
// 🤖 TELEGRAM БОТ (только уведомления)
// ============================================
let bot = null;
if (TELEGRAM_BOT_TOKEN) {
    bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });
    console.log('🤖 Telegram бот запущен (только уведомления)');
    
    bot.on('polling_error', (err) => {
        console.log('Polling error:', err.code);
    });
}

// ============================================
// 🛡️ RCON ФУНКЦИЯ
// ============================================
function sendRconCommand(playerName, command) {
    return new Promise((resolve, reject) => {
        const rcon = new Rcon(RCON_HOST, RCON_PORT, RCON_PASSWORD);
        rcon.on('auth', () => {
            console.log(`🔑 RCON: ${command.replace('{player}', playerName)}`);
            rcon.send(command.replace('{player}', playerName));
            rcon.disconnect();
            resolve(true);
        });
        rcon.on('error', reject);
        rcon.connect();
    });
}

async function grantSponsor(playerName) {
    for (const cmd of PRODUCT.commands) {
        await sendRconCommand(playerName, cmd);
    }
    console.log(`✅ Привилегии выданы игроку ${playerName}`);
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

// Создание заказа
app.post('/api/create-order', checkAuth, (req, res) => {
    const { playerName } = req.body;
    if (!playerName) return res.status(400).json({ error: 'Укажите ник' });
    
    const orders = readOrders();
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
    saveOrders(orders);
    
    const paymentUrl = `https://yoomoney.ru/quickpay/confirm.xml?receiver=${YOOMONEY_WALLET}&quickpay-form=shop&targets=Покупка+${encodeURIComponent(PRODUCT.name)}+для+${playerName}&sum=${PRODUCT.price}&paymentType=AC&label=${newOrder.id}`;
    
    res.json({ success: true, orderId: newOrder.id, paymentUrl });
});

// Получить заказ по ID (для страницы после оплаты)
app.get('/api/order/:id', (req, res) => {
    const orders = readOrders();
    const order = orders.find(o => o.id === req.params.id);
    if (!order) return res.status(404).json({ error: 'Заказ не найден' });
    res.json(order);
});

// Подтверждение заказа (пользователь нажал "Я оплатил")
app.post('/api/confirm-order', checkAuth, (req, res) => {
    const { orderId } = req.body;
    const orders = readOrders();
    const order = orders.find(o => o.id === orderId);
    
    if (!order) return res.status(404).json({ error: 'Заказ не найден' });
    if (order.userId !== req.session.userId) return res.status(403).json({ error: 'Не ваш заказ' });
    if (order.status !== 'pending') return res.status(400).json({ error: 'Заказ уже обработан' });
    
    order.status = 'awaiting_confirmation';
    saveOrders(orders);
    
    // Уведомление админу в Telegram
    if (bot && ADMIN_CHAT_ID) {
        bot.sendMessage(ADMIN_CHAT_ID,
            `🆕 Новая покупка!\n\n` +
            `👤 Игрок: ${order.playerName}\n` +
            `📦 Товар: ${order.product}\n` +
            `💰 Сумма: ${order.price}₽\n` +
            `🆔 Заказ: ${order.id}\n\n` +
            `Зайдите в админ панель для выдачи привилегии.`
        );
    }
    
    res.json({ success: true });
});

// Отмена заказа (пользователь)
app.post('/api/cancel-order', checkAuth, (req, res) => {
    const { orderId } = req.body;
    const orders = readOrders();
    const order = orders.find(o => o.id === orderId);
    
    if (!order) return res.status(404).json({ error: 'Заказ не найден' });
    if (order.userId !== req.session.userId) return res.status(403).json({ error: 'Не ваш заказ' });
    
    order.status = 'cancelled';
    saveOrders(orders);
    res.json({ success: true });
});

// ============================================
// 👑 АДМИН ПАНЕЛЬ API
// ============================================

// Получить все заказы со статусом awaiting_confirmation
app.get('/api/admin/orders', checkAuth, checkOwner, (req, res) => {
    const orders = readOrders();
    const pendingOrders = orders.filter(o => o.status === 'awaiting_confirmation');
    res.json(pendingOrders);
});

// Получить историю заказов (все выполненные/отменённые)
app.get('/api/admin/history', checkAuth, checkOwner, (req, res) => {
    const orders = readOrders();
    const history = orders.filter(o => o.status === 'completed' || o.status === 'cancelled');
    res.json(history);
});

// Выдать привилегию (админ)
app.post('/api/admin/grant', checkAuth, checkOwner, async (req, res) => {
    const { orderId } = req.body;
    const orders = readOrders();
    const order = orders.find(o => o.id === orderId);
    
    if (!order) return res.status(404).json({ error: 'Заказ не найден' });
    if (order.status !== 'awaiting_confirmation') return res.status(400).json({ error: 'Заказ не ожидает подтверждения' });
    
    try {
        await grantSponsor(order.playerName);
        order.status = 'completed';
        order.completedAt = new Date().toISOString();
        saveOrders(orders);
        
        // Уведомление админу
        if (bot && ADMIN_CHAT_ID) {
            bot.sendMessage(ADMIN_CHAT_ID, `✅ Привилегии выданы игроку ${order.playerName} (заказ #${order.id})`);
        }
        
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Отменить заказ (админ)
app.post('/api/admin/cancel', checkAuth, checkOwner, (req, res) => {
    const { orderId } = req.body;
    const orders = readOrders();
    const order = orders.find(o => o.id === orderId);
    
    if (!order) return res.status(404).json({ error: 'Заказ не найден' });
    if (order.status !== 'awaiting_confirmation') return res.status(400).json({ error: 'Заказ не ожидает подтверждения' });
    
    order.status = 'cancelled';
    saveOrders(orders);
    res.json({ success: true });
});

// ============================================
// 📄 СТРАНИЦЫ
// ============================================
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/payment-status', (req, res) => res.sendFile(path.join(__dirname, 'payment-status.html')));

// Админ панель (с проверкой авторизации и прав владельца)
app.get('/admin', (req, res) => {
    // Проверяем авторизацию
    if (!req.session.userId) {
        return res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Доступ запрещён</title>
                <style>
                    body { background: #1a1d24; display: flex; justify-content: center; align-items: center; height: 100vh; font-family: system-ui; color: white; margin: 0; }
                    .error-box { text-align: center; background: #20232b; padding: 40px; border-radius: 24px; border: 1px solid #ff4444; }
                    .error-box h1 { color: #ff4444; margin-bottom: 20px; }
                    .back-link { color: #2ecc2e; text-decoration: none; margin-top: 20px; display: inline-block; }
                </style>
            </head>
            <body>
                <div class="error-box">
                    <h1>🔒 Доступ запрещён</h1>
                    <p>Вы не авторизованы. Войдите через Discord.</p>
                    <a href="/" class="back-link">← На главную для входа</a>
                </div>
            </body>
            </html>
        `);
    }
    
    // Проверяем, что это владелец
    if (req.session.userId !== OWNER_DISCORD_ID) {
        return res.status(403).send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Доступ запрещён</title>
                <style>
                    body { background: #1a1d24; display: flex; justify-content: center; align-items: center; height: 100vh; font-family: system-ui; color: white; margin: 0; }
                    .error-box { text-align: center; background: #20232b; padding: 40px; border-radius: 24px; border: 1px solid #ff4444; }
                    .error-box h1 { color: #ff4444; margin-bottom: 20px; }
                    .back-link { color: #2ecc2e; text-decoration: none; margin-top: 20px; display: inline-block; }
                </style>
            </head>
            <body>
                <div class="error-box">
                    <h1>⛔ Нет прав</h1>
                    <p>У вас нет доступа к админ панели.</p>
                    <a href="/" class="back-link">← На главную</a>
                </div>
            </body>
            </html>
        `);
    }
    
    // Всё ок — отдаём страницу
    res.sendFile(path.join(__dirname, 'admin.html'));
});

// ============================================
// 🧪 ТЕСТОВЫЙ МАРШРУТ
// ============================================
app.get('/api/test', (req, res) => res.json({ status: 'ok' }));

// ============================================
// 🌐 API ДЛЯ НОВОСТЕЙ, ГОРОДОВ, ДРУЗЕЙ, ФОРУМА
// ============================================
const NEWS_FILE = path.join(DATA_DIR, 'news.json');
const CITIES_FILE = path.join(DATA_DIR, 'cities.json');
const FRIENDS_FILE = path.join(DATA_DIR, 'friends.json');
const FORUM_FILE = path.join(DATA_DIR, 'forum.json');

function initDataFile(file, defaultData) {
    if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify(defaultData, null, 2));
}
function readData(file) { return JSON.parse(fs.readFileSync(file)); }
function writeData(file, data) { fs.writeFileSync(file, JSON.stringify(data, null, 2)); }

initDataFile(NEWS_FILE, []);
initDataFile(CITIES_FILE, []);
initDataFile(FRIENDS_FILE, {});
initDataFile(FORUM_FILE, []);

app.get('/api/news', (req, res) => res.json(readData(NEWS_FILE)));
app.post('/api/news', checkAuth, (req, res) => {
    const { title, content } = req.body;
    const news = readData(NEWS_FILE);
    news.unshift({ id: Date.now(), title, content, authorId: req.session.userId, authorName: req.session.username, createdAt: new Date().toISOString() });
    writeData(NEWS_FILE, news);
    res.json({ success: true });
});
app.delete('/api/news/:id', checkAuth, (req, res) => {
    let news = readData(NEWS_FILE);
    news = news.filter(n => n.id != req.params.id);
    writeData(NEWS_FILE, news);
    res.json({ success: true });
});

app.get('/api/cities', (req, res) => res.json(readData(CITIES_FILE)));
app.post('/api/cities', checkAuth, (req, res) => {
    const { name, description } = req.body;
    const cities = readData(CITIES_FILE);
    cities.push({ id: Date.now(), name, description, ownerId: req.session.userId, ownerName: req.session.username, createdAt: new Date().toISOString() });
    writeData(CITIES_FILE, cities);
    res.json({ success: true });
});
app.delete('/api/cities/:id', checkAuth, (req, res) => {
    let cities = readData(CITIES_FILE);
    cities = cities.filter(c => c.id != req.params.id || c.ownerId !== req.session.userId);
    writeData(CITIES_FILE, cities);
    res.json({ success: true });
});

app.get('/api/friends/data', checkAuth, (req, res) => {
    const data = readData(FRIENDS_FILE);
    res.json(data[req.session.userId] || { friends: [], messages: [] });
});
app.post('/api/friends/add', checkAuth, (req, res) => {
    const { friendId } = req.body;
    const data = readData(FRIENDS_FILE);
    if (!data[req.session.userId]) data[req.session.userId] = { friends: [], messages: [] };
    if (!data[req.session.userId].friends.includes(friendId)) {
        data[req.session.userId].friends.push(friendId);
        if (!data[friendId]) data[friendId] = { friends: [], messages: [] };
        if (!data[friendId].friends.includes(req.session.userId)) data[friendId].friends.push(req.session.userId);
        writeData(FRIENDS_FILE, data);
    }
    res.json({ success: true });
});
app.post('/api/friends/message', checkAuth, (req, res) => {
    const { toId, message } = req.body;
    const data = readData(FRIENDS_FILE);
    const msg = { id: Date.now(), from: req.session.userId, fromName: req.session.username, to: toId, message, timestamp: new Date().toISOString() };
    if (!data[req.session.userId]) data[req.session.userId] = { friends: [], messages: [] };
    data[req.session.userId].messages.push(msg);
    if (!data[toId]) data[toId] = { friends: [], messages: [] };
    data[toId].messages.push(msg);
    writeData(FRIENDS_FILE, data);
    res.json({ success: true });
});

app.get('/api/forum', (req, res) => res.json(readData(FORUM_FILE)));
app.post('/api/forum', checkAuth, (req, res) => {
    const { title, content } = req.body;
    const forum = readData(FORUM_FILE);
    forum.push({ id: Date.now(), title, content, authorId: req.session.userId, authorName: req.session.username, createdAt: new Date().toISOString(), answers: [] });
    writeData(FORUM_FILE, forum);
    res.json({ success: true });
});
app.post('/api/forum/:id/answer', checkAuth, (req, res) => {
    const { content } = req.body;
    const forum = readData(FORUM_FILE);
    const post = forum.find(p => p.id == req.params.id);
    if (post) {
        post.answers.push({ id: Date.now(), authorId: req.session.userId, authorName: req.session.username, content, createdAt: new Date().toISOString() });
        writeData(FORUM_FILE, forum);
        res.json({ success: true });
    } else res.status(404).json({ error: 'Пост не найден' });
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

// ============================================
// 👤 API ПОЛЬЗОВАТЕЛЯ
// ============================================
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

function getHighestRoleById(userRoleIds) {
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
    console.log('🔌 RCON готов');
    console.log(`👑 Владелец ID: ${OWNER_DISCORD_ID || '❌ не указан'}`);
    console.log(`🤖 Telegram бот: ${TELEGRAM_BOT_TOKEN ? '✅' : '❌'}`);
    console.log(`💳 ЮMoney кошелёк: ${YOOMONEY_WALLET ? '✅' : '❌'}`);
});
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
const YOOMONEY_WALLET = process.env.YOOMONEY_WALLET;

const RCON_HOST = process.env.RCON_HOST;
const RCON_PORT = parseInt(process.env.RCON_PORT) || 25575;
const RCON_PASSWORD = process.env.RCON_PASSWORD;

// Товар
const PRODUCT = {
    name: 'Поддержка сервера 🍪',
    price: 10,
    commands: [
        'lp user {player} parent add sponsor',
        'give {player} minecraft:diamond 32'
    ]
};

// Хранилище заказов
const orders = new Map();

// ============================================
// 🤖 TELEGRAM БОТ (webhook mode — без конфликтов)
// ============================================
let bot = null;

if (TELEGRAM_BOT_TOKEN) {
    bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: false });
    console.log('🤖 Telegram бот создан (webhook mode)');
}

// ============================================
// 🛡️ RCON ФУНКЦИЯ
// ============================================
function sendRconCommands(playerName, commands) {
    return new Promise((resolve, reject) => {
        const rcon = new Rcon(RCON_HOST, RCON_PORT, RCON_PASSWORD);
        rcon.on('auth', () => {
            console.log(`🔑 RCON: Выдаём привилегии ${playerName}`);
            let completed = 0;
            commands.forEach(cmd => {
                rcon.send(cmd.replace('{player}', playerName));
                completed++;
                if (completed === commands.length) { rcon.disconnect(); resolve(true); }
            });
        });
        rcon.on('error', reject);
        rcon.connect();
    });
}

// ============================================
// 📋 ID РОЛЕЙ
// ============================================
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

const ROLE_PRIORITY = [
    'SUPREME ADMINISTRATION', 'ADMINISTRATION', 'MODERATION', 'HEAD OF DISCORD',
    'HEAD OF MEDIA', 'COMPOSITION MONITOR', 'COMPOSITION OF AURORA', 'MEDIA',
    'SPONSOR', 'ADVERTISING MANAGER', 'HALLWAY', 'beginner'
];

const ROLE_DISPLAY = {
    'SUPREME ADMINISTRATION': '👑 Supreme Administration',
    'ADMINISTRATION': '⭐ Administration',
    'MODERATION': '🛡️ Moderation',
    'HEAD OF DISCORD': '📢 Head of Discord',
    'HEAD OF MEDIA': '🎬 Head of Media',
    'COMPOSITION MONITOR': '🔍 Composition Monitor',
    'COMPOSITION OF AURORA': '🤝 Composition of Aurora',
    'MEDIA': '📹 Media',
    'SPONSOR': '💎 Sponsor',
    'ADVERTISING MANAGER': '📢 Advertising Manager',
    'HALLWAY': '🚪 Hallway',
    'beginner': '🌱 Beginner'
};

const ROLE_LEVEL = {
    'SUPREME ADMINISTRATION': '👑 Легендарный',
    'ADMINISTRATION': '⭐ Элитный',
    'MODERATION': '🛡️ Продвинутый',
    'HEAD OF DISCORD': '📢 Глава Discord',
    'HEAD OF MEDIA': '🎬 Глава медиа',
    'COMPOSITION MONITOR': '🔍 Следящий',
    'COMPOSITION OF AURORA': '🤝 Команда Aurora',
    'MEDIA': '📹 Медиа-партнер',
    'SPONSOR': '💎 Спонсор',
    'ADVERTISING MANAGER': '📢 Рекламный менеджер',
    'HALLWAY': '🚪 Hallway',
    'beginner': '🌱 Новичок'
};

// ============================================
// 💾 ХРАНИЛИЩЕ ДАННЫХ
// ============================================
const DATA_DIR = path.join(__dirname, 'data');
const NEWS_FILE = path.join(DATA_DIR, 'news.json');
const CITIES_FILE = path.join(DATA_DIR, 'cities.json');
const FRIENDS_FILE = path.join(DATA_DIR, 'friends.json');
const FORUM_FILE = path.join(DATA_DIR, 'forum.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

function initDataFile(file, defaultData) {
    if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify(defaultData, null, 2));
}

initDataFile(NEWS_FILE, []);
initDataFile(CITIES_FILE, []);
initDataFile(FRIENDS_FILE, {});
initDataFile(FORUM_FILE, []);

function readData(file) { return JSON.parse(fs.readFileSync(file)); }
function writeData(file, data) { fs.writeFileSync(file, JSON.stringify(data, null, 2)); }

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

function checkAdmin(req, res, next) {
    if (req.session.userRole === 'SUPREME ADMINISTRATION') return next();
    res.status(403).json({ error: 'Нет прав' });
}

// ============================================
// 🤖 TELEGRAM WEBHOOK МАРШРУТ
// ============================================
app.post('/webhook/telegram', express.json(), (req, res) => {
    if (!bot) return res.status(200).send('OK');
    
    const msg = req.body.message;
    if (!msg) return res.status(200).send('OK');
    
    const chatId = msg.chat.id;
    const text = msg.text || '';
    
    console.log(`📝 Сообщение от ${chatId}: ${text}`);
    
    if (text === '/start') {
        bot.sendMessage(chatId, 
            `🎮 Добро пожаловать в Aurora Shop!\n\n` +
            `💰 Цена: ${PRODUCT.price}₽\n` +
            `🎁 Бонусы:\n` +
            `• Цветной ник на сервере\n` +
            `• Цветной ник в Discord\n` +
            `• Быстрые ответы от модерации\n\n` +
            `🚀 Чтобы купить, отправь команду:\n` +
            `/buy ваш_ник_в_minecraft`
        );
    }
    else if (text.startsWith('/buy')) {
        const playerName = text.replace('/buy', '').trim();
        
        if (!playerName) {
            bot.sendMessage(chatId, '❌ Укажите ник игрока. Пример: /buy Steve');
            return;
        }
        
        const orderId = Date.now().toString();
        orders.set(orderId, {
            chatId,
            playerName,
            status: 'pending',
            createdAt: new Date()
        });
        
        const paymentUrl = `https://yoomoney.ru/quickpay/confirm.xml?receiver=${YOOMONEY_WALLET}&quickpay-form=shop&targets=Покупка+спонсора+для+${playerName}&sum=${PRODUCT.price}&paymentType=AC`;
        
        bot.sendMessage(chatId,
            `💳 Заказ #${orderId}\n` +
            `Для покупки спонсора для игрока *${playerName}*\n\n` +
            `💰 Сумма: ${PRODUCT.price}₽\n\n` +
            `🔗 Ссылка на оплату через ЮMoney:\n` +
            `${paymentUrl}\n\n` +
            `📌 После оплаты отправь команду:\n` +
            `/confirm ${orderId}`,
            { parse_mode: 'Markdown' }
        );
        
        if (ADMIN_CHAT_ID) {
            bot.sendMessage(ADMIN_CHAT_ID, 
                `🆕 Новая заявка #${orderId}\n👤 Игрок: ${playerName}`
            );
        }
    }
    else if (text.startsWith('/confirm')) {
        const orderId = text.replace('/confirm', '').trim();
        const order = orders.get(orderId);
        
        if (!order || order.status !== 'pending') {
            bot.sendMessage(chatId, `❌ Заказ #${orderId} не найден или уже обработан`);
            return;
        }
        
        bot.sendMessage(chatId, `✅ Заявка #${orderId} отправлена на проверку. Ожидайте выдачи привилегий (до 5 минут).`);
        
        if (ADMIN_CHAT_ID) {
            bot.sendMessage(ADMIN_CHAT_ID,
                `💸 Заказ #${orderId} ожидает подтверждения\n` +
                `👤 Игрок: ${order.playerName}\n\n` +
                `Проверьте платёж и выдайте привилегию командой:\n` +
                `/grant ${order.playerName} ${orderId}`
            );
        }
    }
    else if (text.startsWith('/grant') && chatId.toString() === ADMIN_CHAT_ID) {
        const parts = text.split(' ');
        if (parts.length < 3) {
            bot.sendMessage(chatId, `❌ Используйте: /grant игрок номер_заказа`);
            return;
        }
        
        const playerName = parts[1];
        const orderId = parts[2];
        const order = orders.get(orderId);
        
        if (!order) {
            bot.sendMessage(chatId, `❌ Заказ #${orderId} не найден`);
            return;
        }
        
        try {
            await sendRconCommands(playerName, PRODUCT.commands);
            order.status = 'completed';
            orders.set(orderId, order);
            
            bot.sendMessage(order.chatId, 
                `✅ Привилегии для игрока *${playerName}* успешно выданы!\n🎉 Спасибо за поддержку!`,
                { parse_mode: 'Markdown' }
            );
            bot.sendMessage(chatId, `✅ Привилегии выданы ${playerName} (заказ #${orderId})`);
        } catch (error) {
            bot.sendMessage(chatId, `❌ Ошибка: ${error.message}`);
        }
    }
    else if (text.startsWith('/status')) {
        const orderId = text.replace('/status', '').trim();
        const order = orders.get(orderId);
        
        if (!order) {
            bot.sendMessage(chatId, `❌ Заказ #${orderId} не найден`);
        } else {
            bot.sendMessage(chatId, 
                `📊 Статус заказа #${orderId}\n` +
                `👤 Игрок: ${order.playerName}\n` +
                `📌 Статус: ${order.status === 'pending' ? '⏳ Ожидает подтверждения' : '✅ Выполнен'}`
            );
        }
    }
    else if (text === '/help') {
        bot.sendMessage(chatId,
            `📋 Доступные команды:\n\n` +
            `/start - Приветствие\n` +
            `/buy ник - Оформить заказ\n` +
            `/confirm номер - Подтвердить оплату\n` +
            `/status номер - Статус заказа\n` +
            `/help - Справка`
        );
    }
    else {
        bot.sendMessage(chatId, `❓ Неизвестная команда. Используй /help`);
    }
    
    res.status(200).send('OK');
});

// ============================================
// 🌐 API САЙТА
// ============================================
app.post('/api/create-payment', checkAuth, (req, res) => {
    const { playerName } = req.body;
    if (!playerName) return res.status(400).json({ error: 'Укажите ник' });
    
    const botUsername = 'Auroramcp_bot';
    const telegramUrl = `https://t.me/${botUsername}?start=buy_${playerName}`;
    
    res.json({ success: true, paymentUrl: telegramUrl });
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
// 🌐 СТРАНИЦЫ
// ============================================
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/news', checkAuth, (req, res) => res.sendFile(path.join(__dirname, 'views', 'news.html')));
app.get('/cities', checkAuth, (req, res) => res.sendFile(path.join(__dirname, 'views', 'cities.html')));
app.get('/friends', checkAuth, (req, res) => res.sendFile(path.join(__dirname, 'views', 'friends.html')));
app.get('/forum', checkAuth, (req, res) => res.sendFile(path.join(__dirname, 'views', 'forum.html')));

// ============================================
// 📰 API НОВОСТИ
// ============================================
app.get('/api/news', (req, res) => res.json(readData(NEWS_FILE)));
app.post('/api/news', checkAuth, checkAdmin, (req, res) => {
    const { title, content } = req.body;
    const news = readData(NEWS_FILE);
    news.unshift({ id: Date.now(), title, content, authorId: req.session.userId, authorName: req.session.username, createdAt: new Date().toISOString() });
    writeData(NEWS_FILE, news);
    res.json({ success: true });
});
app.delete('/api/news/:id', checkAuth, checkAdmin, (req, res) => {
    let news = readData(NEWS_FILE);
    news = news.filter(n => n.id != req.params.id);
    writeData(NEWS_FILE, news);
    res.json({ success: true });
});

// ============================================
// 🏙️ API ГОРОДА
// ============================================
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

// ============================================
// 👥 API ДРУЗЬЯ
// ============================================
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

// ============================================
// 📝 API ФОРУМ
// ============================================
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
// 🚀 ЗАПУСК И УСТАНОВКА WEBHOOK
// ============================================
const PORT = process.env.PORT || 3001;

app.listen(PORT, async () => {
    console.log('='.repeat(50));
    console.log('🚀 Aurora Server запущен!');
    console.log(`📍 http://localhost:${PORT}`);
    console.log('='.repeat(50));
    console.log('🔌 RCON готов');
    console.log(`🤖 Telegram бот: ${TELEGRAM_BOT_TOKEN ? '✅ создан' : '❌ не найден'}`);
    console.log(`💳 ЮMoney кошелёк: ${YOOMONEY_WALLET ? '✅' : '❌'}`);
    
    // Устанавливаем webhook для Telegram
    if (bot && TELEGRAM_BOT_TOKEN) {
        const webhookUrl = `https://aurora-mc.onrender.com/webhook/telegram`;
        try {
            await bot.setWebHook(webhookUrl);
            console.log(`✅ Webhook установлен: ${webhookUrl}`);
        } catch (err) {
            console.error(`❌ Ошибка webhook: ${err.message}`);
        }
    }
});
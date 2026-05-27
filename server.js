require('dotenv').config();

const express = require('express');
const path = require('path');
const https = require('https');
const session = require('express-session');
const fs = require('fs');

const app = express();

// ============================================
// 🔒 ДАННЫЕ ИЗ ПЕРЕМЕННЫХ ОКРУЖЕНИЯ
// ============================================
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const YOUR_GUILD_ID = process.env.YOUR_GUILD_ID;
const BOT_TOKEN = process.env.BOT_TOKEN;
const REDIRECT_URI = 'https://aurora-mc.onrender.com/auth/callback';

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
// 💾 ХРАНИЛИЩЕ ДАННЫХ (JSON файлы)
// ============================================
const DATA_DIR = path.join(__dirname, 'data');
const NEWS_FILE = path.join(DATA_DIR, 'news.json');
const CITIES_FILE = path.join(DATA_DIR, 'cities.json');
const FRIENDS_FILE = path.join(DATA_DIR, 'friends.json');
const FORUM_FILE = path.join(DATA_DIR, 'forum.json');

if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR);
}

function initDataFile(file, defaultData) {
    if (!fs.existsSync(file)) {
        fs.writeFileSync(file, JSON.stringify(defaultData, null, 2));
    }
}

initDataFile(NEWS_FILE, []);
initDataFile(CITIES_FILE, []);
initDataFile(FRIENDS_FILE, { users: {}, groups: [] });
initDataFile(FORUM_FILE, []);

function readData(file) {
    const data = fs.readFileSync(file);
    return JSON.parse(data);
}

function writeData(file, data) {
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// ============================================
// 🛡️ MIDDLEWARE
// ============================================
app.use(express.json());
app.use(express.static(__dirname));
app.use(session({
    secret: 'aurora-secret-key-2024',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: true,
        httpOnly: true,
        sameSite: 'strict',
        maxAge: 1000 * 60 * 60 * 24
    }
}));

// Middleware для проверки авторизации
function checkAuth(req, res, next) {
    if (req.session.userId) {
        next();
    } else {
        res.status(401).send('Доступ запрещён. Войдите через Discord.');
    }
}

// Middleware для проверки роли Supreme Admin
function checkAdmin(req, res, next) {
    if (req.session.userRole === 'SUPREME ADMINISTRATION') {
        next();
    } else {
        res.status(403).send('Нет прав для этого действия.');
    }
}

// ============================================
// 🌐 СТРАНИЦЫ (с проверкой авторизации)
// ============================================
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/news', checkAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'news.html'));
});

app.get('/cities', checkAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'cities.html'));
});

app.get('/friends', checkAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'friends.html'));
});

app.get('/forum', checkAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'forum.html'));
});

// ============================================
// 📰 API НОВОСТИ
// ============================================
app.get('/api/news', (req, res) => {
    const news = readData(NEWS_FILE);
    res.json(news);
});

app.post('/api/news', checkAuth, checkAdmin, (req, res) => {
    const { title, content } = req.body;
    if (!title || !content) {
        return res.status(400).json({ error: 'Заполните все поля' });
    }
    
    const news = readData(NEWS_FILE);
    const newNews = {
        id: Date.now(),
        title,
        content,
        authorId: req.session.userId,
        authorName: req.session.username,
        createdAt: new Date().toISOString()
    };
    news.unshift(newNews);
    writeData(NEWS_FILE, news);
    res.json({ success: true, news: newNews });
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
app.get('/api/cities', (req, res) => {
    const cities = readData(CITIES_FILE);
    res.json(cities);
});

app.post('/api/cities', checkAuth, (req, res) => {
    const { name, description } = req.body;
    if (!name || !description) {
        return res.status(400).json({ error: 'Заполните все поля' });
    }
    
    const cities = readData(CITIES_FILE);
    const newCity = {
        id: Date.now(),
        name,
        description,
        ownerId: req.session.userId,
        ownerName: req.session.username,
        createdAt: new Date().toISOString()
    };
    cities.push(newCity);
    writeData(CITIES_FILE, cities);
    res.json({ success: true, city: newCity });
});

app.delete('/api/cities/:id', checkAuth, (req, res) => {
    let cities = readData(CITIES_FILE);
    const city = cities.find(c => c.id == req.params.id);
    
    if (!city || city.ownerId !== req.session.userId) {
        return res.status(403).json({ error: 'Нет прав' });
    }
    
    cities = cities.filter(c => c.id != req.params.id);
    writeData(CITIES_FILE, cities);
    res.json({ success: true });
});

// ============================================
// 👥 API ДРУЗЬЯ
// ============================================
app.get('/api/friends/data', checkAuth, (req, res) => {
    const data = readData(FRIENDS_FILE);
    const userFriends = data.users[req.session.userId] || { friends: [], messages: [] };
    const allMessages = userFriends.messages || [];
    
    res.json({
        friends: userFriends.friends || [],
        messages: allMessages,
        groups: data.groups.filter(g => g.members.includes(req.session.userId))
    });
});

app.post('/api/friends/add', checkAuth, (req, res) => {
    const { friendId, friendName } = req.body;
    const userId = req.session.userId;
    
    if (!friendId) return res.status(400).json({ error: 'Укажите ID друга' });
    
    const data = readData(FRIENDS_FILE);
    
    if (!data.users[userId]) {
        data.users[userId] = { friends: [], messages: [] };
    }
    
    if (!data.users[userId].friends.includes(friendId)) {
        data.users[userId].friends.push(friendId);
        
        if (!data.users[friendId]) {
            data.users[friendId] = { friends: [], messages: [] };
        }
        if (!data.users[friendId].friends.includes(userId)) {
            data.users[friendId].friends.push(userId);
        }
        writeData(FRIENDS_FILE, data);
    }
    
    res.json({ success: true });
});

app.post('/api/friends/message', checkAuth, (req, res) => {
    const { toId, message } = req.body;
    const userId = req.session.userId;
    const username = req.session.username;
    
    if (!toId || !message) return res.status(400).json({ error: 'Нет данных' });
    
    const data = readData(FRIENDS_FILE);
    const msg = {
        id: Date.now(),
        from: userId,
        fromName: username,
        to: toId,
        message,
        timestamp: new Date().toISOString()
    };
    
    if (!data.users[userId]) data.users[userId] = { friends: [], messages: [] };
    if (!data.users[userId].messages) data.users[userId].messages = [];
    data.users[userId].messages.push(msg);
    
    if (!data.users[toId]) data.users[toId] = { friends: [], messages: [] };
    if (!data.users[toId].messages) data.users[toId].messages = [];
    data.users[toId].messages.push(msg);
    
    writeData(FRIENDS_FILE, data);
    res.json({ success: true, message: msg });
});

// ============================================
// 📝 API ФОРУМ
// ============================================
app.get('/api/forum', (req, res) => {
    const forum = readData(FORUM_FILE);
    res.json(forum);
});

app.post('/api/forum', checkAuth, (req, res) => {
    const { title, content } = req.body;
    if (!title || !content) {
        return res.status(400).json({ error: 'Заполните все поля' });
    }
    
    const forum = readData(FORUM_FILE);
    const newPost = {
        id: Date.now(),
        title,
        content,
        authorId: req.session.userId,
        authorName: req.session.username,
        createdAt: new Date().toISOString(),
        answers: []
    };
    forum.push(newPost);
    writeData(FORUM_FILE, forum);
    res.json({ success: true, post: newPost });
});

app.post('/api/forum/:id/answer', checkAuth, (req, res) => {
    const { content } = req.body;
    const postId = req.params.id;
    
    if (!content) return res.status(400).json({ error: 'Введите ответ' });
    
    const forum = readData(FORUM_FILE);
    const post = forum.find(p => p.id == postId);
    
    if (post) {
        const answer = {
            id: Date.now(),
            authorId: req.session.userId,
            authorName: req.session.username,
            content,
            createdAt: new Date().toISOString()
        };
        post.answers.push(answer);
        writeData(FORUM_FILE, forum);
        res.json({ success: true, answer });
    } else {
        res.status(404).json({ error: 'Пост не найден' });
    }
});

// ============================================
// 📊 API СТАТУС СЕРВЕРА
// ============================================
app.get('/api/server-status', async (req, res) => {
    try {
        const apiUrl = 'https://api.mcsrvstat.us/2/213.171.18.141:32803';
        const response = await fetch(apiUrl);
        const data = await response.json();
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch server status', online: false, players: { online: 0, max: 99 } });
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
        } catch (error) {
            if (i === retries - 1) throw error;
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }
}

app.get('/auth/discord', (req, res) => {
    const url = `https://discord.com/api/oauth2/authorize?client_id=${DISCORD_CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=identify%20guilds%20guilds.members.read`;
    res.redirect(url);
});

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
        } catch (err) {
            console.log('Не удалось получить роли:', err.message);
        }
        
        const highestRole = getHighestRoleById(userRoleIds);
        
        req.session.userId = userData.id;
        req.session.username = userData.username;
        req.session.userRole = highestRole.name;
        req.session.userLevel = highestRole.level;
        
        const result = {
            id: userData.id,
            username: userData.username,
            avatar: userData.avatar,
            displayRole: highestRole.displayName,
            level: highestRole.level
        };
        
        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Авторизация Aurora</title>
                <style>
                    body {
                        background: #1a1d24;
                        display: flex;
                        justify-content: center;
                        align-items: center;
                        height: 100vh;
                        font-family: system-ui;
                        color: white;
                        margin: 0;
                    }
                    .success-box {
                        text-align: center;
                        background: #20232b;
                        padding: 40px;
                        border-radius: 24px;
                        border: 1px solid #2ecc2e;
                    }
                    .spinner {
                        width: 40px;
                        height: 40px;
                        border: 3px solid #2ecc2e;
                        border-top-color: transparent;
                        border-radius: 50%;
                        animation: spin 0.8s linear infinite;
                        margin: 20px auto;
                    }
                    @keyframes spin {
                        to { transform: rotate(360deg); }
                    }
                </style>
            </head>
            <body>
                <div class="success-box">
                    <div class="spinner"></div>
                    <div style="color:#2ecc2e; font-size:24px;">✅ Вход выполнен!</div>
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
            </html>
        `);
    } catch (error) {
        console.error('Ошибка:', error);
        res.status(500).send('Ошибка авторизации');
    }
});

// ============================================
// 🚀 ЗАПУСК
// ============================================
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log('='.repeat(50));
    console.log('🚀 Aurora Server запущен!');
    console.log(`📍 Порт: ${PORT}`);
    console.log('='.repeat(50));
});
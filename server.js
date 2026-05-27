require('dotenv').config();

const express = require('express');
const path = require('path');
const https = require('https');

const app = express();

// ============================================
// 🔒 ДАННЫЕ ИЗ ПЕРЕМЕННЫХ ОКРУЖЕНИЯ
// ============================================
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const YOUR_GUILD_ID = process.env.YOUR_GUILD_ID;
const BOT_TOKEN = process.env.BOT_TOKEN;  // 👈 ТОКЕН БОТА
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

app.use(express.json());
app.use(express.static(__dirname));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/api/server-status', async (req, res) => {
    try {
        const apiUrl = 'https://api.mcsrvstat.us/2/213.171.18.141:32803';
        const response = await fetch(apiUrl);
        const data = await response.json();
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch server status', online: false, players: { online: 0, max: 50 } });
    }
});

app.get('/auth/discord', (req, res) => {
    const url = `https://discord.com/api/oauth2/authorize?client_id=${DISCORD_CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=identify%20guilds%20guilds.members.read`;
    res.redirect(url);
});

function getHighestRoleById(userRoleIds) {
    for (const roleName of ROLE_PRIORITY) {
        const roleId = ROLE_IDS[roleName];
        if (roleId && userRoleIds.includes(roleId)) {
            return {
                name: roleName,
                displayName: ROLE_DISPLAY[roleName],
                level: ROLE_LEVEL[roleName]
            };
        }
    }
    return {
        name: 'beginner',
        displayName: '🌱 Beginner',
        level: '🌱 Новичок'
    };
}

app.get('/auth/callback', async (req, res) => {
    const { code } = req.query;
    if (!code) return res.status(400).send('Нет кода');
    
    try {
        console.log('1️⃣ Обмен кода на токен...');
        
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
        
        console.log('2️⃣ Получение данных пользователя...');
        const userRes = await fetchWithRetry('https://discord.com/api/users/@me', {
            headers: { Authorization: `Bearer ${accessToken}` }
        });
        const userData = await userRes.json();
        
        console.log(`3️⃣ Пользователь: ${userData.username} (ID: ${userData.id})`);
        
        let userRoleIds = [];
        
        // Используем ТОКЕН БОТА для получения ролей (а не пользовательский токен)
        try {
            console.log('4️⃣ Получение ролей пользователя через БОТА...');
            const memberRes = await fetchWithRetry(`https://discord.com/api/guilds/${YOUR_GUILD_ID}/members/${userData.id}`, {
                headers: { Authorization: `Bot ${BOT_TOKEN}` }  // 👈 ИСПРАВЛЕНО
            });
            const memberData = await memberRes.json();
            userRoleIds = memberData.roles || [];
            console.log('📋 Все ID ролей пользователя:', userRoleIds);
        } catch (err) {
            console.log('⚠️ Не удалось получить роли через бота:', err.message);
        }
        
        const highestRole = getHighestRoleById(userRoleIds);
        console.log(`🏆 Самая высокая роль: ${highestRole.displayName} (${highestRole.level})`);
        
        const result = {
            id: userData.id,
            username: userData.username,
            avatar: userData.avatar,
            displayRole: highestRole.displayName,
            level: highestRole.level,
            allRoleIds: userRoleIds
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
                    .success { color: #2ecc2e; font-size: 24px; }
                </style>
            </head>
            <body>
                <div class="success-box">
                    <div class="spinner"></div>
                    <div class="success">✅ Вход выполнен!</div>
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
        console.error('❌ Ошибка:', error);
        res.status(500).send(`
            <!DOCTYPE html>
            <html>
            <head><title>Ошибка авторизации</title></head>
            <body style="background:#1a1d24; color:white; font-family:system-ui; text-align:center; padding-top:100px;">
                <div style="background:#20232b; padding:40px; border-radius:24px; max-width:500px; margin:0 auto;">
                    <h2 style="color:#ff4444;">❌ Ошибка авторизации</h2>
                    <p>${error.message}</p>
                    <a href="/" style="color:#2ecc2e;">Вернуться на главную</a>
                </div>
            </body>
            </html>
        `);
    }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log('='.repeat(50));
    console.log('🚀 Aurora Server запущен!');
    console.log(`📍 Порт: ${PORT}`);
    console.log('='.repeat(50));
});
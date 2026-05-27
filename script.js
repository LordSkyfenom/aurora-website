// Получение онлайна через свой сервер
async function fetchServerStatus() {
    const playersOnlineElement = document.getElementById('playersOnline');
    const activeCountSpan = document.getElementById('activeCount');

    if (playersOnlineElement) playersOnlineElement.textContent = '...';
    if (activeCountSpan) activeCountSpan.textContent = '...';

    try {
        const response = await fetch('/api/server-status');
        const data = await response.json();

        if (data.online === true && data.players && typeof data.players.online === 'number') {
            const online = data.players.online;
            const max = data.players.max || 50;
            if (playersOnlineElement) playersOnlineElement.textContent = `${online}/${max}`;
            if (activeCountSpan) activeCountSpan.textContent = online;
        } else {
            if (playersOnlineElement) playersOnlineElement.textContent = '0/50';
            if (activeCountSpan) activeCountSpan.textContent = '0';
        }
    } catch (error) {
        console.error('Ошибка получения статуса:', error);
        if (playersOnlineElement) playersOnlineElement.textContent = '0/50';
        if (activeCountSpan) activeCountSpan.textContent = '0';
    }
}

// Discord авторизация
function checkAuth() {
    const userData = localStorage.getItem('aurora_user');
    if (userData) {
        try {
            const user = JSON.parse(userData);
            updateUIWithUser(user);
            return true;
        } catch(e) { console.error("Ошибка парсинга userData", e); }
    }
    return false;
}

function updateUIWithUser(user) {
    const levelSpan = document.getElementById('level');
    if(levelSpan) levelSpan.textContent = user.level;
    const userNameSpan = document.getElementById('userName');
    if(userNameSpan) userNameSpan.textContent = user.username;
    const userRoleSpan = document.getElementById('userRole');
    if(userRoleSpan) userRoleSpan.textContent = user.displayRole;
    const userLevelSpan = document.getElementById('userLevel');
    if(userLevelSpan) userLevelSpan.textContent = user.level;
    
    const avatarUrl = user.avatar 
        ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`
        : 'https://cdn.discordapp.com/embed/avatars/0.png';
    const userAvatarDiv = document.getElementById('userAvatar');
    if(userAvatarDiv) userAvatarDiv.innerHTML = `<img src="${avatarUrl}" alt="avatar">`;
    
    const unauthDiv = document.getElementById('unauthContent');
    const authDiv = document.getElementById('authContent');
    if(unauthDiv) unauthDiv.style.display = 'none';
    if(authDiv) authDiv.style.display = 'block';
}

function logout() {
    localStorage.removeItem('aurora_user');
    const levelSpan = document.getElementById('level');
    if(levelSpan) levelSpan.textContent = '🌱 Новичок';
    const unauthDiv = document.getElementById('unauthContent');
    const authDiv = document.getElementById('authContent');
    if(unauthDiv) unauthDiv.style.display = 'block';
    if(authDiv) authDiv.style.display = 'none';
    const profileModal = document.getElementById('profileModal');
    if(profileModal) profileModal.style.display = 'none';
}

function loginWithDiscord() {
    window.location.href = '/auth/discord';
}

// Модальные окна
const infoModal = document.getElementById('infoModal');
const closeInfoBtn = document.getElementById('closeInfoModal');
const modalContent = document.getElementById('modalContent');
function openModal(content) {
    if(modalContent) modalContent.innerHTML = content;
    if(infoModal) infoModal.style.display = 'flex';
}
if(closeInfoBtn) closeInfoBtn.onclick = () => { if(infoModal) infoModal.style.display = 'none'; };

// Обработчики для ссылок в подвале
const termsLink = document.getElementById('termsLink');
if(termsLink) termsLink.onclick = (e) => { e.preventDefault(); openModal('<h3>📄 Пользовательское соглашение</h3><p>Текст соглашения...</p>'); };
const privacyLink = document.getElementById('privacyLink');
if(privacyLink) privacyLink.onclick = (e) => { e.preventDefault(); openModal('<h3>🔒 Политика конфиденциальности</h3><p>Текст политики...</p>'); };
const faqLink = document.getElementById('faqLink');
if(faqLink) faqLink.onclick = (e) => { e.preventDefault(); openModal('<h3>❓ FAQ</h3><p>Часто задаваемые вопросы...</p>'); };
const supportLink = document.getElementById('supportLink');
if(supportLink) supportLink.onclick = (e) => { e.preventDefault(); openModal('<h3>🛠️ Техподдержка</h3><p>Discord: ss_vindicator_ss</p>'); };

// Профиль модалка
const profileModal = document.getElementById('profileModal');
const profileBtn = document.getElementById('profileBtn');
const closeProfileBtn = document.getElementById('closeProfileModal');
if(profileBtn) profileBtn.onclick = () => { if(profileModal) profileModal.style.display = 'flex'; };
if(closeProfileBtn) closeProfileBtn.onclick = () => { if(profileModal) profileModal.style.display = 'none'; };
window.onclick = (event) => {
    if (event.target === infoModal && infoModal) infoModal.style.display = 'none';
    if (event.target === profileModal && profileModal) profileModal.style.display = 'none';
};

document.addEventListener('DOMContentLoaded', () => {
    const loginBtn = document.getElementById('discordLoginBtn');
    const logoutBtn = document.getElementById('logoutBtn');
    if(loginBtn) loginBtn.onclick = loginWithDiscord;
    if(logoutBtn) logoutBtn.onclick = logout;
    checkAuth();
    fetchServerStatus();
    setInterval(fetchServerStatus, 30000);
});

// Плавная прокрутка
document.querySelectorAll('.nav-link, .sponsor-btn').forEach(anchor => {
    anchor.addEventListener('click', function(e) {
        const href = this.getAttribute('href');
        if (href && href.startsWith('#')) {
            e.preventDefault();
            const target = document.querySelector(href);
            if (target) target.scrollIntoView({ behavior: 'smooth' });
        }
    });
});
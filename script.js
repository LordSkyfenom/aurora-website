// ============================================
// AURORA SITE - MAIN SCRIPT
// ============================================

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
            const max = data.players.max || 99;
            if (playersOnlineElement) playersOnlineElement.textContent = `${online}/${max}`;
            if (activeCountSpan) activeCountSpan.textContent = online;
        } else {
            if (playersOnlineElement) playersOnlineElement.textContent = '0/99';
            if (activeCountSpan) activeCountSpan.textContent = '0';
        }
    } catch (error) {
        console.error('Ошибка получения статуса:', error);
        if (playersOnlineElement) playersOnlineElement.textContent = '0/99';
        if (activeCountSpan) activeCountSpan.textContent = '0';
    }
}

// ============================================
// ПОКУПКА СПОНСОРА (СОЗДАНИЕ ЗАКАЗА)
// ============================================
async function buyProduct() {
    const playerName = document.getElementById('playerName').value;
    if (!playerName) {
        alert('Введите ваш ник в Minecraft');
        return;
    }
    
    const res = await fetch('/api/create-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerName })
    });
    const data = await res.json();
    
    if (data.success) {
        // Открываем оплату в новой вкладке
        window.open(data.paymentUrl, '_blank');
        // Перенаправляем на страницу статуса заказа
        window.location.href = `/payment-status?orderId=${data.orderId}`;
    } else {
        alert('❌ Ошибка создания заказа: ' + (data.error || 'Неизвестная ошибка'));
    }
}

// ============================================
// DISCORD АВТОРИЗАЦИЯ
// ============================================
function checkAuth() {
    const userData = localStorage.getItem('aurora_user');
    if (userData) {
        try {
            const user = JSON.parse(userData);
            updateUIWithUser(user);
            return true;
        } catch(e) { 
            console.error("Ошибка парсинга userData", e); 
        }
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

// ============================================
// МОДАЛЬНЫЕ ОКНА (НОВОСТИ, FAQ И Т.Д.)
// ============================================
const infoModal = document.getElementById('infoModal');
const closeInfoBtn = document.getElementById('closeInfoModal');
const modalContent = document.getElementById('modalContent');

function openModal(content) {
    if(modalContent) modalContent.innerHTML = content;
    if(infoModal) infoModal.style.display = 'flex';
}

if(closeInfoBtn) {
    closeInfoBtn.onclick = () => { 
        if(infoModal) infoModal.style.display = 'none'; 
    };
}

// Пользовательское соглашение
const termsLink = document.getElementById('termsLink');
if(termsLink) {
    termsLink.onclick = (e) => { 
        e.preventDefault(); 
        openModal(`<h3>📄 Пользовательское соглашение</h3>
            <p><strong>1. Общие положения</strong><br>1.1. Используя сервер Aurora, вы соглашаетесь с данными условиями.<br>1.2. Администрация оставляет за собой право изменять правила без предупреждения.</p>
            <p><strong>2. Аккаунт</strong><br>2.1. Вы несёте ответственность за действия на своём аккаунте.<br>2.2. Запрещена передача аккаунта третьим лицам.</p>
            <p><strong>3. Финансовые операции</strong><br>3.1. Все покупки на сервере являются добровольными.<br>3.2. Возврат средств осуществляется только в исключительных случаях.</p>
            <p><strong>4. Ответственность</strong><br>4.1. Администрация не несёт ответственности за потерю игровых предметов.<br>4.2. За нарушение правил предусмотрены наказания от предупреждения до бана.</p>
            <p><strong>5. Конфиденциальность</strong><br>5.1. Мы собираем только необходимые данные (IP, Discord ID).<br>5.2. Ваши данные не передаются третьим лицам.</p>
            <p><em>Последнее обновление: ${new Date().toLocaleDateString()}</em></p>`);
    };
}

// Политика конфиденциальности
const privacyLink = document.getElementById('privacyLink');
if(privacyLink) {
    privacyLink.onclick = (e) => { 
        e.preventDefault(); 
        openModal(`<h3>🔒 Политика конфиденциальности</h3>
            <p><strong>1. Какие данные мы собираем</strong><br>• Discord ID и имя пользователя<br>• IP адрес<br>• Роли на сервере Discord<br>• Игровая статистика</p>
            <p><strong>2. Как мы используем данные</strong><br>• Для авторизации на сайте<br>• Для определения уровня и ролей<br>• Для улучшения качества услуг</p>
            <p><strong>3. Хранение данных</strong><br>• Данные хранятся в зашифрованном виде<br>• Вы можете запросить удаление своих данных</p>
            <p><strong>4. Защита данных</strong><br>• Мы используем современные методы шифрования<br>• Доступ к данным имеют только администраторы</p>
            <p><strong>5. Контакты</strong><br>По вопросам конфиденциальности: <strong>ss_vindicator_ss</strong> в Discord</p>`);
    };
}

// FAQ
const faqLink = document.getElementById('faqLink');
if(faqLink) {
    faqLink.onclick = (e) => { 
        e.preventDefault(); 
        openModal(`<h3>❓ Часто задаваемые вопросы</h3>
            <p><strong>❓ Как зайти на сервер?</strong><br>IP адрес: <strong>aurorabeta.wellduck.org</strong><br>Версия Minecraft: 1.21.11</p>
            <p><strong>❓ Как получить роль на сервере?</strong><br>После входа через Discord ваша роль определяется автоматически на основе ролей в Discord.</p>
            <p><strong>❓ Что такое войс чат?</strong><br>Это мод Simple Voice Chat, позволяющий общаться с игроками в голосовом режиме в игре.</p>
            <p><strong>❓ Как стать спонсором?</strong><br>Свяжитесь с <strong>ss_vindicator_ss</strong> в Discord для получения информации.</p>
            <p><strong>❓ Что делать при нарушении правил?</strong><br>Обратитесь в техподдержку к <strong>ss_vindicator_ss</strong> с доказательствами.</p>
            <p><strong>❓ Будет ли вайп?</strong><br>Нет, сервер приватный и ванильный — вайпов не планируется.</p>`);
    };
}

// Техподдержка
const supportLink = document.getElementById('supportLink');
if(supportLink) {
    supportLink.onclick = (e) => { 
        e.preventDefault(); 
        openModal(`<h3>🛠️ Техподдержка</h3>
            <p>По всем вопросам обращайтесь:</p>
            <p><strong>📩 Discord:</strong> <span style="color:#2ecc2e;">ss_vindicator_ss</span></p>
            <p style="margin-top: 20px;">Мы отвечаем в течение 24 часов.<br>По срочным вопросам пишите в Discord.</p>`);
    };
}

// ============================================
// ПРОФИЛЬ МОДАЛЬНОЕ ОКНО
// ============================================
const profileModal = document.getElementById('profileModal');
const profileBtn = document.getElementById('profileBtn');
const closeProfileBtn = document.getElementById('closeProfileModal');

if(profileBtn) {
    profileBtn.onclick = () => { 
        if(profileModal) profileModal.style.display = 'flex'; 
    };
}

if(closeProfileBtn) {
    closeProfileBtn.onclick = () => { 
        if(profileModal) profileModal.style.display = 'none'; 
    };
}

// Закрытие модалок при клике вне
window.onclick = (event) => {
    if (event.target === infoModal && infoModal) infoModal.style.display = 'none';
    if (event.target === profileModal && profileModal) profileModal.style.display = 'none';
};

// ============================================
// ИНИЦИАЛИЗАЦИЯ
// ============================================
document.addEventListener('DOMContentLoaded', () => {
    const loginBtn = document.getElementById('discordLoginBtn');
    const logoutBtn = document.getElementById('logoutBtn');
    
    if(loginBtn) loginBtn.onclick = loginWithDiscord;
    if(logoutBtn) logoutBtn.onclick = logout;
    
    checkAuth();
    fetchServerStatus();
    setInterval(fetchServerStatus, 30000);
});

// ============================================
// ПЛАВНАЯ ПРОКРУТКА
// ============================================
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
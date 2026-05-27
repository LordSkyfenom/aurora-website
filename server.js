if (order.chatId) {
    await bot.sendMessage(order.chatId, `✅ Привилегии выданы!`);
    console.log(`✅ Сообщение отправлено в ${order.chatId}`);
} else {
    console.log(`❌ Нет chatId для заказа ${orderId}`);
}
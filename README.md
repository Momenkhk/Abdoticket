# AbdoTicket Pro (Node.js)

بوت تذاكر احترافي بالعربي، قريب من بوتات التذاكر الكبيرة، مع Dashboard ويب ونظام أمان وإدارة متكامل.

## المميزات

### Ticket System
- بنل التذاكر **Select Menu فقط** (بدون أزرار فتح).
- أقسام متعددة: `support`, `report`, `purchase`, `help`.
- كل قسم يفتح روم خاص مع صلاحيات مخصصة للعضو وفريق الدعم.
- منع التكرار لنفس النوع + حد أقصى للتذاكر المفتوحة لكل عضو.
- حماية Spam عبر Cooldown بين فتح التذاكر.
- Claim system لفريق الدعم.
- Close / Delete / Reopen عبر أزرار داخل التذكرة.
- Rename للتذكرة.
- Auto rename بصيغة: `ticket-type-0001`.
- Transcript بصيغة **HTML** ويتم إرساله تلقائياً لقنوات الترانسكربت.
- Rating system بعد الإغلاق.
- Auto close للتذاكر غير النشطة.

### Management
- Staff roles system + Admin صلاحيات.
- Blacklist للمستخدمين.
- Logs system كامل.
- Ticket priority لكل قسم.
- Ticket statistics (created/closed/deleted/claimed/rating avg).

### Dashboard (Web)
- Dashboard حديثة وسريعة عبر Express.
- الدخول فقط بالـ `ownerId` + `ownerSecret`.
- تفعيل/تعطيل النظام.
- تعديل أولوية الأقسام.
- عرض إحصائيات مباشرة.

## التثبيت

```bash
npm install
```

## الإعداد

عدّل `config.json`:

```json
{
  "token": "PUT_BOT_TOKEN_HERE",
  "clientId": "PUT_CLIENT_ID_HERE",
  "guildId": "PUT_GUILD_ID_HERE",
  "prefix": "$",
  "ownerId": "PUT_OWNER_DISCORD_ID_HERE",
  "ownerSecret": "CHANGE_THIS_SECRET",
  "dashboardPort": 3000,
  "staffMention": "<@873442377396797510>",
  "supportRoleIds": ["PUT_SUPPORT_ROLE_ID_HERE"],
  "maxOpenTicketsPerUser": 1,
  "ticketCooldownSeconds": 20,
  "inactiveCloseMinutes": 120
}
```

## التشغيل

```bash
npm start
```

## أوامر السلاش

### `/ticket setup`
تهيئة القنوات (categories + transcript channels + logs).

### `/ticket panel`
إرسال بنل التذاكر في قناة محددة (Select Menu).

### `/ticket add`
إضافة عضو للتذكرة الحالية.

### `/ticket close`
قفل التذكرة الحالية.

### `/ticket delete`
حذف التذكرة الحالية.

### `/ticket rename`
تغيير اسم التذكرة.

### `/ticket blacklist`
إضافة/حذف مستخدم من القائمة السوداء.

## أوامر Prefix المدعومة
- `$on` / `$off`
- `$ticket remove @user`
- `$ticket close`
- `$ticket delete`
- `$ticket rename new-name`
- `$ticket blacklist add @user`
- `$ticket blacklist remove @user`

## رابط Dashboard

بعد التشغيل:

`http://SERVER_IP:3000/?owner=OWNER_ID&key=OWNER_SECRET`

## التخزين
- كل البيانات محفوظة بصيغة JSON داخل `data.json`.

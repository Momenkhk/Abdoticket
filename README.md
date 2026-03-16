# AbdoTicket Bot (Node.js)

بوت تذاكر ديسكورد متطور باللغة العربية.

## المميزات

- `/set-panel` لإنشاء البنل الرئيسي (عنوان + محتوى + صورة اختيارية) مع أزرار وسلكت منيو.
- `/ticket` لإنشاء بنل مخصص لنوع تذكرة واحد.
- أنواع التذاكر: شحن ألعاب / خدمات أخرى / شكوى-استفسار.
- `Refresh` لمعرفة التذكرة المفتوحة للمستخدم.
- `$on` و `$off` للتحكم في استقبال التذاكر داخل قناة البنل.
- `$close` داخل روم التذكرة (للأدمن) لقفلها وإخفائها عن العميل.
- بعد `$close` يرسل البوت رسالة فيها أن التذكرة أغلقت + زرين `Delete` و `Transcript`.
- `$transcript` داخل التذكرة لإرسال transcript إلى الروم المحددة من الإعداد.
- `$close all` لقفل كل التذاكر المفتوحة.
- `$transcript all` لإرسال transcript لكل التذاكر المقفولة.
- تسمية التذاكر بشكل منظم مثل: `ticket-game-0001` و `ticket-support-0001` مع عدّاد مستقل لكل نوع.
- دعم إعطاء صلاحيات التذاكر تلقائيًا لرتب فريق الدعم عبر `supportRoleIds`.
- أوامر الإدارة والسلاش أصبحت متاحة للأدمن أو رتب الدعم الموجودة في `supportRoleIds`.
- تحسينات استقرار: معالجة أخطاء داخلية بدون توقف البوت عند أي استثناء.

## التثبيت

```bash
npm install
```

## الإعداد (بدون .env)

عدّل ملف `config.json`:

```json
{
  "token": "PUT_BOT_TOKEN_HERE",
  "clientId": "PUT_CLIENT_ID_HERE",
  "guildId": "PUT_GUILD_ID_HERE",
  "prefix": "$",
  "staffMention": "<@873442377396797510>",
  "supportRoleIds": [
    "PUT_SUPPORT_ROLE_ID_HERE"
  ]
}
```

> `supportRoleIds` اختيارية لكن يفضل استخدامها ليظهر البوت بشكل احترافي مثل بوتات التذاكر الكبيرة.
> لازم تكون IDs صحيحة (أرقام فقط) لأي رول دعم.

## التشغيل

```bash
npm start
```

## أوامر السلاش

### `/set-panel`
الباراميترات:
- `title`
- `content`
- `category_game`
- `category_other`
- `category_support`
- `transcript_game` (روم ترانسكربت شحن العاب)
- `transcript_other` (روم ترانسكربت خدمات أخرى)
- `transcript_support` (روم ترانسكربت شكوى)

اختياري:
- `image_url`
- `channel`

### `/ticket`
- `type`: `game` / `other` / `support`
- `title`
- `content`

اختياري:
- `image_url`
- `category_id` (تعديل كاتيجوري النوع)
- `transcript_channel` (تعديل روم transcript لهذا النوع)
- `channel`

## أوامر الكتابة

- `$on`
- `$off`
- `$close`
- `$transcript`
- `$close all`
- `$transcript all`

## ملاحظات

- يتم حفظ الحالة محليًا في `data.json`.
- transcript يتم إرساله كملف `.txt`.
- يتم حفظ عدّادات التذاكر لكل نوع داخل `data.json` (لا تتصفر إلا إذا حذفت الملف).

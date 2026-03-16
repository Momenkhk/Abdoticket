const fs = require('fs');
const path = require('path');
const express = require('express');
const {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  PermissionsBitField,
  REST,
  Routes,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
} = require('discord.js');

const configPath = path.join(__dirname, 'config.json');
if (!fs.existsSync(configPath)) {
  console.error('Missing config.json.');
  process.exit(1);
}

const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const {
  token: TOKEN,
  clientId: CLIENT_ID,
  guildId: GUILD_ID,
  prefix: PREFIX = '$',
  ownerId = '',
  ownerSecret = 'change-me',
  dashboardPort = 3000,
  staffMention = '<@873442377396797510>',
  supportRoleIds = [],
  maxOpenTicketsPerUser = 1,
  ticketCooldownSeconds = 20,
  inactiveCloseMinutes = 120,
} = config;

if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
  console.error('config.json must include token, clientId, guildId.');
  process.exit(1);
}

function isSnowflake(value) {
  return typeof value === 'string' && /^\d{16,20}$/.test(value);
}

const staffRoles = Array.isArray(supportRoleIds) ? supportRoleIds.filter(isSnowflake) : [];

const dataPath = path.join(__dirname, 'data.json');
const defaultData = {
  panel: {
    title: 'Order Now | اشـتـري الآن',
    content:
      '**عزيزي العميل**\nلأختيار خدمة شحن الالعاب برجاء الضغط علي القائمة.\nولأختيار اي خدمة اخري من الخدمات المتوفرة اختر من القائمة.\nولفتح تذكرة شكوة او استفسار اختر القسم المناسب.',
    imageUrl: null,
    channelId: null,
  },
  enabled: true,
  categories: {
    support: { label: 'دعم فني', emoji: '🛟', categoryId: null, transcriptChannelId: null, priority: 'high' },
    report: { label: 'شكوى / بلاغ', emoji: '📩', categoryId: null, transcriptChannelId: null, priority: 'urgent' },
    purchase: { label: 'شراء / طلب', emoji: '🛒', categoryId: null, transcriptChannelId: null, priority: 'normal' },
    help: { label: 'مساعدة عامة', emoji: '🧠', categoryId: null, transcriptChannelId: null, priority: 'normal' },
  },
  ticketCounters: { support: 0, report: 0, purchase: 0, help: 0 },
  tickets: {},
  blacklist: [],
  logsChannelId: null,
  stats: {
    created: 0,
    closed: 0,
    deleted: 0,
    transcripts: 0,
    claimed: 0,
    reopened: 0,
    ratingsCount: 0,
    ratingsSum: 0,
  },
};

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function loadData() {
  if (!fs.existsSync(dataPath)) {
    fs.writeFileSync(dataPath, JSON.stringify(defaultData, null, 2), 'utf8');
    return clone(defaultData);
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
    return {
      ...clone(defaultData),
      ...parsed,
      panel: { ...clone(defaultData.panel), ...(parsed.panel || {}) },
      categories: { ...clone(defaultData.categories), ...(parsed.categories || {}) },
      ticketCounters: { ...clone(defaultData.ticketCounters), ...(parsed.ticketCounters || {}) },
      stats: { ...clone(defaultData.stats), ...(parsed.stats || {}) },
      tickets: parsed.tickets || {},
      blacklist: Array.isArray(parsed.blacklist) ? parsed.blacklist : [],
    };
  } catch {
    return clone(defaultData);
  }
}

let store = loadData();
function saveData() {
  fs.writeFileSync(dataPath, JSON.stringify(store, null, 2), 'utf8');
}

const commands = [
  new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('إدارة نظام التذاكر')
    .addSubcommand((s) =>
      s
        .setName('setup')
        .setDescription('إعداد القنوات الأساسية')
        .addChannelOption((o) => o.setName('logs_channel').setDescription('قناة اللوجات').setRequired(true).addChannelTypes(ChannelType.GuildText))
        .addStringOption((o) => o.setName('support_category').setDescription('ID كاتيجوري الدعم').setRequired(true))
        .addStringOption((o) => o.setName('report_category').setDescription('ID كاتيجوري البلاغات').setRequired(true))
        .addStringOption((o) => o.setName('purchase_category').setDescription('ID كاتيجوري الشراء').setRequired(true))
        .addStringOption((o) => o.setName('help_category').setDescription('ID كاتيجوري المساعدة').setRequired(true))
        .addChannelOption((o) => o.setName('support_transcript').setDescription('قناة Transcript الدعم').setRequired(true).addChannelTypes(ChannelType.GuildText))
        .addChannelOption((o) => o.setName('report_transcript').setDescription('قناة Transcript البلاغات').setRequired(true).addChannelTypes(ChannelType.GuildText))
        .addChannelOption((o) => o.setName('purchase_transcript').setDescription('قناة Transcript الشراء').setRequired(true).addChannelTypes(ChannelType.GuildText))
        .addChannelOption((o) => o.setName('help_transcript').setDescription('قناة Transcript المساعدة').setRequired(true).addChannelTypes(ChannelType.GuildText))
    )
    .addSubcommand((s) =>
      s
        .setName('panel')
        .setDescription('إرسال بنل التذاكر (Select Menu فقط)')
        .addStringOption((o) => o.setName('title').setDescription('عنوان البنل').setRequired(true))
        .addStringOption((o) => o.setName('content').setDescription('محتوى البنل').setRequired(true))
        .addChannelOption((o) => o.setName('channel').setDescription('قناة البنل').setRequired(true).addChannelTypes(ChannelType.GuildText))
        .addStringOption((o) => o.setName('image_url').setDescription('رابط صورة (اختياري)'))
    )
    .addSubcommand((s) =>
      s
        .setName('add')
        .setDescription('إضافة عضو للتذكرة الحالية')
        .addUserOption((o) => o.setName('user').setDescription('العضو').setRequired(true))
    )
    .addSubcommand((s) =>
      s
        .setName('close')
        .setDescription('قفل التذكرة الحالية')
    )
    .addSubcommand((s) =>
      s
        .setName('delete')
        .setDescription('حذف التذكرة الحالية')
    )
    .addSubcommand((s) =>
      s
        .setName('rename')
        .setDescription('إعادة تسمية التذكرة الحالية')
        .addStringOption((o) => o.setName('name').setDescription('الاسم الجديد').setRequired(true))
    )
    .addSubcommand((s) =>
      s
        .setName('blacklist')
        .setDescription('إدارة البلاك ليست')
        .addStringOption((o) =>
          o.setName('action').setDescription('نوع العملية').setRequired(true).addChoices({ name: 'إضافة', value: 'add' }, { name: 'حذف', value: 'remove' })
        )
        .addUserOption((o) => o.setName('user').setDescription('المستخدم').setRequired(true))
    ),
].map((c) => c.toJSON());

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(TOKEN);
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
}

function isAdmin(member) {
  return member.permissions.has(PermissionsBitField.Flags.Administrator);
}

function isStaff(member) {
  if (isAdmin(member)) return true;
  return staffRoles.some((roleId) => member.roles.cache.has(roleId));
}

function categoryConfig(type) {
  return store.categories[type] || null;
}

function ticketByChannel(channelId) {
  return store.tickets[channelId] || null;
}

function countOpenForUser(guildId, userId) {
  return Object.values(store.tickets).filter((t) => t.guildId === guildId && t.userId === userId && t.status !== 'deleted').length;
}

function nextTicketNo(type) {
  store.ticketCounters[type] = (store.ticketCounters[type] || 0) + 1;
  saveData();
  return store.ticketCounters[type];
}

function buildPanelEmbed() {
  const embed = new EmbedBuilder().setColor(0x5865f2).setTitle(store.panel.title).setDescription(store.panel.content).setFooter({ text: 'AbdoTicket • نظام تذاكر احترافي' });
  if (store.panel.imageUrl) embed.setImage(store.panel.imageUrl);
  return embed;
}

function buildPanelMenu() {
  const options = Object.entries(store.categories).map(([key, c]) => ({
    label: c.label,
    value: `open_${key}`,
    description: `فتح تذكرة ${c.label}`,
    emoji: c.emoji || '🎫',
  }));
  options.push({ label: 'تحديث', value: 'refresh_tickets', description: 'عرض تذكرتك الحالية', emoji: '🔄' });
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder().setCustomId('ticket_open_menu').setPlaceholder('اختر نوع التذكرة').addOptions(options)
  );
}

function buildTicketControlButtons(status = 'open') {
  if (status === 'closed') {
    return [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('ticket_reopen_btn').setLabel('إعادة فتح').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('ticket_delete_btn').setLabel('حذف').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('ticket_transcript_btn').setLabel('Transcript HTML').setStyle(ButtonStyle.Primary)
      ),
    ];
  }

  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('ticket_claim_btn').setLabel('Claim').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('ticket_close_btn').setLabel('Close').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('ticket_transcript_btn').setLabel('Transcript HTML').setStyle(ButtonStyle.Success)
    ),
  ];
}

async function sendLog(guild, content) {
  if (!store.logsChannelId) return;
  const ch = guild.channels.cache.get(store.logsChannelId);
  if (!ch || ch.type !== ChannelType.GuildText) return;
  await ch.send(content).catch(() => null);
}

function sanitize(str) {
  return String(str || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

async function fetchMessages(channel) {
  const out = [];
  let before;
  while (true) {
    const batch = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
    if (!batch.size) break;
    out.push(...batch.values());
    before = batch.last().id;
    if (batch.size < 100) break;
  }
  return out.reverse();
}

async function makeTranscriptHtml(channel, ticket) {
  const msgs = await fetchMessages(channel);
  const rows = msgs
    .map((m) => {
      const attachments = m.attachments.map((a) => `<a href="${sanitize(a.url)}" target="_blank">Attachment</a>`).join(' ');
      return `<div class="msg"><span class="date">${new Date(m.createdTimestamp).toLocaleString()}</span><b>${sanitize(m.author.tag)}</b><p>${sanitize(m.content || '[empty]')}</p>${attachments}</div>`;
    })
    .join('\n');

  return `<!doctype html><html lang="ar"><head><meta charset="utf-8"><title>Transcript ${sanitize(channel.name)}</title><style>body{font-family:Arial;background:#0f172a;color:#e2e8f0;padding:20px}.card{background:#1e293b;padding:16px;border-radius:10px}.msg{border-bottom:1px solid #334155;padding:10px 0}.date{color:#94a3b8;margin-right:8px}a{color:#38bdf8}</style></head><body><div class="card"><h2>Transcript - ${sanitize(channel.name)}</h2><p>Type: ${sanitize(ticket.type)} | User: ${sanitize(ticket.userId)}</p>${rows}</div></body></html>`;
}

async function sendTranscript(channel, ticket) {
  const cfg = categoryConfig(ticket.type);
  if (!cfg?.transcriptChannelId) return { ok: false, message: 'قناة الترانسكربت غير محددة.' };
  const target = channel.guild.channels.cache.get(cfg.transcriptChannelId);
  if (!target || target.type !== ChannelType.GuildText) return { ok: false, message: 'قناة الترانسكربت غير صالحة.' };

  const html = await makeTranscriptHtml(channel, ticket);
  const file = new AttachmentBuilder(Buffer.from(html, 'utf8'), { name: `transcript-${channel.name}.html` });
  await target.send({ content: `📄 Transcript | <#${channel.id}>`, files: [file] });
  store.stats.transcripts += 1;
  saveData();
  return { ok: true, message: `تم إرسال الترانسكربت إلى ${target}.` };
}

async function closeTicket(channel, byUserId) {
  const ticket = ticketByChannel(channel.id);
  if (!ticket || ticket.status === 'closed' || ticket.status === 'deleted') return { ok: false, message: 'هذه ليست تذكرة مفتوحة.' };

  await channel.permissionOverwrites.edit(ticket.userId, { ViewChannel: false, SendMessages: false }).catch(() => null);
  ticket.status = 'closed';
  ticket.closedAt = Date.now();
  ticket.closedBy = byUserId;
  saveData();
  store.stats.closed += 1;

  await channel.send({
    content: `🔒 تم قفل التذكرة بواسطة <@${byUserId}>`,
    components: buildTicketControlButtons('closed'),
  });

  await sendLog(channel.guild, `🔒 Closed #${ticket.number} by <@${byUserId}> in <#${channel.id}>`);
  return { ok: true };
}

async function reopenTicket(channel, byUserId) {
  const ticket = ticketByChannel(channel.id);
  if (!ticket || ticket.status !== 'closed') return { ok: false, message: 'لا يمكن إعادة فتح هذه التذكرة.' };
  await channel.permissionOverwrites.edit(ticket.userId, { ViewChannel: true, SendMessages: true }).catch(() => null);
  ticket.status = 'open';
  ticket.reopenedAt = Date.now();
  ticket.lastActivityAt = Date.now();
  store.stats.reopened += 1;
  saveData();
  await channel.send({ content: `✅ تم إعادة فتح التذكرة بواسطة <@${byUserId}>`, components: buildTicketControlButtons('open') });
  await sendLog(channel.guild, `♻️ Reopened #${ticket.number} by <@${byUserId}> in <#${channel.id}>`);
  return { ok: true };
}

async function deleteTicket(channel, byUserId) {
  const ticket = ticketByChannel(channel.id);
  if (ticket) {
    ticket.status = 'deleted';
    ticket.deletedAt = Date.now();
    ticket.deletedBy = byUserId;
    store.stats.deleted += 1;
    saveData();
    await sendLog(channel.guild, `🗑️ Deleted #${ticket.number} by <@${byUserId}>`);
  }
  await channel.delete().catch(() => null);
}

function cooldownRemaining(ticket) {
  const diff = Date.now() - (ticket || 0);
  const need = ticketCooldownSeconds * 1000;
  return diff >= need ? 0 : Math.ceil((need - diff) / 1000);
}

async function openTicket(interaction, type) {
  const member = interaction.member;
  if (store.blacklist.includes(interaction.user.id)) {
    await interaction.reply({ content: '❌ أنت في القائمة السوداء من فتح التذاكر.', ephemeral: true });
    return;
  }

  if (!store.enabled) {
    await interaction.reply({ content: '⛔ نظام التذاكر متوقف حاليًا.', ephemeral: true });
    return;
  }

  const opened = countOpenForUser(interaction.guildId, interaction.user.id);
  if (opened >= maxOpenTicketsPerUser) {
    await interaction.reply({ content: `⚠️ الحد الأقصى للتذاكر المفتوحة: ${maxOpenTicketsPerUser}.`, ephemeral: true });
    return;
  }

  const duplicate = Object.values(store.tickets).find((t) => t.guildId === interaction.guildId && t.userId === interaction.user.id && t.type === type && t.status !== 'deleted');
  if (duplicate) {
    await interaction.reply({ content: `⚠️ لديك تذكرة من نفس النوع: <#${duplicate.channelId}>`, ephemeral: true });
    return;
  }

  const rem = cooldownRemaining(interaction.member.lastTicketAt);
  if (rem > 0) {
    await interaction.reply({ content: `⏳ انتظر ${rem} ثانية قبل فتح تذكرة جديدة.`, ephemeral: true });
    return;
  }

  const cfg = categoryConfig(type);
  const parent = interaction.guild.channels.cache.get(cfg?.categoryId || '');
  if (!cfg || !parent || parent.type !== ChannelType.GuildCategory) {
    await interaction.reply({ content: '❌ هذا القسم غير مضبوط من الإدارة.', ephemeral: true });
    return;
  }

  const n = nextTicketNo(type);
  const name = `ticket-${type}-${String(n).padStart(4, '0')}`;
  const overwrites = [
    { id: interaction.guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
    { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory, PermissionsBitField.Flags.AttachFiles] },
  ];
  for (const roleId of staffRoles) {
    overwrites.push({ id: roleId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] });
  }

  const channel = await interaction.guild.channels.create({
    name,
    type: ChannelType.GuildText,
    parent: parent.id,
    permissionOverwrites: overwrites,
  });

  store.tickets[channel.id] = {
    channelId: channel.id,
    guildId: interaction.guildId,
    userId: interaction.user.id,
    type,
    number: n,
    priority: cfg.priority || 'normal',
    status: 'open',
    claimedBy: null,
    createdAt: Date.now(),
    lastActivityAt: Date.now(),
  };
  interaction.member.lastTicketAt = Date.now();
  store.stats.created += 1;
  saveData();

  const embed = new EmbedBuilder()
    .setColor(0x22c55e)
    .setTitle(`🎫 تذكرة #${n}`)
    .setDescription(`مرحبًا ${interaction.user}\nتم استلام طلبك بنجاح وسيتم الرد عليك قريبًا.\n${staffMention}`)
    .addFields(
      { name: 'القسم', value: cfg.label, inline: true },
      { name: 'الأولوية', value: cfg.priority || 'normal', inline: true },
      { name: 'الحالة', value: 'مفتوحة', inline: true }
    );

  await channel.send({ embeds: [embed], components: buildTicketControlButtons('open') });
  await interaction.reply({ content: `✅ تم فتح تذكرتك: ${channel}`, ephemeral: true });
  await sendLog(interaction.guild, `🆕 Opened #${n} by <@${interaction.user.id}> (${type}) in <#${channel.id}>`);
}

async function claimTicket(channel, userId) {
  const ticket = ticketByChannel(channel.id);
  if (!ticket || ticket.status !== 'open') return { ok: false, message: 'لا يمكن Claim لهذه التذكرة.' };
  if (ticket.claimedBy && ticket.claimedBy !== userId) return { ok: false, message: `التذكرة claimed بواسطة <@${ticket.claimedBy}>` };
  ticket.claimedBy = userId;
  ticket.lastActivityAt = Date.now();
  store.stats.claimed += 1;
  saveData();
  await channel.send(`📌 تم Claim التذكرة بواسطة <@${userId}>`);
  return { ok: true };
}

async function handleTicketCommand(interaction) {
  const sub = interaction.options.getSubcommand();
  const member = interaction.member;
  const staffOnly = ['setup', 'panel', 'add', 'close', 'delete', 'rename', 'blacklist'];
  if (staffOnly.includes(sub) && !isStaff(member)) {
    await interaction.reply({ content: '❌ هذا الأمر للإدارة/الدعم فقط.', ephemeral: true });
    return;
  }

  if (sub === 'setup') {
    store.logsChannelId = interaction.options.getChannel('logs_channel', true).id;
    store.categories.support.categoryId = interaction.options.getString('support_category', true);
    store.categories.report.categoryId = interaction.options.getString('report_category', true);
    store.categories.purchase.categoryId = interaction.options.getString('purchase_category', true);
    store.categories.help.categoryId = interaction.options.getString('help_category', true);
    store.categories.support.transcriptChannelId = interaction.options.getChannel('support_transcript', true).id;
    store.categories.report.transcriptChannelId = interaction.options.getChannel('report_transcript', true).id;
    store.categories.purchase.transcriptChannelId = interaction.options.getChannel('purchase_transcript', true).id;
    store.categories.help.transcriptChannelId = interaction.options.getChannel('help_transcript', true).id;
    saveData();
    await interaction.reply({ content: '✅ تم حفظ إعدادات النظام.', ephemeral: true });
    return;
  }

  if (sub === 'panel') {
    store.panel.title = interaction.options.getString('title', true);
    store.panel.content = interaction.options.getString('content', true);
    store.panel.imageUrl = interaction.options.getString('image_url');
    const ch = interaction.options.getChannel('channel', true);
    store.panel.channelId = ch.id;
    saveData();
    await ch.send({ embeds: [buildPanelEmbed()], components: [buildPanelMenu()] });
    await interaction.reply({ content: `✅ تم إرسال بنل التذاكر في ${ch}`, ephemeral: true });
    return;
  }

  if (sub === 'add') {
    const t = ticketByChannel(interaction.channelId);
    if (!t) {
      await interaction.reply({ content: '❌ هذا الروم ليس تذكرة.', ephemeral: true });
      return;
    }
    const user = interaction.options.getUser('user', true);
    await interaction.channel.permissionOverwrites.edit(user.id, {
      ViewChannel: true,
      SendMessages: true,
      ReadMessageHistory: true,
    });
    await interaction.reply(`✅ تمت إضافة ${user} للتذكرة.`);
    return;
  }

  if (sub === 'close') {
    const res = await closeTicket(interaction.channel, interaction.user.id);
    await interaction.reply({ content: res.ok ? '✅ تم قفل التذكرة.' : `❌ ${res.message}`, ephemeral: true });
    return;
  }

  if (sub === 'delete') {
    await interaction.reply({ content: '🗑️ سيتم حذف التذكرة...', ephemeral: true });
    await deleteTicket(interaction.channel, interaction.user.id);
    return;
  }

  if (sub === 'rename') {
    const t = ticketByChannel(interaction.channelId);
    if (!t) {
      await interaction.reply({ content: '❌ هذا الروم ليس تذكرة.', ephemeral: true });
      return;
    }
    const n = interaction.options.getString('name', true).toLowerCase().replace(/[^a-z0-9-_]/g, '-').slice(0, 80);
    await interaction.channel.setName(n || `ticket-${t.type}-${String(t.number).padStart(4, '0')}`);
    await interaction.reply({ content: `✅ تم تغيير الاسم إلى (${interaction.channel.name}).`, ephemeral: true });
    return;
  }

  if (sub === 'blacklist') {
    const action = interaction.options.getString('action', true);
    const user = interaction.options.getUser('user', true);
    if (action === 'add') {
      if (!store.blacklist.includes(user.id)) store.blacklist.push(user.id);
      saveData();
      await interaction.reply({ content: `✅ تم إضافة ${user} للبلاك ليست.`, ephemeral: true });
      return;
    }

    store.blacklist = store.blacklist.filter((id) => id !== user.id);
    saveData();
    await interaction.reply({ content: `✅ تم إزالة ${user} من البلاك ليست.`, ephemeral: true });
  }
}

async function handleLegacyMessageCommands(message) {
  if (message.author.bot || !message.guild || !message.content.startsWith(PREFIX)) return;
  const text = message.content.slice(PREFIX.length).trim();
  const member = message.member;

  if (text === 'on' && isStaff(member)) {
    store.enabled = true;
    saveData();
    await message.reply('✅ تم تفعيل نظام التذاكر.');
    return;
  }

  if (text === 'off' && isStaff(member)) {
    store.enabled = false;
    saveData();
    await message.reply('⛔ تم تعطيل نظام التذاكر.');
    return;
  }

  if (!text.startsWith('ticket')) return;
  if (!isStaff(member)) return;

  const parts = text.split(/\s+/);
  const sub = parts[1];
  const t = ticketByChannel(message.channel.id);

  if (sub === 'remove') {
    const user = message.mentions.users.first();
    if (!t || !user) return;
    await message.channel.permissionOverwrites.delete(user.id).catch(() => null);
    await message.reply(`✅ تمت إزالة ${user} من التذكرة.`);
    return;
  }

  if (sub === 'close') {
    const res = await closeTicket(message.channel, message.author.id);
    await message.reply(res.ok ? '✅ تم القفل.' : `❌ ${res.message}`);
    return;
  }

  if (sub === 'delete') {
    await message.reply('🗑️ حذف التذكرة...');
    await deleteTicket(message.channel, message.author.id);
    return;
  }

  if (sub === 'rename') {
    if (!t) return;
    const newName = parts.slice(2).join('-').toLowerCase().replace(/[^a-z0-9-_]/g, '-').slice(0, 80);
    if (!newName) return;
    await message.channel.setName(newName);
    await message.reply(`✅ تم إعادة التسمية إلى ${newName}`);
    return;
  }

  if (sub === 'blacklist') {
    const action = parts[2];
    const user = message.mentions.users.first();
    if (!user || !action) return;
    if (action === 'add') {
      if (!store.blacklist.includes(user.id)) store.blacklist.push(user.id);
      saveData();
      await message.reply(`✅ تم حظر ${user} من فتح التذاكر.`);
      return;
    }
    if (action === 'remove') {
      store.blacklist = store.blacklist.filter((id) => id !== user.id);
      saveData();
      await message.reply(`✅ تم فك الحظر عن ${user}.`);
    }
  }
}

function startDashboard() {
  const app = express();
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());

  app.use((req, res, next) => {
    const ownerParam = req.query.owner;
    const secret = req.query.key;
    if (!ownerId || ownerParam !== ownerId || secret !== ownerSecret) {
      res.status(403).send('Forbidden dashboard access.');
      return;
    }
    next();
  });

  app.get('/', (req, res) => {
    const totalOpen = Object.values(store.tickets).filter((t) => t.status === 'open').length;
    const avg = store.stats.ratingsCount ? (store.stats.ratingsSum / store.stats.ratingsCount).toFixed(2) : '0';

    res.send(`<!doctype html><html lang="ar"><head><meta charset="utf-8"><title>AbdoTicket Dashboard</title><style>body{font-family:Arial;background:#0f172a;color:#e2e8f0;padding:20px}.box{background:#1e293b;padding:12px;border-radius:10px;margin:8px 0}input,button,select,textarea{padding:8px;margin:4px;border-radius:8px;border:1px solid #334155;background:#0f172a;color:#fff}</style></head><body><h1>لوحة التحكم</h1><div class="box">Open: ${totalOpen} | Created: ${store.stats.created} | Closed: ${store.stats.closed} | Avg Rate: ${avg}</div><div class="box"><form method="post" action="/toggle?owner=${ownerId}&key=${ownerSecret}"><button name="enabled" value="${store.enabled ? '0' : '1'}">${store.enabled ? 'تعطيل النظام' : 'تفعيل النظام'}</button></form></div><div class="box"><h3>تعديل أولوية الأقسام</h3><form method="post" action="/priority?owner=${ownerId}&key=${ownerSecret}"><select name="type"><option value="support">support</option><option value="report">report</option><option value="purchase">purchase</option><option value="help">help</option></select><select name="priority"><option>low</option><option>normal</option><option>high</option><option>urgent</option></select><button>حفظ</button></form></div></body></html>`);
  });

  app.post('/toggle', (req, res) => {
    store.enabled = req.body.enabled === '1';
    saveData();
    res.redirect(`/?owner=${ownerId}&key=${ownerSecret}`);
  });

  app.post('/priority', (req, res) => {
    const { type, priority } = req.body;
    if (store.categories[type]) {
      store.categories[type].priority = priority;
      saveData();
    }
    res.redirect(`/?owner=${ownerId}&key=${ownerSecret}`);
  });

  app.listen(dashboardPort, () => {
    console.log(`Dashboard running on :${dashboardPort}`);
  });
}

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });

client.once(Events.ClientReady, async () => {
  console.log(`Logged in as ${client.user.tag}`);
  try {
    await registerCommands();
    console.log('Slash commands synced.');
  } catch (error) {
    console.error('[register_commands_failed]', error);
  }
});

client.on(Events.MessageCreate, async (message) => {
  try {
    const t = ticketByChannel(message.channelId);
    if (t && !message.author.bot) {
      t.lastActivityAt = Date.now();
      saveData();
    }
    await handleLegacyMessageCommands(message);
  } catch (e) {
    console.error('[message_error]', e);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (!interaction.inGuild()) return;

    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === 'ticket') {
        await handleTicketCommand(interaction);
      }
      return;
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'ticket_open_menu') {
      const v = interaction.values[0];
      if (v === 'refresh_tickets') {
        const open = Object.values(store.tickets).find((t) => t.guildId === interaction.guildId && t.userId === interaction.user.id && t.status !== 'deleted');
        await interaction.reply({ content: open ? `🔄 تذكرتك الحالية: <#${open.channelId}>` : 'لا يوجد لديك تذاكر حالياً.', ephemeral: true });
        return;
      }
      if (v.startsWith('open_')) {
        await openTicket(interaction, v.replace('open_', ''));
      }
      return;
    }

    if (interaction.isButton()) {
      const t = ticketByChannel(interaction.channelId);
      if (!t) {
        await interaction.reply({ content: '❌ هذا ليس روم تذكرة.', ephemeral: true });
        return;
      }
      if (!isStaff(interaction.member)) {
        await interaction.reply({ content: '❌ هذا الزر لفريق الدعم فقط.', ephemeral: true });
        return;
      }

      if (interaction.customId === 'ticket_claim_btn') {
        const r = await claimTicket(interaction.channel, interaction.user.id);
        await interaction.reply({ content: r.ok ? '✅ تم Claim.' : `❌ ${r.message}`, ephemeral: true });
        return;
      }

      if (interaction.customId === 'ticket_close_btn') {
        const r = await closeTicket(interaction.channel, interaction.user.id);
        await interaction.reply({ content: r.ok ? '✅ تم القفل.' : `❌ ${r.message}`, ephemeral: true });
        if (r.ok) {
          const rateRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('rate_1').setLabel('⭐ 1').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('rate_2').setLabel('⭐ 2').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('rate_3').setLabel('⭐ 3').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('rate_4').setLabel('⭐ 4').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('rate_5').setLabel('⭐ 5').setStyle(ButtonStyle.Success)
          );
          await interaction.channel.send({ content: `<@${t.userId}> قيّم الخدمة من فضلك:`, components: [rateRow] });
        }
        return;
      }

      if (interaction.customId === 'ticket_reopen_btn') {
        const r = await reopenTicket(interaction.channel, interaction.user.id);
        await interaction.reply({ content: r.ok ? '✅ تمت إعادة الفتح.' : `❌ ${r.message}`, ephemeral: true });
        return;
      }

      if (interaction.customId === 'ticket_delete_btn') {
        await interaction.reply({ content: '🗑️ حذف التذكرة...', ephemeral: true });
        await deleteTicket(interaction.channel, interaction.user.id);
        return;
      }

      if (interaction.customId === 'ticket_transcript_btn') {
        const r = await sendTranscript(interaction.channel, t);
        await interaction.reply({ content: r.ok ? `✅ ${r.message}` : `❌ ${r.message}`, ephemeral: true });
        return;
      }

      if (interaction.customId.startsWith('rate_')) {
        if (interaction.user.id !== t.userId) {
          await interaction.reply({ content: '❌ التقييم لصاحب التذكرة فقط.', ephemeral: true });
          return;
        }
        const value = Number(interaction.customId.split('_')[1]);
        if (value >= 1 && value <= 5) {
          store.stats.ratingsCount += 1;
          store.stats.ratingsSum += value;
          saveData();
          await interaction.reply({ content: `✅ شكراً لتقييمك: ${value}⭐`, ephemeral: true });
          await sendLog(interaction.guild, `⭐ Ticket #${t.number} rated ${value}/5 by <@${interaction.user.id}>`);
        }
      }
    }
  } catch (error) {
    console.error('[interaction_error]', error);
    if (interaction && !interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: '❌ حدث خطأ غير متوقع.', ephemeral: true }).catch(() => null);
    }
  }
});

setInterval(async () => {
  try {
    const now = Date.now();
    const maxIdle = inactiveCloseMinutes * 60 * 1000;
    for (const ticket of Object.values(store.tickets)) {
      if (ticket.status !== 'open') continue;
      if (now - (ticket.lastActivityAt || ticket.createdAt) < maxIdle) continue;

      const guild = client.guilds.cache.get(ticket.guildId);
      if (!guild) continue;
      const channel = guild.channels.cache.get(ticket.channelId);
      if (!channel || channel.type !== ChannelType.GuildText) continue;

      await closeTicket(channel, client.user.id);
      await channel.send('⏱️ تم قفل التذكرة تلقائيًا بسبب عدم النشاط.');
    }
  } catch (e) {
    console.error('[auto_close]', e);
  }
}, 60 * 1000);

client.on(Events.Error, (e) => console.error('[client_error]', e));

startDashboard();
client.login(TOKEN);

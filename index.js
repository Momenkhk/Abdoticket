const fs = require('fs');
const path = require('path');
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
  console.error('Missing config.json. Please create it before starting the bot.');
  process.exit(1);
}

const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const {
  token: TOKEN,
  clientId: CLIENT_ID,
  guildId: GUILD_ID,
  prefix: PREFIX = '$',
  staffMention = '<@873442377396797510>',
  supportRoleIds = [],
} = config;

if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
  console.error('config.json must include token, clientId, and guildId.');
  process.exit(1);
}

function isSnowflake(value) {
  return typeof value === 'string' && /^\d{16,20}$/.test(value);
}

const normalizedSupportRoleIds = Array.isArray(supportRoleIds)
  ? supportRoleIds.filter(isSnowflake)
  : [];

const dataPath = path.join(__dirname, 'data.json');
const defaultData = {
  workStatus: {},
  panelMessages: {},
  openTickets: {},
  categories: { game: null, other: null, support: null },
  transcriptChannels: { game: null, other: null, support: null },
  ticketCounters: { game: 0, other: 0, support: 0 },
};

function loadData() {
  if (!fs.existsSync(dataPath)) {
    fs.writeFileSync(dataPath, JSON.stringify(defaultData, null, 2), 'utf8');
    return structuredClone(defaultData);
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
    return {
      ...defaultData,
      ...parsed,
      categories: { ...defaultData.categories, ...(parsed.categories || {}) },
      transcriptChannels: { ...defaultData.transcriptChannels, ...(parsed.transcriptChannels || {}) },
      ticketCounters: { ...defaultData.ticketCounters, ...(parsed.ticketCounters || {}) },
      openTickets: parsed.openTickets || {},
    };
  } catch {
    return structuredClone(defaultData);
  }
}

let store = loadData();
function saveData() {
  fs.writeFileSync(dataPath, JSON.stringify(store, null, 2), 'utf8');
}

const commands = [
  new SlashCommandBuilder()
    .setName('set-panel')
    .setDescription('Create main ticket panel with channels setup')
    .addStringOption((o) => o.setName('title').setDescription('Panel title').setRequired(true))
    .addStringOption((o) => o.setName('content').setDescription('Panel content').setRequired(true))
    .addStringOption((o) => o.setName('category_game').setDescription('Category ID for game tickets').setRequired(true))
    .addStringOption((o) => o.setName('category_other').setDescription('Category ID for other tickets').setRequired(true))
    .addStringOption((o) => o.setName('category_support').setDescription('Category ID for support tickets').setRequired(true))
    .addChannelOption((o) => o.setName('transcript_game').setDescription('Transcript channel for game').setRequired(true).addChannelTypes(ChannelType.GuildText))
    .addChannelOption((o) => o.setName('transcript_other').setDescription('Transcript channel for other').setRequired(true).addChannelTypes(ChannelType.GuildText))
    .addChannelOption((o) => o.setName('transcript_support').setDescription('Transcript channel for support').setRequired(true).addChannelTypes(ChannelType.GuildText))
    .addStringOption((o) => o.setName('image_url').setDescription('Optional image URL'))
    .addChannelOption((o) => o.setName('channel').setDescription('Target panel channel').addChannelTypes(ChannelType.GuildText)),
  new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('Create focused ticket panel for one type')
    .addStringOption((o) =>
      o.setName('type').setDescription('Ticket type').setRequired(true).addChoices(
        { name: 'شحن العاب', value: 'game' },
        { name: 'خدمات اخرى', value: 'other' },
        { name: 'شكوى / استفسار', value: 'support' }
      )
    )
    .addStringOption((o) => o.setName('title').setDescription('Panel title').setRequired(true))
    .addStringOption((o) => o.setName('content').setDescription('Panel description').setRequired(true))
    .addStringOption((o) => o.setName('image_url').setDescription('Optional image URL'))
    .addStringOption((o) => o.setName('category_id').setDescription('Optional category ID override'))
    .addChannelOption((o) => o.setName('transcript_channel').setDescription('Optional transcript channel override').addChannelTypes(ChannelType.GuildText))
    .addChannelOption((o) => o.setName('channel').setDescription('Target channel').addChannelTypes(ChannelType.GuildText)),
].map((c) => c.toJSON());

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(TOKEN);
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
  console.log('Slash commands synced.');
}

function isAdmin(member) {
  return member.permissions.has(PermissionsBitField.Flags.Administrator);
}

function isSupport(member) {
  if (isAdmin(member)) return true;
  return normalizedSupportRoleIds.some((roleId) => member.roles.cache.has(roleId));
}

async function replyNoPermission(source) {
  if (source.deferred || source.replied) {
    await source.followUp({ content: '❌ هذا الأمر مخصص للإدارة وفريق الدعم فقط.', ephemeral: true });
    return;
  }
  await source.reply({ content: '❌ هذا الأمر مخصص للإدارة وفريق الدعم فقط.', ephemeral: true });
}

function typeLabel(type) {
  return type === 'game' || type === 'other' ? type : 'support';
}

function typeArabic(type) {
  if (type === 'game') return 'شحن ألعاب';
  if (type === 'other') return 'خدمات أخرى';
  return 'شكوى / استفسار';
}

function nextTicketNumber(type) {
  const label = typeLabel(type);
  const next = (store.ticketCounters[label] || 0) + 1;
  store.ticketCounters[label] = next;
  saveData();
  return next;
}

function buildEmbed(title, content, imageUrl) {
  const e = new EmbedBuilder().setColor(0x2f3136).setTitle(title).setDescription(content).setFooter({ text: 'AbdoTicket • نظام تذاكر متطور' });
  if (imageUrl) e.setImage(imageUrl);
  return e;
}

function buildMainComponents() {
  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ticket_game_btn').setLabel('شـحـن الـعـاب').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('ticket_other_btn').setLabel('خـدمـات اخـرى').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('ticket_support_btn').setLabel('شـكـوى / اسـتـفـسـار').setStyle(ButtonStyle.Success)
  );
  const menu = new StringSelectMenuBuilder()
    .setCustomId('ticket_menu')
    .setPlaceholder('اختر نوع التذكرة')
    .addOptions(
      { label: 'شـحـن الـعـاب', value: 'ticket_game', description: 'فتح تذكرة شحن العاب', emoji: '🎮' },
      { label: 'خـدمـات اخـرى', value: 'ticket_other', description: 'فتح تذكرة خدمات أخرى', emoji: '🛠️' },
      { label: 'شـكـوى / اسـتـفـسـار', value: 'ticket_support', description: 'فتح شكوى أو استفسار', emoji: '📩' },
      { label: 'Refresh', value: 'ticket_refresh', description: 'تحديث حالة التذكرة', emoji: '🔄' }
    );
  return [buttons, new ActionRowBuilder().addComponents(menu)];
}

async function fetchTicketMessages(channel) {
  const all = [];
  let lastId;
  while (true) {
    const batch = await channel.messages.fetch({ limit: 100, ...(lastId ? { before: lastId } : {}) });
    if (!batch.size) break;
    all.push(...batch.values());
    lastId = batch.last().id;
    if (batch.size < 100) break;
  }
  return all.reverse();
}

async function buildTranscript(channel, ticketInfo) {
  const msgs = await fetchTicketMessages(channel);
  const lines = [];
  lines.push(`Guild: ${channel.guild.name}`);
  lines.push(`Channel: #${channel.name}`);
  lines.push(`Ticket Type: ${ticketInfo.type}`);
  lines.push(`Opened By: ${ticketInfo.userId}`);
  lines.push(`Created At: ${new Date(ticketInfo.createdAt).toISOString()}`);
  if (ticketInfo.closedAt) lines.push(`Closed At: ${new Date(ticketInfo.closedAt).toISOString()}`);
  lines.push('---------------------------------------------------');
  for (const m of msgs) {
    const at = new Date(m.createdTimestamp).toISOString();
    const content = m.content?.replace(/\n/g, ' ') || '[no-text]';
    const attach = m.attachments.size ? ` attachments=${m.attachments.map((a) => a.url).join(',')}` : '';
    lines.push(`[${at}] ${m.author.tag}: ${content}${attach}`);
  }
  return lines.join('\n');
}

async function sendTranscript(channel, ticketInfo, forcedTarget) {
  const targetId = forcedTarget || store.transcriptChannels[typeLabel(ticketInfo.type)];
  const target = channel.guild.channels.cache.get(targetId);
  if (!target || target.type !== ChannelType.GuildText) {
    return { ok: false, message: 'Transcript channel not configured correctly.' };
  }
  const content = await buildTranscript(channel, ticketInfo);
  const file = new AttachmentBuilder(Buffer.from(content, 'utf8'), { name: `transcript-${channel.name}.txt` });
  await target.send({
    content: `📄 Transcript for <#${channel.id}> | Type: **${ticketInfo.type}** | User: <@${ticketInfo.userId}>`,
    files: [file],
  });
  return { ok: true, message: `Transcript sent to ${target}.` };
}

async function closeTicket(channel, moderatorId) {
  const ticket = store.openTickets[channel.id];
  if (!ticket || ticket.closed) return { ok: false, message: 'هذه القناة ليست تذكرة مفتوحة.' };

  await channel.permissionOverwrites.edit(channel.guild.roles.everyone, { ViewChannel: false });
  await channel.permissionOverwrites.edit(ticket.userId, { ViewChannel: false, SendMessages: false });

  ticket.closed = true;
  ticket.closedAt = Date.now();
  ticket.closedBy = moderatorId;
  saveData();

  const controls = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ticket_transcript_btn').setLabel('Transcript').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('ticket_delete_btn').setLabel('Delete').setStyle(ButtonStyle.Danger)
  );

  await channel.send({
    content: `✅ تم قفل التذكرة #${ticket.ticketNumber} من قبل <@${moderatorId}>.`,
    components: [controls],
  });

  return { ok: true, message: 'Ticket closed.' };
}

async function withSafety(label, action, source) {
  try {
    await action();
  } catch (error) {
    console.error(`[${label}]`, error);
    if (source && typeof source.reply === 'function' && !source.replied && !source.deferred) {
      await source.reply({ content: '❌ حصل خطأ غير متوقع، حاول مرة أخرى.', ephemeral: true }).catch(() => null);
    }
  }
}

async function createTicketChannel(interaction, type) {
  const status = store.workStatus[interaction.channelId];
  if (status && status.enabled === false) {
    await interaction.reply({ content: '❌ النظام مغلق حالياً. تابع مواعيد العمل ثم حاول مرة أخرى.', ephemeral: true });
    return;
  }

  const existing = Object.values(store.openTickets).find((t) => t.guildId === interaction.guildId && t.userId === interaction.user.id && !t.closed);
  if (existing) {
    await interaction.reply({ content: `⚠️ لديك تذكرة مفتوحة بالفعل: <#${existing.channelId}>`, ephemeral: true });
    return;
  }

  const categoryId = store.categories[typeLabel(type)];
  const parent = interaction.guild.channels.cache.get(categoryId);
  if (!categoryId || !parent || parent.type !== ChannelType.GuildCategory) {
    await interaction.reply({ content: '❌ كاتيجوري هذا النوع غير مضبوطة بشكل صحيح.', ephemeral: true });
    return;
  }

  const ticketNumber = nextTicketNumber(type);
  const shortType = typeLabel(type);
  const padded = String(ticketNumber).padStart(4, '0');
  const channelName = `ticket-${shortType}-${padded}`;

  const overwrites = [
    { id: interaction.guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
    {
      id: interaction.user.id,
      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ReadMessageHistory,
        PermissionsBitField.Flags.AttachFiles,
      ],
    },
  ];

  for (const roleId of normalizedSupportRoleIds) {
    overwrites.push({
      id: roleId,
      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ReadMessageHistory,
        PermissionsBitField.Flags.AttachFiles,
      ],
    });
  }

  const channel = await interaction.guild.channels.create({
    name: channelName,
    type: ChannelType.GuildText,
    parent: parent.id,
    permissionOverwrites: overwrites,
  });

  store.openTickets[channel.id] = {
    channelId: channel.id,
    guildId: interaction.guildId,
    userId: interaction.user.id,
    type,
    ticketNumber,
    closed: false,
    createdAt: Date.now(),
  };
  saveData();

  await channel.send({ content: `${interaction.user} عزيزنا العميل ، برجاء العلم انه تم استلام تذكرتك برجاء الانتظار سيتم الرد عليك من احد ممثلي خدمة العملاء بعد قليل ، برجاء عدم الازعاج بالمنشن.\n${staffMention}` });
  const ticketEmbed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`Ticket #${ticketNumber}`)
    .addFields(
      { name: 'النوع', value: typeArabic(type), inline: true },
      { name: 'صاحب التذكرة', value: `<@${interaction.user.id}>`, inline: true },
      { name: 'الحالة', value: '🟢 مفتوحة', inline: true }
    )
    .setTimestamp();
  await channel.send({ embeds: [ticketEmbed] });
  await interaction.reply({ content: `✅ تم فتح تذكرتك: ${channel}`, ephemeral: true });
}

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });

client.once(Events.ClientReady, async () => {
  console.log(`Logged in as ${client.user.tag}`);
  try {
    await registerCommands();
  } catch (error) {
    console.error('[register_commands_failed]', error);
  }
});

client.on(Events.Error, (error) => {
  console.error('[client_error]', error);
});

client.on(Events.MessageCreate, async (message) => {
  await withSafety('message_create', async () => {
  if (message.author.bot || !message.guild || !message.content.startsWith(PREFIX)) return;
  const cmd = message.content.slice(PREFIX.length).trim().toLowerCase();

  if (cmd === 'on') {
    if (!isSupport(message.member)) return;
    const ping = await message.channel.send('@here تم فتح استقبال التذاكر الآن ✅');
    store.workStatus[message.channel.id] = { enabled: true, pingMessageId: ping.id };
    saveData();
    await message.reply('تم تفعيل استقبال التذاكر في هذه القناة.');
    return;
  }

  if (cmd === 'off') {
    if (!isSupport(message.member)) return;
    const status = store.workStatus[message.channel.id];
    if (status?.pingMessageId) {
      const old = await message.channel.messages.fetch(status.pingMessageId).catch(() => null);
      if (old) await old.delete().catch(() => null);
    }
    store.workStatus[message.channel.id] = { enabled: false, pingMessageId: null };
    saveData();
    await message.reply('تم إيقاف استقبال التذاكر في هذه القناة.');
    return;
  }

  if (cmd === 'close all') {
    if (!isSupport(message.member)) return;
    const openTickets = Object.values(store.openTickets).filter((t) => t.guildId === message.guild.id && !t.closed);
    let closedCount = 0;
    for (const t of openTickets) {
      const ch = message.guild.channels.cache.get(t.channelId);
      if (!ch || ch.type !== ChannelType.GuildText) continue;
      const res = await closeTicket(ch, message.author.id).catch(() => ({ ok: false }));
      if (res.ok) closedCount += 1;
    }
    await message.reply(`✅ تم قفل ${closedCount} تذكرة.`);
    return;
  }

  if (cmd === 'transcript all') {
    if (!isSupport(message.member)) return;
    const closed = Object.values(store.openTickets).filter((t) => t.guildId === message.guild.id && t.closed);
    let sent = 0;
    for (const t of closed) {
      const ch = message.guild.channels.cache.get(t.channelId);
      if (!ch || ch.type !== ChannelType.GuildText) continue;
      const res = await sendTranscript(ch, t);
      if (res.ok) sent += 1;
    }
    await message.reply(`✅ تم إرسال ${sent} ترانسكربت من التذاكر المقفولة.`);
    return;
  }

  if (cmd === 'close') {
    if (!isSupport(message.member)) return;
    const res = await closeTicket(message.channel, message.author.id);
    await message.reply(res.ok ? '✅ تم قفل التذكرة.' : `❌ ${res.message}`);
    return;
  }

  if (cmd === 'transcript') {
    if (!isSupport(message.member)) return;
    const ticket = store.openTickets[message.channel.id];
    if (!ticket) {
      await message.reply('❌ هذا ليس روم تذكرة.');
      return;
    }
    const result = await sendTranscript(message.channel, ticket);
    await message.reply(result.ok ? `✅ ${result.message}` : `❌ ${result.message}`);
  }
  });
});

client.on(Events.InteractionCreate, async (interaction) => {
  await withSafety('interaction_create', async () => {
  if (!interaction.inGuild()) return;

  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === 'set-panel') {
      if (!isSupport(interaction.member)) {
        await replyNoPermission(interaction);
        return;
      }
      const title = interaction.options.getString('title', true);
      const content = interaction.options.getString('content', true);
      const imageUrl = interaction.options.getString('image_url');
      const targetChannel = interaction.options.getChannel('channel') || interaction.channel;

      store.categories.game = interaction.options.getString('category_game', true);
      store.categories.other = interaction.options.getString('category_other', true);
      store.categories.support = interaction.options.getString('category_support', true);
      store.transcriptChannels.game = interaction.options.getChannel('transcript_game', true).id;
      store.transcriptChannels.other = interaction.options.getChannel('transcript_other', true).id;
      store.transcriptChannels.support = interaction.options.getChannel('transcript_support', true).id;
      saveData();

      const sent = await targetChannel.send({ embeds: [buildEmbed(title, content, imageUrl)], components: buildMainComponents() });
      store.panelMessages[sent.id] = targetChannel.id;
      saveData();

      await interaction.reply({ content: `✅ تم إرسال البنل في ${targetChannel}.`, ephemeral: true });
      return;
    }

    if (interaction.commandName === 'ticket') {
      if (!isSupport(interaction.member)) {
        await replyNoPermission(interaction);
        return;
      }
      const type = interaction.options.getString('type', true);
      const title = interaction.options.getString('title', true);
      const content = interaction.options.getString('content', true);
      const imageUrl = interaction.options.getString('image_url');
      const categoryId = interaction.options.getString('category_id');
      const transcriptCh = interaction.options.getChannel('transcript_channel');
      const targetChannel = interaction.options.getChannel('channel') || interaction.channel;

      if (categoryId) store.categories[typeLabel(type)] = categoryId;
      if (transcriptCh) store.transcriptChannels[typeLabel(type)] = transcriptCh.id;
      saveData();

      const buttonMap = {
        game: new ButtonBuilder().setCustomId('ticket_game_btn').setLabel('شـحـن الـعـاب').setStyle(ButtonStyle.Danger),
        other: new ButtonBuilder().setCustomId('ticket_other_btn').setLabel('خـدمـات اخـرى').setStyle(ButtonStyle.Primary),
        support: new ButtonBuilder().setCustomId('ticket_support_btn').setLabel('شـكـوى / اسـتـفـسـار').setStyle(ButtonStyle.Success),
      };
      const sent = await targetChannel.send({
        embeds: [buildEmbed(title, content, imageUrl)],
        components: [new ActionRowBuilder().addComponents(buttonMap[type])],
      });

      store.panelMessages[sent.id] = targetChannel.id;
      saveData();

      await interaction.reply({ content: `✅ تم إرسال بنل ${type} في ${targetChannel}.`, ephemeral: true });
      return;
    }
  }

  if (interaction.isButton()) {
    if (interaction.customId === 'ticket_game_btn') return createTicketChannel(interaction, 'game');
    if (interaction.customId === 'ticket_other_btn') return createTicketChannel(interaction, 'other');
    if (interaction.customId === 'ticket_support_btn') return createTicketChannel(interaction, 'support');

    if (interaction.customId === 'ticket_delete_btn') {
      if (!isSupport(interaction.member)) {
        await replyNoPermission(interaction);
        return;
      }
      await interaction.reply({ content: '🗑️ سيتم حذف التذكرة...', ephemeral: true });
      await interaction.channel.delete().catch(() => null);
      return;
    }

    if (interaction.customId === 'ticket_transcript_btn') {
      if (!isSupport(interaction.member)) {
        await replyNoPermission(interaction);
        return;
      }
      const ticket = store.openTickets[interaction.channelId];
      if (!ticket) {
        await interaction.reply({ content: '❌ لا توجد بيانات لهذه التذكرة.', ephemeral: true });
        return;
      }
      const res = await sendTranscript(interaction.channel, ticket);
      await interaction.reply({ content: res.ok ? `✅ ${res.message}` : `❌ ${res.message}`, ephemeral: true });
      return;
    }
  }

  if (interaction.isStringSelectMenu() && interaction.customId === 'ticket_menu') {
    const choice = interaction.values[0];
    if (choice === 'ticket_refresh') {
      const open = Object.values(store.openTickets).find((t) => t.userId === interaction.user.id && t.guildId === interaction.guildId && !t.closed);
      await interaction.reply({
        content: open ? `🔄 تذكرتك الحالية: <#${open.channelId}>` : '🔄 لا توجد لديك أي تذكرة مفتوحة حالياً.',
        ephemeral: true,
      });
      return;
    }
    if (choice === 'ticket_game') return createTicketChannel(interaction, 'game');
    if (choice === 'ticket_other') return createTicketChannel(interaction, 'other');
    if (choice === 'ticket_support') return createTicketChannel(interaction, 'support');
  }
  }, interaction);
});

client.login(TOKEN);

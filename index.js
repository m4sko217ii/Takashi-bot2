// ============================================================
//  BOT DISCORD — index.js v4.0
//  Préfixe : +
//  Hébergement : Render 24/7
// ============================================================

const {
  Client, GatewayIntentBits, PermissionsBitField,
  EmbedBuilder, ActionRowBuilder, ButtonBuilder,
  ButtonStyle, ChannelType, ActivityType, REST, Routes
} = require('discord.js');
const fs = require('fs');
const http = require('http');

// ─── Keep-alive HTTP server ────────────────────────────────
http.createServer((_, res) => { res.writeHead(200); res.end('OK'); }).listen(process.env.PORT || 3000);

// ─── Client ───────────────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessageReactions,
  ]
});

const PREFIX = '+';

// ─── Données persistantes ─────────────────────────────────
const WARNS_FILE = './warnings.json';
const CONFIG_FILE = './config.json';
const MARRIAGES_FILE = './marriages.json';

function loadJSON(file, fallback = {}) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function saveJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

let warnings = loadJSON(WARNS_FILE);
let config = loadJSON(CONFIG_FILE);

function getGuildConfig(guildId) {
  if (!config[guildId]) config[guildId] = {};
  return config[guildId];
}
function saveConfig() { saveJSON(CONFIG_FILE, config); }

// ─── Anti-spam ────────────────────────────────────────────
const spamMap = new Map();

// ─── Statuts rotatifs ─────────────────────────────────────
const statuses = [
  { name: 'Préfixe : +help', type: ActivityType.Playing },
  { name: 'Modération 24/7', type: ActivityType.Watching },
  { name: '+help pour les commandes', type: ActivityType.Listening },
];
let statusIndex = 0;

// ─── Helper : est-ce que le membre est Staff ou Admin ─────
function isStaff(member, guild) {
  if (member.permissions.has(PermissionsBitField.Flags.Administrator)) return true;
  const cfg = getGuildConfig(guild.id);
  if (!cfg.staffRole) return false;
  return member.roles.cache.has(cfg.staffRole);
}

// ══════════════════════════════════════════════════════════
//  SLASH COMMANDS
// ══════════════════════════════════════════════════════════
const slashCommands = [
  {
    name: 'setstatus',
    description: 'Change le statut du bot (Admin)',
    options: [{ name: 'texte', description: 'Nouveau statut', type: 3, required: true }]
  }
];

async function registerSlashCommands() {
  if (!process.env.DISCORD_TOKEN || !process.env.CLIENT_ID) return;
  try {
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: slashCommands });
    console.log('✅ Slash commands enregistrées.');
  } catch (err) { console.error('Erreur slash:', err); }
}

// ══════════════════════════════════════════════════════════
//  READY
// ══════════════════════════════════════════════════════════
client.once('ready', async () => {
  console.log(`✅ Connecté en tant que ${client.user.tag}`);
  await registerSlashCommands();
  setInterval(() => {
    const s = statuses[statusIndex % statuses.length];
    client.user.setActivity(s.name, { type: s.type });
    statusIndex++;
  }, 30000);
  client.user.setActivity(statuses[0].name, { type: statuses[0].type });
});

// ══════════════════════════════════════════════════════════
//  SLASH HANDLER
// ══════════════════════════════════════════════════════════
client.on('interactionCreate', async interaction => {
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === 'setstatus') {
      if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator))
        return interaction.reply({ content: '❌ Admin seulement.', ephemeral: true });
      const texte = interaction.options.getString('texte');
      client.user.setActivity(texte, { type: ActivityType.Playing });
      return interaction.reply({ content: `✅ Statut : **${texte}**`, ephemeral: true });
    }
    return;
  }

  // ── Boutons ──────────────────────────────────────────────
  if (!interaction.isButton()) return;
  const { customId, guild, member, channel, user } = interaction;

  // ── TICKET : ouvrir ──────────────────────────────────────
  const ticketTypes = {
    ticket_support:  { label: '🎫 Support',   color: '#5865F2' },
    ticket_report:   { label: '🚨 Report',    color: '#ED4245' },
    ticket_question: { label: '❓ Question',  color: '#FEE75C' },
    ticket_autre:    { label: '📝 Autre',     color: '#57F287' },
  };

  if (ticketTypes[customId]) {
    const type = customId.replace('ticket_', '');
    const info = ticketTypes[customId];
    const cfg = getGuildConfig(guild.id);

    const existing = guild.channels.cache.find(
      c => c.name === `ticket-${user.username.toLowerCase()}` && c.type === ChannelType.GuildText
    );
    if (existing) return interaction.reply({ content: `❌ Tu as déjà un ticket ouvert : <#${existing.id}>`, ephemeral: true });

    // Rôle staff pour cette catégorie
    const roleId = cfg[`ticketRole_${type}`] || cfg.staffRole;

    const permOverwrites = [
      { id: guild.roles.everyone, deny: [PermissionsBitField.Flags.ViewChannel] },
      { id: user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
    ];
    if (roleId) {
      permOverwrites.push({ id: roleId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] });
    }

    const ticketChannel = await guild.channels.create({
      name: `ticket-${user.username.toLowerCase()}`,
      type: ChannelType.GuildText,
      permissionOverwrites: permOverwrites,
    });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('ticket_claim').setLabel('✋ Claim').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('ticket_add').setLabel('➕ Add').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('ticket_close').setLabel('🔒 Fermer').setStyle(ButtonStyle.Danger),
    );

    const embed = new EmbedBuilder()
      .setTitle(`${info.label} — Ticket de ${user.username}`)
      .setDescription(`Bonjour <@${user.id}> ! 👋\nExplique ton problème, le staff va te répondre.\n\n${roleId ? `<@&${roleId}>` : ''}`)
      .setColor(info.color)
      .addFields(
        { name: '📋 Catégorie', value: info.label, inline: true },
        { name: '👤 Ouvert par', value: `<@${user.id}>`, inline: true },
        { name: '⏰ Ouvert le', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true },
      )
      .setFooter({ text: 'Utilisez les boutons ci-dessous pour gérer ce ticket.' })
      .setTimestamp();

    await ticketChannel.send({ embeds: [embed], components: [row] });
    return interaction.reply({ content: `✅ Ticket créé : <#${ticketChannel.id}>`, ephemeral: true });
  }

  // ── TICKET : Claim ───────────────────────────────────────
  if (customId === 'ticket_claim') {
    if (!isStaff(member, guild))
      return interaction.reply({ content: '❌ Réservé au staff.', ephemeral: true });

    // Retire l'accès à tous les autres rôles staff sur ce salon
    const cfg = getGuildConfig(guild.id);
    const type = channel.name.split('-')[1];
    const roleId = cfg[`ticketRole_${type}`] || cfg.staffRole;

    if (roleId) {
      await channel.permissionOverwrites.edit(roleId, { ViewChannel: false }).catch(() => {});
    }
    // Donne accès uniquement au claimer
    await channel.permissionOverwrites.edit(user.id, {
      ViewChannel: true, SendMessages: true, ReadMessageHistory: true
    }).catch(() => {});

    const embed = new EmbedBuilder()
      .setDescription(`✋ **${user.username}** a pris en charge ce ticket.`)
      .setColor('#57F287')
      .setTimestamp();

    // Désactive le bouton claim
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('ticket_claim').setLabel(`✅ Pris par ${user.username}`).setStyle(ButtonStyle.Success).setDisabled(true),
      new ButtonBuilder().setCustomId('ticket_add').setLabel('➕ Add').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('ticket_close').setLabel('🔒 Fermer').setStyle(ButtonStyle.Danger),
    );

    await interaction.message.edit({ components: [row] }).catch(() => {});
    return interaction.reply({ embeds: [embed] });
  }

  // ── TICKET : Add ─────────────────────────────────────────
  if (customId === 'ticket_add') {
    if (!isStaff(member, guild))
      return interaction.reply({ content: '❌ Réservé au staff.', ephemeral: true });
    return interaction.reply({ content: '➕ Mentionne la personne à ajouter avec `+addticket @user`', ephemeral: true });
  }

  // ── TICKET : Fermer ──────────────────────────────────────
  if (customId === 'ticket_close') {
    if (!isStaff(member, guild) && !channel.permissionsFor(user).has(PermissionsBitField.Flags.ViewChannel))
      return interaction.reply({ content: '❌ Tu ne peux pas fermer ce ticket.', ephemeral: true });
    const embed = new EmbedBuilder()
      .setDescription('🔒 Ticket fermé. Suppression dans 5 secondes...')
      .setColor('#ED4245');
    await interaction.reply({ embeds: [embed] });
    setTimeout(() => channel.delete().catch(() => {}), 5000);
  }
});

// ══════════════════════════════════════════════════════════
//  LOGS HELPERS
// ══════════════════════════════════════════════════════════
function logMod(guild, text) {
  const ch = guild.channels.cache.get(getGuildConfig(guild.id).modLogsChannel);
  if (!ch) return;
  ch.send({ embeds: [new EmbedBuilder().setDescription(text).setColor('#FF4500').setTimestamp()] }).catch(() => {});
}
function logMsg(guild, text) {
  const ch = guild.channels.cache.get(getGuildConfig(guild.id).msgLogsChannel);
  if (!ch) return;
  ch.send({ embeds: [new EmbedBuilder().setDescription(text).setColor('#FFA500').setTimestamp()] }).catch(() => {});
}
function logVoice(guild, text) {
  const ch = guild.channels.cache.get(getGuildConfig(guild.id).voiceLogsChannel);
  if (!ch) return;
  ch.send({ embeds: [new EmbedBuilder().setDescription(text).setColor('#5865F2').setTimestamp()] }).catch(() => {});
}
function logBoost(guild, text) {
  const ch = guild.channels.cache.get(getGuildConfig(guild.id).boostLogsChannel);
  if (!ch) return;
  ch.send({ embeds: [new EmbedBuilder().setDescription(text).setColor('#FF73FA').setTimestamp()] }).catch(() => {});
}

// ══════════════════════════════════════════════════════════
//  ÉVÉNEMENTS AUTO
// ══════════════════════════════════════════════════════════
client.on('messageDelete', message => {
  if (!message.guild || message.author?.bot) return;
  logMsg(message.guild, `🗑️ **Message supprimé** de <@${message.author?.id}> dans <#${message.channel.id}>\n\`\`\`${(message.content || 'Contenu inconnu').substring(0, 900)}\`\`\``);
});
client.on('messageUpdate', (oldMsg, newMsg) => {
  if (!oldMsg.guild || oldMsg.author?.bot || oldMsg.content === newMsg.content) return;
  logMsg(oldMsg.guild, `✏️ **Message édité** par <@${oldMsg.author?.id}> dans <#${oldMsg.channel.id}>\n**Avant :** ${(oldMsg.content || '').substring(0, 400)}\n**Après :** ${(newMsg.content || '').substring(0, 400)}`);
});
client.on('voiceStateUpdate', (oldState, newState) => {
  const member = newState.member || oldState.member;
  if (!member || member.user.bot) return;
  const guild = newState.guild || oldState.guild;
  if (!oldState.channel && newState.channel) logVoice(guild, `🔊 **${member.user.tag}** a rejoint **${newState.channel.name}**`);
  else if (oldState.channel && !newState.channel) logVoice(guild, `🔇 **${member.user.tag}** a quitté **${oldState.channel.name}**`);
  else if (oldState.channel && newState.channel && oldState.channel.id !== newState.channel.id) logVoice(guild, `🔀 **${member.user.tag}** : **${oldState.channel.name}** → **${newState.channel.name}**`);
});
client.on('guildMemberUpdate', (oldMember, newMember) => {
  if (!oldMember.premiumSince && newMember.premiumSince)
    logBoost(newMember.guild, `🚀 **${newMember.user.tag}** vient de booster le serveur ! 💎`);
});
client.on('guildMemberAdd', async member => {
  const cfg = getGuildConfig(member.guild.id);
  if (!cfg.welcomeChannel) return;
  const channel = member.guild.channels.cache.get(cfg.welcomeChannel);
  if (!channel) return;
  channel.send({ embeds: [new EmbedBuilder()
    .setTitle('🌸 Bienvenue !')
    .setDescription(`Salut **${member.user.username}** ! Bienvenue sur **${member.guild.name}** 🎌\nTu es le membre **#${member.guild.memberCount}**.`)
    .setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 256 }))
    .setColor('#FF6B9D').setTimestamp()
  ]});
});
client.on('guildMemberRemove', async member => {
  const cfg = getGuildConfig(member.guild.id);
  if (!cfg.leaveChannel) return;
  const channel = member.guild.channels.cache.get(cfg.leaveChannel);
  if (!channel) return;
  channel.send({ embeds: [new EmbedBuilder()
    .setTitle('👋 Au revoir')
    .setDescription(`**${member.user.username}** vient de quitter le serveur.`)
    .setColor('#888888').setTimestamp()
  ]});
});

// ══════════════════════════════════════════════════════════
//  MESSAGE CREATE
// ══════════════════════════════════════════════════════════
client.on('messageCreate', async message => {
  if (message.author.bot || !message.guild) return;

  // ── IA mention ──────────────────────────────────────────
  if (message.mentions.has(client.user) && !message.content.startsWith(PREFIX)) {
    const question = message.content.replace(`<@${client.user.id}>`, '').trim();
    if (!question) return message.reply('Oui ? Tu veux me poser une question ? 👀');
    await message.channel.sendTyping();
    try {
      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.GROQ_API_KEY}` },
        body: JSON.stringify({
          model: 'llama3-8b-8192',
          max_tokens: 500,
          messages: [
            { role: 'system', content: 'Tu es Takashi, un assistant Discord cool, décontracté et un peu anime. Tu réponds en français, de façon courte et sympa. Pas plus de 3-4 phrases.' },
            { role: 'user', content: question }
          ]
        })
      });
      const data = await response.json();
      const reply = data.choices?.[0]?.message?.content || 'Je sais pas trop là... 🤔';
      return message.reply(reply.substring(0, 1900));
    } catch { return message.reply('Oups, un souci technique 😅 Réessaie !'); }
  }

  // ── Anti-spam ───────────────────────────────────────────
  if (!message.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) {
    const key = `${message.guild.id}-${message.author.id}`;
    if (!spamMap.has(key)) spamMap.set(key, { count: 0, timer: null });
    const spam = spamMap.get(key);
    spam.count++;
    if (spam.timer) clearTimeout(spam.timer);
    spam.timer = setTimeout(() => spamMap.delete(key), 5000);
    if (spam.count >= 6) {
      spamMap.delete(key);
      await message.member.timeout(10 * 60 * 1000, 'Anti-spam').catch(() => {});
      message.channel.send(`⚠️ **${message.author.username}** a été mute 10 min pour spam.`).then(m => setTimeout(() => m.delete().catch(() => {}), 5000));
      return;
    }
  }

  if (!message.content.startsWith(PREFIX)) return;
  const args = message.content.slice(PREFIX.length).trim().split(/ +/);
  const command = args.shift().toLowerCase();

  // ══════════════════════════════════════════════════════
  //  HELP
  // ══════════════════════════════════════════════════════
  if (command === 'help') {
    const embed = new EmbedBuilder()
      .setTitle('📋 Commandes disponibles')
      .setColor('#FF6B9D')
      .setThumbnail(client.user.displayAvatarURL())
      .addFields(
        { name: '🛡️ Modération (Staff)', value: '`+ban` `+kick` `+mute` `+unmute` `+warn` `+warnings` `+clearwarns` `+clear` `+lock` `+unlock` `+rank` `+unrank` `+announce`', inline: false },
        { name: '👤 Infos', value: '`+userinfo` `+serverinfo` `+botinfo` `+avatar` `+pic @user`', inline: false },
        { name: '🎉 Communauté', value: '`+poll` `+suggest` `+giveaway`', inline: false },
        { name: '🎮 Fun', value: '`+8ball` `+coinflip` `+rps` `+joke` `+love @user` `+marry @user` `+divorce` `+couple`', inline: false },
        { name: '🎫 Tickets', value: '`+ticket` — ouvre le panel\n`+addticket @user` — ajoute quelqu\'un au ticket', inline: false },
        { name: '🤖 IA', value: 'Mentionne le bot : `@Takashi ta question`', inline: false },
        { name: '⚙️ Config (Admin)', value: '`+setwelcome` `+setleave` `+setmodlogs` `+setmsglogs` `+setvoicelogs` `+setboostlogs` `+setsuggest` `+setstaffrole` `+setticketrole` `+setup`', inline: false },
      )
      .setFooter({ text: `Préfixe : ${PREFIX} • Mentionne-moi pour l'IA !` })
      .setTimestamp();
    return message.reply({ embeds: [embed] });
  }

  // ══════════════════════════════════════════════════════
  //  MODÉRATION (Staff ou Admin)
  // ══════════════════════════════════════════════════════
  if (command === 'ban') {
    if (!isStaff(message.member, message.guild)) return message.reply('❌ Réservé au staff.');
    if (!message.member.permissions.has(PermissionsBitField.Flags.BanMembers)) return message.reply('❌ Permission manquante.');
    const target = message.mentions.members.first();
    if (!target) return message.reply('❌ Mentionne un membre.');
    const reason = args.slice(1).join(' ') || 'Aucune raison';
    await target.ban({ reason }).catch(() => {});
    logMod(message.guild, `🔨 **Ban** : ${target.user.tag} par ${message.author.tag} — ${reason}`);
    return message.reply(`✅ **${target.user.tag}** banni.`);
  }

  if (command === 'kick') {
    if (!isStaff(message.member, message.guild)) return message.reply('❌ Réservé au staff.');
    const target = message.mentions.members.first();
    if (!target) return message.reply('❌ Mentionne un membre.');
    const reason = args.slice(1).join(' ') || 'Aucune raison';
    await target.kick(reason).catch(() => {});
    logMod(message.guild, `👢 **Kick** : ${target.user.tag} par ${message.author.tag} — ${reason}`);
    return message.reply(`✅ **${target.user.tag}** kické.`);
  }

  if (command === 'mute') {
    if (!isStaff(message.member, message.guild)) return message.reply('❌ Réservé au staff.');
    const target = message.mentions.members.first();
    if (!target) return message.reply('❌ Mentionne un membre.');
    const duration = parseInt(args[1]) || 10;
    await target.timeout(duration * 60 * 1000).catch(() => {});
    logMod(message.guild, `🔇 **Mute** ${duration}min : ${target.user.tag} par ${message.author.tag}`);
    return message.reply(`✅ **${target.user.tag}** mute ${duration} min.`);
  }

  if (command === 'unmute') {
    if (!isStaff(message.member, message.guild)) return message.reply('❌ Réservé au staff.');
    const target = message.mentions.members.first();
    if (!target) return message.reply('❌ Mentionne un membre.');
    await target.timeout(null).catch(() => {});
    return message.reply(`✅ **${target.user.tag}** unmute.`);
  }

  if (command === 'warn') {
    if (!isStaff(message.member, message.guild)) return message.reply('❌ Réservé au staff.');
    const target = message.mentions.members.first();
    if (!target) return message.reply('❌ Mentionne un membre.');
    const reason = args.slice(1).join(' ') || 'Aucune raison';
    const key = `${message.guild.id}-${target.id}`;
    if (!warnings[key]) warnings[key] = [];
    warnings[key].push({ reason, date: new Date().toISOString(), by: message.author.tag });
    saveJSON(WARNS_FILE, warnings);
    const count = warnings[key].length;
    message.reply(`⚠️ **${target.user.tag}** averti (${count}). Raison : ${reason}`);
    logMod(message.guild, `⚠️ **Warn** (${count}) : ${target.user.tag} par ${message.author.tag} — ${reason}`);
    if (count >= 5) { target.ban({ reason: 'Auto-ban 5 warns' }).catch(() => {}); message.channel.send(`🔨 **${target.user.tag}** banni auto (5 warns).`); }
    else if (count >= 3) { target.timeout(60 * 60 * 1000).catch(() => {}); message.channel.send(`🔇 **${target.user.tag}** mute 1h auto (3 warns).`); }
    return;
  }

  if (command === 'warnings') {
    const target = message.mentions.members.first() || message.member;
    const key = `${message.guild.id}-${target.id}`;
    const w = warnings[key];
    if (!w || w.length === 0) return message.reply(`✅ **${target.user.username}** n'a aucun warn.`);
    return message.reply(`⚠️ **Warns (${w.length}) :**\n${w.map((x, i) => `**${i+1}.** ${x.reason} — ${x.by}`).join('\n')}`);
  }

  if (command === 'clearwarns') {
    if (!isStaff(message.member, message.guild)) return message.reply('❌ Réservé au staff.');
    const target = message.mentions.members.first();
    if (!target) return message.reply('❌ Mentionne un membre.');
    delete warnings[`${message.guild.id}-${target.id}`];
    saveJSON(WARNS_FILE, warnings);
    return message.reply(`✅ Warns de **${target.user.username}** effacés.`);
  }

  if (command === 'clear') {
    if (!isStaff(message.member, message.guild)) return message.reply('❌ Réservé au staff.');
    const amount = Math.min(parseInt(args[0]) || 10, 100);
    await message.channel.bulkDelete(amount + 1, true).catch(() => {});
    message.channel.send(`✅ **${amount}** messages supprimés.`).then(m => setTimeout(() => m.delete().catch(() => {}), 3000));
    return;
  }

  if (command === 'lock') {
    if (!isStaff(message.member, message.guild)) return message.reply('❌ Réservé au staff.');
    await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: false });
    return message.reply('🔒 Salon verrouillé.');
  }

  if (command === 'unlock') {
    if (!isStaff(message.member, message.guild)) return message.reply('❌ Réservé au staff.');
    await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: null });
    return message.reply('🔓 Salon déverrouillé.');
  }

  if (command === 'rank') {
    if (!isStaff(message.member, message.guild)) return message.reply('❌ Réservé au staff.');
    const target = message.mentions.members.first();
    const roleName = args.slice(1).join(' ');
    if (!target || !roleName) return message.reply('❌ Usage : `+rank @user NomDuRôle`');
    const role = message.guild.roles.cache.find(r => r.name.toLowerCase() === roleName.toLowerCase());
    if (!role) return message.reply(`❌ Rôle **${roleName}** introuvable.`);
    await target.roles.add(role).catch(() => {});
    return message.reply(`✅ Rôle **${role.name}** donné à **${target.user.username}**.`);
  }

  if (command === 'unrank') {
    if (!isStaff(message.member, message.guild)) return message.reply('❌ Réservé au staff.');
    const target = message.mentions.members.first();
    const roleName = args.slice(1).join(' ');
    if (!target || !roleName) return message.reply('❌ Usage : `+unrank @user NomDuRôle`');
    const role = message.guild.roles.cache.find(r => r.name.toLowerCase() === roleName.toLowerCase());
    if (!role) return message.reply(`❌ Rôle **${roleName}** introuvable.`);
    await target.roles.remove(role).catch(() => {});
    return message.reply(`✅ Rôle **${role.name}** retiré à **${target.user.username}**.`);
  }

  if (command === 'announce' || command === 'annonce') {
    if (!isStaff(message.member, message.guild)) return message.reply('❌ Réservé au staff.');
    const text = args.join(' ');
    if (!text) return message.reply('❌ Donne un message.');
    const embed = new EmbedBuilder().setTitle('📢 Annonce').setDescription(text).setColor('#FF0000').setFooter({ text: `Par ${message.author.username}` }).setTimestamp();
    message.delete().catch(() => {});
    return message.channel.send({ content: '@everyone', embeds: [embed] });
  }

  // ══════════════════════════════════════════════════════
  //  INFOS
  // ══════════════════════════════════════════════════════
  if (command === 'userinfo') {
    const target = message.mentions.members.first() || message.member;
    return message.reply({ embeds: [new EmbedBuilder()
      .setTitle(`👤 ${target.user.username}`)
      .setThumbnail(target.user.displayAvatarURL({ dynamic: true, size: 256 }))
      .setColor('#5865F2')
      .addFields(
        { name: 'Tag', value: target.user.tag, inline: true },
        { name: 'ID', value: target.id, inline: true },
        { name: 'Discord', value: `<t:${Math.floor(target.user.createdTimestamp / 1000)}:R>`, inline: true },
        { name: 'Serveur', value: `<t:${Math.floor(target.joinedTimestamp / 1000)}:R>`, inline: true },
        { name: 'Rôles', value: target.roles.cache.filter(r => r.id !== message.guild.id).map(r => `<@&${r.id}>`).join(', ') || 'Aucun' },
      ).setTimestamp()
    ]});
  }

  if (command === 'serverinfo') {
    const g = message.guild;
    return message.reply({ embeds: [new EmbedBuilder()
      .setTitle(`🏠 ${g.name}`).setThumbnail(g.iconURL({ dynamic: true })).setColor('#43B581')
      .addFields(
        { name: 'ID', value: g.id, inline: true },
        { name: 'Membres', value: `${g.memberCount}`, inline: true },
        { name: 'Salons', value: `${g.channels.cache.size}`, inline: true },
        { name: 'Rôles', value: `${g.roles.cache.size}`, inline: true },
        { name: 'Créé', value: `<t:${Math.floor(g.createdTimestamp / 1000)}:R>`, inline: true },
        { name: 'Proprio', value: `<@${g.ownerId}>`, inline: true },
      ).setTimestamp()
    ]});
  }

  if (command === 'botinfo') {
    const up = process.uptime();
    return message.reply({ embeds: [new EmbedBuilder()
      .setTitle(`🤖 ${client.user.username}`).setThumbnail(client.user.displayAvatarURL()).setColor('#FF6B9D')
      .addFields(
        { name: 'Ping', value: `${client.ws.ping}ms`, inline: true },
        { name: 'Uptime', value: `${Math.floor(up/3600)}h ${Math.floor((up%3600)/60)}m`, inline: true },
        { name: 'Serveurs', value: `${client.guilds.cache.size}`, inline: true },
      ).setTimestamp()
    ]});
  }

  if (command === 'avatar' || command === 'pic') {
    const target = message.mentions.users.first() || message.author;
    const url = target.displayAvatarURL({ dynamic: true, size: 1024 });
    return message.reply({ embeds: [new EmbedBuilder()
      .setTitle(`📸 ${target.username}`).setImage(url).setColor('#FF6B9D').setURL(url)
      .setFooter({ text: `Demandé par ${message.author.username}` }).setTimestamp()
    ]});
  }

  // ══════════════════════════════════════════════════════
  //  FUN
  // ══════════════════════════════════════════════════════
  if (command === '8ball') {
    const responses = ['Oui absolument !','Non, mauvaise idée.','Peut-être...','Clairement oui !','Aucune chance.','C\'est flou, réessaie.','Mon instinct dit non.','Les signes pointent vers oui.'];
    const q = args.join(' ');
    if (!q) return message.reply('❌ Pose une question !');
    return message.reply({ embeds: [new EmbedBuilder().setTitle('🎱 Boule magique').setColor('#5865F2')
      .addFields({ name: 'Question', value: q }, { name: 'Réponse', value: responses[Math.floor(Math.random() * responses.length)] })]});
  }

  if (command === 'coinflip') return message.reply(Math.random() < 0.5 ? '🪙 Pile !' : '🪙 Face !');

  if (command === 'rps') {
    const choices = ['✊ Pierre', '✋ Feuille', '✌️ Ciseaux'];
    const map = { pierre: 0, feuille: 1, ciseaux: 2 };
    const userChoice = args[0]?.toLowerCase();
    if (!(userChoice in map)) return message.reply('❌ Usage : `+rps pierre/feuille/ciseaux`');
    const u = map[userChoice], b = Math.floor(Math.random() * 3);
    const result = u === b ? '🤝 Égalité !' : ((u - b + 3) % 3 === 1) ? '🎉 Tu gagnes !' : '😔 Tu perds !';
    return message.reply(`Tu : **${choices[u]}** | Moi : **${choices[b]}** — ${result}`);
  }

  if (command === 'joke') {
    const jokes = ['Pourquoi les plongeurs plongent-ils toujours en arrière ? Parce que sinon ils tomberaient dans le bateau !','C\'est l\'histoire d\'une vache dans un champ... Mais je ne vais pas vous la raconter, c\'est une histoire de pré.','Qu\'est-ce qu\'un canif ? Un petit fien !'];
    return message.reply(jokes[Math.floor(Math.random() * jokes.length)]);
  }

  if (command === 'love') {
    const target = message.mentions.users.first();
    if (!target) return message.reply('❌ Mentionne quelqu\'un !');
    if (target.id === message.author.id) return message.reply('💀 0% par défaut lol');
    const seed = (BigInt(message.author.id) + BigInt(target.id)).toString();
    const pct = parseInt(seed.slice(-2)) % 101;
    let emoji, comment;
    if (pct >= 90) { emoji = '💞'; comment = 'C\'est de l\'amour fou ! 🔥'; }
    else if (pct >= 70) { emoji = '❤️'; comment = 'Y\'a clairement quelque chose ! 😍'; }
    else if (pct >= 50) { emoji = '💛'; comment = 'Pas mal, à cultiver ! 🌱'; }
    else if (pct >= 30) { emoji = '🧡'; comment = 'C\'est timide mais c\'est là... 👀'; }
    else { emoji = '💔'; comment = 'Peut-être dans une autre vie 😭'; }
    const bar = '█'.repeat(Math.floor(pct / 10)) + '░'.repeat(10 - Math.floor(pct / 10));
    return message.reply({ embeds: [new EmbedBuilder()
      .setTitle(`${emoji} Compatibilité`)
      .setDescription(`**${message.author.username}** 💕 **${target.username}**\n\n\`[${bar}]\` **${pct}%**\n\n${comment}`)
      .setColor('#FF6B9D').setTimestamp()
    ]});
  }

  if (command === 'marry') {
    const marriages = loadJSON(MARRIAGES_FILE);
    const target = message.mentions.members.first();
    if (!target) return message.reply('❌ Mentionne quelqu\'un !');
    if (target.id === message.author.id || target.user.bot) return message.reply('❌ Impossible.');
    const ak = `${message.guild.id}-${message.author.id}`, tk = `${message.guild.id}-${target.id}`;
    if (marriages[ak]) return message.reply(`❌ Tu es déjà marié(e) avec <@${marriages[ak]}> !`);
    if (marriages[tk]) return message.reply(`❌ **${target.user.username}** est déjà marié(e) !`);
    marriages[ak] = target.id; marriages[tk] = message.author.id;
    saveJSON(MARRIAGES_FILE, marriages);
    return message.reply({ embeds: [new EmbedBuilder()
      .setTitle('💍 Mariage !').setColor('#FFD700')
      .setDescription(`**${message.author.username}** et **${target.user.username}** sont maintenant mariés ! 🥂🎊`)
      .setTimestamp()
    ]});
  }

  if (command === 'divorce') {
    const marriages = loadJSON(MARRIAGES_FILE);
    const ak = `${message.guild.id}-${message.author.id}`;
    const pid = marriages[ak];
    if (!pid) return message.reply('❌ T\'es même pas marié(e) 😭');
    delete marriages[ak]; delete marriages[`${message.guild.id}-${pid}`];
    saveJSON(MARRIAGES_FILE, marriages);
    return message.reply('💔 Divorce acté. C\'est triste...');
  }

  if (command === 'couple') {
    const marriages = loadJSON(MARRIAGES_FILE);
    const target = message.mentions.members.first() || message.member;
    const pid = marriages[`${message.guild.id}-${target.id}`];
    if (!pid) return message.reply(`💔 **${target.user.username}** n'est pas marié(e).`);
    const partner = await message.guild.members.fetch(pid).catch(() => null);
    return message.reply({ embeds: [new EmbedBuilder()
      .setTitle('💑 Couple').setColor('#FF6B9D')
      .setDescription(`**${target.user.username}** 💍 **${partner ? partner.user.username : 'quelqu\'un qui a quitté le serv'}**`)
      .setTimestamp()
    ]});
  }

  // ══════════════════════════════════════════════════════
  //  COMMUNAUTÉ
  // ══════════════════════════════════════════════════════
  if (command === 'poll') {
    const q = args.join(' ');
    if (!q) return message.reply('❌ Ex : `+poll Pizza ou burger ?`');
    const msg = await message.channel.send({ embeds: [new EmbedBuilder().setTitle('📊 Sondage').setDescription(`**${q}**`).setColor('#FFA500').setFooter({ text: `Par ${message.author.username}` }).setTimestamp()] });
    await msg.react('✅'); await msg.react('❌');
    return;
  }

  if (command === 'suggest') {
    const cfg = getGuildConfig(message.guild.id);
    const text = args.join(' ');
    if (!text) return message.reply('❌ Ex : `+suggest Ajouter un salon gaming`');
    const ch = cfg.suggestChannel ? message.guild.channels.cache.get(cfg.suggestChannel) : message.channel;
    if (!ch) return message.reply('❌ Salon suggestions non configuré.');
    const msg = await ch.send({ embeds: [new EmbedBuilder().setTitle('💡 Suggestion').setDescription(text).setColor('#00FF7F').setFooter({ text: `Par ${message.author.username}` }).setTimestamp()] });
    await msg.react('👍'); await msg.react('👎');
    if (ch.id !== message.channel.id) message.reply('✅ Suggestion envoyée !');
    return;
  }

  if (command === 'giveaway') {
    if (!isStaff(message.member, message.guild)) return message.reply('❌ Réservé au staff.');
    const duration = parseInt(args[0]);
    const prize = args.slice(1).join(' ');
    if (!duration || !prize) return message.reply('❌ Usage : `+giveaway <min> <lot>`');
    const endTime = Math.floor((Date.now() + duration * 60000) / 1000);
    const msg = await message.channel.send({ embeds: [new EmbedBuilder()
      .setTitle('🎉 GIVEAWAY 🎉')
      .setDescription(`**Lot : ${prize}**\n\nRéagis avec 🎉 !\nFin : <t:${endTime}:R>`)
      .setColor('#FFD700').setFooter({ text: `Par ${message.author.username}` }).setTimestamp(Date.now() + duration * 60000)
    ]});
    await msg.react('🎉');
    message.delete().catch(() => {});
    setTimeout(async () => {
      const fetched = await msg.fetch();
      const reaction = fetched.reactions.cache.get('🎉');
      if (!reaction) return message.channel.send('❌ Personne n\'a participé.');
      const users = await reaction.users.fetch();
      const participants = users.filter(u => !u.bot);
      if (participants.size === 0) return message.channel.send('❌ Aucun participant.');
      const winner = participants.random();
      message.channel.send({ embeds: [new EmbedBuilder().setTitle('🎉 Gagnant !').setDescription(`<@${winner.id}> gagne **${prize}** ! 🎊`).setColor('#FFD700').setTimestamp()] });
    }, duration * 60000);
    return;
  }

  // ══════════════════════════════════════════════════════
  //  TICKET PANEL + ADDTICKET
  // ══════════════════════════════════════════════════════
  if (command === 'ticket') {
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('ticket_support').setLabel('🎫 Support').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('ticket_report').setLabel('🚨 Report').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('ticket_question').setLabel('❓ Question').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('ticket_autre').setLabel('📝 Autre').setStyle(ButtonStyle.Success),
    );
    const embed = new EmbedBuilder()
      .setTitle('🎫 Système de tickets')
      .setDescription('Clique sur une catégorie pour ouvrir un ticket.\nUn membre du staff prendra en charge ta demande.')
      .setColor('#5865F2')
      .addFields(
        { name: '🎫 Support', value: 'Besoin d\'aide générale', inline: true },
        { name: '🚨 Report', value: 'Signaler un membre', inline: true },
        { name: '❓ Question', value: 'Poser une question', inline: true },
        { name: '📝 Autre', value: 'Autre demande', inline: true },
      )
      .setFooter({ text: 'Un seul ticket à la fois par personne.' })
      .setTimestamp();
    return message.reply({ embeds: [embed], components: [row] });
  }

  if (command === 'addticket') {
    if (!isStaff(message.member, message.guild)) return message.reply('❌ Réservé au staff.');
    const target = message.mentions.members.first();
    if (!target) return message.reply('❌ Mentionne un membre.');
    if (!message.channel.name.startsWith('ticket-')) return message.reply('❌ Cette commande est réservée aux tickets.');
    await message.channel.permissionOverwrites.edit(target.id, {
      ViewChannel: true, SendMessages: true, ReadMessageHistory: true
    }).catch(() => {});
    return message.reply(`✅ **${target.user.username}** ajouté au ticket.`);
  }

  // ══════════════════════════════════════════════════════
  //  CONFIG (Admin uniquement)
  // ══════════════════════════════════════════════════════
  const adminOnly = ['setwelcome','setleave','setmodlogs','setmsglogs','setvoicelogs','setboostlogs','setsuggest','setstaffrole','setticketrole','setup','say','embed'];
  if (adminOnly.includes(command) && !message.member.permissions.has(PermissionsBitField.Flags.Administrator))
    return message.reply('❌ Admin seulement.');

  if (command === 'setstaffrole') {
    const role = message.mentions.roles.first();
    if (!role) return message.reply('❌ Mentionne un rôle. Ex : `+setstaffrole @Staff`');
    getGuildConfig(message.guild.id).staffRole = role.id; saveConfig();
    return message.reply(`✅ Rôle staff défini : <@&${role.id}>`);
  }

  if (command === 'setticketrole') {
    const type = args[0]?.toLowerCase();
    const role = message.mentions.roles.first();
    const validTypes = ['support','report','question','autre'];
    if (!type || !validTypes.includes(type) || !role)
      return message.reply('❌ Usage : `+setticketrole support/report/question/autre @role`');
    getGuildConfig(message.guild.id)[`ticketRole_${type}`] = role.id; saveConfig();
    return message.reply(`✅ Rôle pour les tickets **${type}** : <@&${role.id}>`);
  }

  if (command === 'setwelcome') {
    const ch = message.mentions.channels.first() || message.channel;
    getGuildConfig(message.guild.id).welcomeChannel = ch.id; saveConfig();
    return message.reply(`✅ Bienvenue : <#${ch.id}>`);
  }
  if (command === 'setleave') {
    const ch = message.mentions.channels.first() || message.channel;
    getGuildConfig(message.guild.id).leaveChannel = ch.id; saveConfig();
    return message.reply(`✅ Départ : <#${ch.id}>`);
  }
  if (command === 'setmodlogs') {
    const ch = message.mentions.channels.first() || message.channel;
    getGuildConfig(message.guild.id).modLogsChannel = ch.id; saveConfig();
    return message.reply(`✅ Logs mod : <#${ch.id}>`);
  }
  if (command === 'setmsglogs') {
    const ch = message.mentions.channels.first() || message.channel;
    getGuildConfig(message.guild.id).msgLogsChannel = ch.id; saveConfig();
    return message.reply(`✅ Logs messages : <#${ch.id}>`);
  }
  if (command === 'setvoicelogs') {
    const ch = message.mentions.channels.first() || message.channel;
    getGuildConfig(message.guild.id).voiceLogsChannel = ch.id; saveConfig();
    return message.reply(`✅ Logs vocal : <#${ch.id}>`);
  }
  if (command === 'setboostlogs') {
    const ch = message.mentions.channels.first() || message.channel;
    getGuildConfig(message.guild.id).boostLogsChannel = ch.id; saveConfig();
    return message.reply(`✅ Logs boosts : <#${ch.id}>`);
  }
  if (command === 'setsuggest') {
    const ch = message.mentions.channels.first() || message.channel;
    getGuildConfig(message.guild.id).suggestChannel = ch.id; saveConfig();
    return message.reply(`✅ Suggestions : <#${ch.id}>`);
  }

  if (command === 'setup') {
    return message.reply({ embeds: [new EmbedBuilder()
      .setTitle('⚙️ Configuration')
      .setColor('#5865F2')
      .addFields(
        { name: '👥 Rôles', value: '`+setstaffrole @role` — rôle staff\n`+setticketrole support/report/question/autre @role` — rôle par catégorie', inline: false },
        { name: '📢 Salons', value: '`+setwelcome #salon`\n`+setleave #salon`\n`+setsuggest #salon`', inline: false },
        { name: '📋 Logs', value: '`+setmodlogs #salon`\n`+setmsglogs #salon`\n`+setvoicelogs #salon`\n`+setboostlogs #salon`', inline: false },
        { name: '🤖 Statut', value: '`/setstatus texte`', inline: false },
      ).setTimestamp()
    ]});
  }

  if (command === 'say') {
    const text = args.join(' ');
    if (!text) return message.reply('❌ Donne un message.');
    message.delete().catch(() => {});
    return message.channel.send(text);
  }

  if (command === 'embed') {
    const parts = args.join(' ').split('|');
    const title = parts[0]?.trim(), description = parts[1]?.trim();
    if (!title || !description) return message.reply('❌ Usage : `+embed Titre | Description`');
    message.delete().catch(() => {});
    return message.channel.send({ embeds: [new EmbedBuilder().setTitle(title).setDescription(description).setColor('#FF6B9D').setTimestamp()] });
  }
});

// ══════════════════════════════════════════════════════════
//  ANTI-CRASH
// ══════════════════════════════════════════════════════════
process.on('unhandledRejection', err => console.error('unhandledRejection:', err));
process.on('uncaughtException', err => console.error('uncaughtException:', err));

// ══════════════════════════════════════════════════════════
//  CONNEXION
// ══════════════════════════════════════════════════════════
client.login(process.env.DISCORD_TOKEN);

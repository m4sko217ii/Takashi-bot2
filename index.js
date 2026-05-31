// ============================================================
//  BOT DISCORD — index.js v3.0
//  Préfixe : +
//  Hébergement : Render 24/7
// ============================================================

const {
  Client, GatewayIntentBits, PermissionsBitField,
  EmbedBuilder, ActionRowBuilder, ButtonBuilder,
  ButtonStyle, ChannelType, ActivityType, REST, Routes
} = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource,
  AudioPlayerStatus } = require('@discordjs/voice');
const ytdl = require('@distube/ytdl-core');
const yts = require('yt-search');
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

// ─── File musicale ────────────────────────────────────────
const queues = new Map();

// ─── Anti-spam ────────────────────────────────────────────
const spamMap = new Map();

// ─── Statuts rotatifs ─────────────────────────────────────
const statuses = [
  { name: 'Préfixe : +help', type: ActivityType.Playing },
  { name: 'Modération 24/7', type: ActivityType.Watching },
  { name: '+help pour les commandes', type: ActivityType.Listening },
];
let statusIndex = 0;

// ══════════════════════════════════════════════════════════
//  SLASH COMMANDS — enregistrement
// ══════════════════════════════════════════════════════════
const slashCommands = [
  {
    name: 'setstatus',
    description: 'Change le statut du bot (Admin seulement)',
    options: [{ name: 'texte', description: 'Nouveau statut', type: 3, required: true }]
  }
];

async function registerSlashCommands() {
  if (!process.env.DISCORD_TOKEN || !process.env.CLIENT_ID) return;
  try {
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    // Supprime toutes les anciennes commandes globales et réenregistre
    await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: slashCommands });
    console.log('✅ Slash commands enregistrées.');
  } catch (err) {
    console.error('Erreur slash commands:', err);
  }
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
//  SLASH COMMANDS — handler
// ══════════════════════════════════════════════════════════
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'setstatus') {
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator))
      return interaction.reply({ content: '❌ Réservé aux admins.', ephemeral: true });
    const texte = interaction.options.getString('texte');
    client.user.setActivity(texte, { type: ActivityType.Playing });
    return interaction.reply({ content: `✅ Statut changé en **${texte}**`, ephemeral: true });
  }
});

// ══════════════════════════════════════════════════════════
//  LOGS HELPERS
// ══════════════════════════════════════════════════════════
function logMod(guild, text) {
  const cfg = getGuildConfig(guild.id);
  const ch = guild.channels.cache.get(cfg.modLogsChannel);
  if (!ch) return;
  const embed = new EmbedBuilder().setDescription(text).setColor('#FF4500').setTimestamp();
  ch.send({ embeds: [embed] }).catch(() => {});
}
function logMsg(guild, text) {
  const cfg = getGuildConfig(guild.id);
  const ch = guild.channels.cache.get(cfg.msgLogsChannel);
  if (!ch) return;
  const embed = new EmbedBuilder().setDescription(text).setColor('#FFA500').setTimestamp();
  ch.send({ embeds: [embed] }).catch(() => {});
}
function logVoice(guild, text) {
  const cfg = getGuildConfig(guild.id);
  const ch = guild.channels.cache.get(cfg.voiceLogsChannel);
  if (!ch) return;
  const embed = new EmbedBuilder().setDescription(text).setColor('#5865F2').setTimestamp();
  ch.send({ embeds: [embed] }).catch(() => {});
}
function logBoost(guild, text) {
  const cfg = getGuildConfig(guild.id);
  const ch = guild.channels.cache.get(cfg.boostLogsChannel);
  if (!ch) return;
  const embed = new EmbedBuilder().setDescription(text).setColor('#FF73FA').setTimestamp();
  ch.send({ embeds: [embed] }).catch(() => {});
}

// ══════════════════════════════════════════════════════════
//  LOGS ÉVÉNEMENTS AUTOMATIQUES
// ══════════════════════════════════════════════════════════

// Message supprimé
client.on('messageDelete', message => {
  if (!message.guild || message.author?.bot) return;
  logMsg(message.guild, `🗑️ **Message supprimé** de <@${message.author?.id}> dans <#${message.channel.id}>\n\`\`\`${(message.content || 'Contenu inconnu').substring(0, 900)}\`\`\``);
});

// Message édité
client.on('messageUpdate', (oldMsg, newMsg) => {
  if (!oldMsg.guild || oldMsg.author?.bot) return;
  if (oldMsg.content === newMsg.content) return;
  logMsg(oldMsg.guild, `✏️ **Message édité** par <@${oldMsg.author?.id}> dans <#${oldMsg.channel.id}>\n**Avant :** ${(oldMsg.content || '').substring(0, 400)}\n**Après :** ${(newMsg.content || '').substring(0, 400)}`);
});

// Logs vocal
client.on('voiceStateUpdate', (oldState, newState) => {
  const member = newState.member || oldState.member;
  if (!member || member.user.bot) return;
  const guild = newState.guild || oldState.guild;

  if (!oldState.channel && newState.channel) {
    logVoice(guild, `🔊 **${member.user.tag}** a rejoint **${newState.channel.name}**`);
  } else if (oldState.channel && !newState.channel) {
    logVoice(guild, `🔇 **${member.user.tag}** a quitté **${oldState.channel.name}**`);
  } else if (oldState.channel && newState.channel && oldState.channel.id !== newState.channel.id) {
    logVoice(guild, `🔀 **${member.user.tag}** a changé de salon : **${oldState.channel.name}** → **${newState.channel.name}**`);
  }
});

// Boost logs
client.on('guildMemberUpdate', (oldMember, newMember) => {
  const wasBoost = oldMember.premiumSince;
  const isBoost = newMember.premiumSince;
  if (!wasBoost && isBoost) {
    logBoost(newMember.guild, `🚀 **${newMember.user.tag}** vient de booster le serveur ! 💎`);
  }
});

// ══════════════════════════════════════════════════════════
//  WELCOME / LEAVE
// ══════════════════════════════════════════════════════════
client.on('guildMemberAdd', async member => {
  const cfg = getGuildConfig(member.guild.id);
  if (!cfg.welcomeChannel) return;
  const channel = member.guild.channels.cache.get(cfg.welcomeChannel);
  if (!channel) return;
  const embed = new EmbedBuilder()
    .setTitle('🌸 Bienvenue !')
    .setDescription(`Salut **${member.user.username}** ! Bienvenue sur **${member.guild.name}** 🎌\nTu es le membre **#${member.guild.memberCount}**.`)
    .setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 256 }))
    .setColor('#FF6B9D')
    .setImage('https://media.giphy.com/media/du3J3cXyzhj75IOgvA/giphy.gif')
    .setTimestamp()
    .setFooter({ text: member.guild.name, iconURL: member.guild.iconURL({ dynamic: true }) });
  channel.send({ embeds: [embed] });
});

client.on('guildMemberRemove', async member => {
  const cfg = getGuildConfig(member.guild.id);
  if (!cfg.leaveChannel) return;
  const channel = member.guild.channels.cache.get(cfg.leaveChannel);
  if (!channel) return;
  const embed = new EmbedBuilder()
    .setTitle('👋 Au revoir')
    .setDescription(`**${member.user.username}** vient de quitter le serveur.`)
    .setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 256 }))
    .setColor('#888888')
    .setTimestamp();
  channel.send({ embeds: [embed] });
});

// ══════════════════════════════════════════════════════════
//  MESSAGE CREATE
// ══════════════════════════════════════════════════════════
client.on('messageCreate', async message => {
  if (message.author.bot || !message.guild) return;

  // ── IA : réponse quand on mentionne le bot ──────────────
  if (message.mentions.has(client.user) && !message.content.startsWith(PREFIX)) {
    const question = message.content.replace(`<@${client.user.id}>`, '').trim();
    if (!question) return message.reply('Oui ? Tu veux me poser une question ? 👀');

    const typing = await message.channel.sendTyping();
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 500,
          system: 'Tu es Takashi, un assistant Discord cool, décontracté et un peu anime. Tu réponds en français, de façon courte et sympa. Pas plus de 3-4 phrases.',
          messages: [{ role: 'user', content: question }]
        })
      });
      const data = await response.json();
      const reply = data.content?.[0]?.text || 'Je sais pas trop là... 🤔';
      return message.reply(reply.substring(0, 1900));
    } catch {
      return message.reply('Oups, je suis un peu dans les choux là 😅 Réessaie !');
    }
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
        { name: '🛡️ Modération', value: '`+ban` `+kick` `+mute` `+unmute` `+warn` `+warnings` `+clearwarns` `+clear` `+lock` `+unlock`', inline: false },
        { name: '👤 Infos', value: '`+userinfo` `+serverinfo` `+botinfo` `+avatar` `+pic @user`', inline: false },
        { name: '🎵 Musique', value: '`+play` `+skip` `+stop` `+queue` `+pause` `+resume` `+nowplaying`', inline: false },
        { name: '🎉 Communauté', value: '`+poll` `+announce` `+suggest` `+rank` `+unrank` `+giveaway`', inline: false },
        { name: '🎮 Fun', value: '`+8ball` `+coinflip` `+rps` `+joke` `+love @user` `+marry @user` `+divorce` `+couple`', inline: false },
        { name: '🎫 Tickets', value: '`+ticket`', inline: false },
        { name: '🤖 IA', value: 'Mentionne le bot : `@Takashi ta question`', inline: false },
        { name: '⚙️ Config', value: '`+setwelcome` `+setleave` `+setmodlogs` `+setmsglogs` `+setvoicelogs` `+setboostlogs` `+setsuggest` `+setup`', inline: false },
      )
      .setFooter({ text: `Préfixe : ${PREFIX} • Mentionne-moi pour l'IA !` })
      .setTimestamp();
    return message.reply({ embeds: [embed] });
  }

  // ══════════════════════════════════════════════════════
  //  MODÉRATION
  // ══════════════════════════════════════════════════════
  if (command === 'ban') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.BanMembers))
      return message.reply('❌ Permission refusée.');
    const target = message.mentions.members.first();
    if (!target) return message.reply('❌ Mentionne un membre.');
    const reason = args.slice(1).join(' ') || 'Aucune raison';
    await target.ban({ reason }).catch(() => {});
    logMod(message.guild, `🔨 **Ban** : ${target.user.tag} par ${message.author.tag} — ${reason}`);
    return message.reply(`✅ **${target.user.tag}** banni. Raison : ${reason}`);
  }

  if (command === 'kick') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.KickMembers))
      return message.reply('❌ Permission refusée.');
    const target = message.mentions.members.first();
    if (!target) return message.reply('❌ Mentionne un membre.');
    const reason = args.slice(1).join(' ') || 'Aucune raison';
    await target.kick(reason).catch(() => {});
    logMod(message.guild, `👢 **Kick** : ${target.user.tag} par ${message.author.tag} — ${reason}`);
    return message.reply(`✅ **${target.user.tag}** kické.`);
  }

  if (command === 'mute') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.ModerateMembers))
      return message.reply('❌ Permission refusée.');
    const target = message.mentions.members.first();
    if (!target) return message.reply('❌ Mentionne un membre.');
    const duration = parseInt(args[1]) || 10;
    await target.timeout(duration * 60 * 1000, 'Mute').catch(() => {});
    logMod(message.guild, `🔇 **Mute** ${duration}min : ${target.user.tag} par ${message.author.tag}`);
    return message.reply(`✅ **${target.user.tag}** mute ${duration} minutes.`);
  }

  if (command === 'unmute') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.ModerateMembers))
      return message.reply('❌ Permission refusée.');
    const target = message.mentions.members.first();
    if (!target) return message.reply('❌ Mentionne un membre.');
    await target.timeout(null).catch(() => {});
    return message.reply(`✅ **${target.user.tag}** unmute.`);
  }

  if (command === 'warn') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.ModerateMembers))
      return message.reply('❌ Permission refusée.');
    const target = message.mentions.members.first();
    if (!target) return message.reply('❌ Mentionne un membre.');
    const reason = args.slice(1).join(' ') || 'Aucune raison';
    const key = `${message.guild.id}-${target.id}`;
    if (!warnings[key]) warnings[key] = [];
    warnings[key].push({ reason, date: new Date().toISOString(), by: message.author.tag });
    saveJSON(WARNS_FILE, warnings);
    const count = warnings[key].length;
    message.reply(`⚠️ **${target.user.tag}** averti. Total : **${count}**\nRaison : ${reason}`);
    logMod(message.guild, `⚠️ **Warn** (${count}) : ${target.user.tag} par ${message.author.tag} — ${reason}`);
    if (count >= 5) { target.ban({ reason: 'Auto-ban : 5 warns' }).catch(() => {}); message.channel.send(`🔨 **${target.user.tag}** banni automatiquement (5 warns).`); }
    else if (count >= 3) { target.timeout(60 * 60 * 1000, 'Auto-mute : 3 warns').catch(() => {}); message.channel.send(`🔇 **${target.user.tag}** mute 1h automatiquement (3 warns).`); }
    return;
  }

  if (command === 'warnings') {
    const target = message.mentions.members.first() || message.member;
    const key = `${message.guild.id}-${target.id}`;
    const w = warnings[key];
    if (!w || w.length === 0) return message.reply(`✅ **${target.user.username}** n'a aucun avertissement.`);
    const list = w.map((x, i) => `**${i + 1}.** ${x.reason} — par ${x.by}`).join('\n');
    return message.reply(`⚠️ **Warns de ${target.user.username}** (${w.length}) :\n${list}`);
  }

  if (command === 'clearwarns') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.ModerateMembers))
      return message.reply('❌ Permission refusée.');
    const target = message.mentions.members.first();
    if (!target) return message.reply('❌ Mentionne un membre.');
    delete warnings[`${message.guild.id}-${target.id}`];
    saveJSON(WARNS_FILE, warnings);
    return message.reply(`✅ Warns de **${target.user.username}** effacés.`);
  }

  if (command === 'clear') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.ManageMessages))
      return message.reply('❌ Permission refusée.');
    const amount = Math.min(parseInt(args[0]) || 10, 100);
    await message.channel.bulkDelete(amount + 1, true).catch(() => {});
    message.channel.send(`✅ **${amount}** messages supprimés.`).then(m => setTimeout(() => m.delete().catch(() => {}), 3000));
    return;
  }

  if (command === 'lock') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.ManageChannels))
      return message.reply('❌ Permission refusée.');
    await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: false });
    return message.reply('🔒 Salon verrouillé.');
  }

  if (command === 'unlock') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.ManageChannels))
      return message.reply('❌ Permission refusée.');
    await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: null });
    return message.reply('🔓 Salon déverrouillé.');
  }

  // ══════════════════════════════════════════════════════
  //  INFOS
  // ══════════════════════════════════════════════════════
  if (command === 'userinfo') {
    const target = message.mentions.members.first() || message.member;
    const embed = new EmbedBuilder()
      .setTitle(`👤 ${target.user.username}`)
      .setThumbnail(target.user.displayAvatarURL({ dynamic: true, size: 256 }))
      .setColor('#5865F2')
      .addFields(
        { name: 'Tag', value: target.user.tag, inline: true },
        { name: 'ID', value: target.id, inline: true },
        { name: 'Rejoint Discord', value: `<t:${Math.floor(target.user.createdTimestamp / 1000)}:R>`, inline: true },
        { name: 'Rejoint le serveur', value: `<t:${Math.floor(target.joinedTimestamp / 1000)}:R>`, inline: true },
        { name: 'Rôles', value: target.roles.cache.filter(r => r.id !== message.guild.id).map(r => `<@&${r.id}>`).join(', ') || 'Aucun', inline: false },
      ).setTimestamp();
    return message.reply({ embeds: [embed] });
  }

  if (command === 'serverinfo') {
    const g = message.guild;
    const embed = new EmbedBuilder()
      .setTitle(`🏠 ${g.name}`)
      .setThumbnail(g.iconURL({ dynamic: true }))
      .setColor('#43B581')
      .addFields(
        { name: 'ID', value: g.id, inline: true },
        { name: 'Membres', value: `${g.memberCount}`, inline: true },
        { name: 'Salons', value: `${g.channels.cache.size}`, inline: true },
        { name: 'Rôles', value: `${g.roles.cache.size}`, inline: true },
        { name: 'Créé', value: `<t:${Math.floor(g.createdTimestamp / 1000)}:R>`, inline: true },
        { name: 'Propriétaire', value: `<@${g.ownerId}>`, inline: true },
      ).setTimestamp();
    return message.reply({ embeds: [embed] });
  }

  if (command === 'botinfo') {
    const uptime = process.uptime();
    const h = Math.floor(uptime / 3600), m = Math.floor((uptime % 3600) / 60), s = Math.floor(uptime % 60);
    const embed = new EmbedBuilder()
      .setTitle(`🤖 ${client.user.username}`)
      .setThumbnail(client.user.displayAvatarURL())
      .setColor('#FF6B9D')
      .addFields(
        { name: 'Ping', value: `${client.ws.ping}ms`, inline: true },
        { name: 'Uptime', value: `${h}h ${m}m ${s}s`, inline: true },
        { name: 'Serveurs', value: `${client.guilds.cache.size}`, inline: true },
      ).setTimestamp();
    return message.reply({ embeds: [embed] });
  }

  if (command === 'avatar') {
    const target = message.mentions.users.first() || message.author;
    const embed = new EmbedBuilder()
      .setTitle(`🖼️ Avatar de ${target.username}`)
      .setImage(target.displayAvatarURL({ dynamic: true, size: 1024 }))
      .setColor('#FF6B9D');
    return message.reply({ embeds: [embed] });
  }

  if (command === 'pic') {
    const target = message.mentions.users.first() || message.author;
    const avatarURL = target.displayAvatarURL({ dynamic: true, size: 1024 });
    const embed = new EmbedBuilder()
      .setTitle(`📸 Photo de profil — ${target.username}`)
      .setImage(avatarURL)
      .setColor('#FF6B9D')
      .setURL(avatarURL)
      .setFooter({ text: `Demandé par ${message.author.username}` })
      .setTimestamp();
    return message.reply({ embeds: [embed] });
  }

  // ══════════════════════════════════════════════════════
  //  FUN
  // ══════════════════════════════════════════════════════
  if (command === '8ball') {
    const responses = ['Oui absolument !', 'Non, mauvaise idée.', 'Peut-être...', 'Clairement oui !', 'Aucune chance.', 'C\'est flou, réessaie.', 'Mon instinct dit non.', 'Les signes pointent vers oui.', 'Concentre-toi et redemande.', 'Mieux vaut ne pas te le dire.'];
    const q = args.join(' ');
    if (!q) return message.reply('❌ Pose une question ! Ex : `+8ball Est-ce que je vais réussir ?`');
    const embed = new EmbedBuilder()
      .setTitle('🎱 Boule magique')
      .addFields({ name: 'Question', value: q }, { name: 'Réponse', value: responses[Math.floor(Math.random() * responses.length)] })
      .setColor('#5865F2');
    return message.reply({ embeds: [embed] });
  }

  if (command === 'coinflip') {
    const result = Math.random() < 0.5 ? '🪙 Pile !' : '🪙 Face !';
    return message.reply(result);
  }

  if (command === 'rps') {
    const choices = ['✊ Pierre', '✋ Feuille', '✌️ Ciseaux'];
    const bot = choices[Math.floor(Math.random() * 3)];
    const user = args[0]?.toLowerCase();
    const map = { 'pierre': 0, 'feuille': 1, 'ciseaux': 2 };
    if (!(user in map)) return message.reply('❌ Usage : `+rps pierre/feuille/ciseaux`');
    const u = map[user], b = choices.indexOf(bot);
    let result = u === b ? '🤝 Égalité !' : ((u - b + 3) % 3 === 1) ? '🎉 Tu gagnes !' : '😔 Tu perds !';
    return message.reply(`Tu : **${choices[u]}** | Moi : **${bot}** — ${result}`);
  }

  // LOVE — pourcentage d'amour
  if (command === 'love') {
    const target = message.mentions.users.first();
    if (!target) return message.reply('❌ Mentionne quelqu\'un ! Ex : `+love @user`');
    if (target.id === message.author.id) return message.reply('💀 T\'es en train de te tester toi-même... 0% par défaut lol');

    // Score stable basé sur les IDs (toujours le même résultat pour le même couple)
    const seed = (BigInt(message.author.id) + BigInt(target.id)).toString();
    const score = parseInt(seed.slice(-2)) || Math.floor(Math.random() * 101);
    const pct = score % 101;

    let emoji, comment;
    if (pct >= 90) { emoji = '💞'; comment = 'C\'est de l\'amour fou ! 🔥'; }
    else if (pct >= 70) { emoji = '❤️'; comment = 'Y\'a clairement quelque chose là ! 😍'; }
    else if (pct >= 50) { emoji = '💛'; comment = 'Pas mal, à cultiver ! 🌱'; }
    else if (pct >= 30) { emoji = '🧡'; comment = 'C\'est timide mais c\'est là... 👀'; }
    else { emoji = '💔'; comment = 'Aïe... Peut-être dans une autre vie 😭'; }

    const bar = '█'.repeat(Math.floor(pct / 10)) + '░'.repeat(10 - Math.floor(pct / 10));

    const embed = new EmbedBuilder()
      .setTitle(`${emoji} Compatibilité amoureuse`)
      .setDescription(`**${message.author.username}** 💕 **${target.username}**\n\n\`[${bar}]\` **${pct}%**\n\n${comment}`)
      .setColor('#FF6B9D')
      .setTimestamp();
    return message.reply({ embeds: [embed] });
  }

  // MARRY — se marier
  if (command === 'marry') {
    const marriages = loadJSON('./marriages.json');
    const target = message.mentions.members.first();
    if (!target) return message.reply('❌ Mentionne quelqu\'un ! Ex : `+marry @user`');
    if (target.id === message.author.id) return message.reply('❌ Tu peux pas te marier avec toi-même 💀');
    if (target.user.bot) return message.reply('❌ Tu peux pas te marier avec un bot 🤖');

    const authorKey = `${message.guild.id}-${message.author.id}`;
    const targetKey = `${message.guild.id}-${target.id}`;

    if (marriages[authorKey]) return message.reply(`❌ Tu es déjà marié(e) avec <@${marriages[authorKey]}> ! Divorce d'abord avec \`+divorce\`.`);
    if (marriages[targetKey]) return message.reply(`❌ **${target.user.username}** est déjà marié(e) !`);

    marriages[authorKey] = target.id;
    marriages[targetKey] = message.author.id;
    saveJSON('./marriages.json', marriages);

    const embed = new EmbedBuilder()
      .setTitle('💍 Mariage !')
      .setDescription(`**${message.author.username}** et **${target.user.username}** sont maintenant mariés ! 🥂\n\nFélicitations à vous deux ! 🎊`)
      .setColor('#FFD700')
      .setThumbnail(target.user.displayAvatarURL({ dynamic: true }))
      .setTimestamp();
    return message.reply({ embeds: [embed] });
  }

  // DIVORCE
  if (command === 'divorce') {
    const marriages = loadJSON('./marriages.json');
    const authorKey = `${message.guild.id}-${message.author.id}`;
    const partnerId = marriages[authorKey];
    if (!partnerId) return message.reply('❌ T\'es même pas marié(e) 😭');

    const partnerKey = `${message.guild.id}-${partnerId}`;
    delete marriages[authorKey];
    delete marriages[partnerKey];
    saveJSON('./marriages.json', marriages);

    return message.reply(`💔 Tu as divorcé. C'est triste mais c'est la vie...`);
  }

  // COUPLE — voir avec qui on est marié
  if (command === 'couple') {
    const marriages = loadJSON('./marriages.json');
    const target = message.mentions.members.first() || message.member;
    const key = `${message.guild.id}-${target.id}`;
    const partnerId = marriages[key];
    if (!partnerId) return message.reply(`💔 **${target.user.username}** n'est pas marié(e).`);

    const partner = await message.guild.members.fetch(partnerId).catch(() => null);
    const embed = new EmbedBuilder()
      .setTitle('💑 Couple')
      .setDescription(`**${target.user.username}** est marié(e) avec **${partner ? partner.user.username : 'quelqu\'un qui a quitté le serv'}** 💍`)
      .setColor('#FF6B9D')
      .setTimestamp();
    return message.reply({ embeds: [embed] });
  }

  if (command === 'joke') {
    const jokes = [
      'Pourquoi les plongeurs plongent-ils toujours en arrière ? Parce que sinon ils tomberaient dans le bateau !',
      'C\'est l\'histoire d\'une vache dans un champ... Mais je ne vais pas vous la raconter, c\'est une histoire de pré.',
      'Qu\'est-ce qu\'un canif ? Un petit fien !',
      'Pourquoi les lions mangent-ils crus ? Parce qu\'ils ne savent pas cuisiner !',
      'C\'est deux sardines dans l\'huile. La première dit à la seconde : tu veux qu\'on aille nager ? L\'autre répond : t\'es folle, on va sentir l\'homme !',
    ];
    return message.reply(jokes[Math.floor(Math.random() * jokes.length)]);
  }

  // ══════════════════════════════════════════════════════
  //  COMMUNAUTÉ
  // ══════════════════════════════════════════════════════
  if (command === 'poll') {
    const question = args.join(' ');
    if (!question) return message.reply('❌ Ex : `+poll Pizza ou burger ?`');
    const embed = new EmbedBuilder()
      .setTitle('📊 Sondage')
      .setDescription(`**${question}**`)
      .setColor('#FFA500')
      .setFooter({ text: `Par ${message.author.username}` })
      .setTimestamp();
    const msg = await message.channel.send({ embeds: [embed] });
    await msg.react('✅'); await msg.react('❌');
    return;
  }

  if (command === 'announce' || command === 'annonce') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.ManageMessages))
      return message.reply('❌ Permission refusée.');
    const text = args.join(' ');
    if (!text) return message.reply('❌ Donne un message.');
    const embed = new EmbedBuilder()
      .setTitle('📢 Annonce')
      .setDescription(text)
      .setColor('#FF0000')
      .setFooter({ text: `Par ${message.author.username}` })
      .setTimestamp();
    message.delete().catch(() => {});
    return message.channel.send({ content: '@everyone', embeds: [embed] });
  }

  if (command === 'suggest') {
    const cfg = getGuildConfig(message.guild.id);
    const text = args.join(' ');
    if (!text) return message.reply('❌ Ex : `+suggest Ajouter un salon gaming`');
    const embed = new EmbedBuilder()
      .setTitle('💡 Nouvelle suggestion')
      .setDescription(text)
      .setColor('#00FF7F')
      .setFooter({ text: `Par ${message.author.username}` })
      .setTimestamp();
    const ch = cfg.suggestChannel ? message.guild.channels.cache.get(cfg.suggestChannel) : message.channel;
    if (!ch) return message.reply('❌ Salon de suggestions non configuré.');
    const msg = await ch.send({ embeds: [embed] });
    await msg.react('👍'); await msg.react('👎');
    if (ch.id !== message.channel.id) message.reply('✅ Suggestion envoyée !');
    return;
  }

  if (command === 'rank') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.ManageRoles))
      return message.reply('❌ Permission refusée.');
    const target = message.mentions.members.first();
    const roleName = args.slice(1).join(' ');
    if (!target || !roleName) return message.reply('❌ Usage : `+rank @user NomDuRôle`');
    const role = message.guild.roles.cache.find(r => r.name.toLowerCase() === roleName.toLowerCase());
    if (!role) return message.reply(`❌ Rôle **${roleName}** introuvable.`);
    await target.roles.add(role).catch(() => {});
    return message.reply(`✅ Rôle **${role.name}** donné à **${target.user.username}**.`);
  }

  if (command === 'unrank') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.ManageRoles))
      return message.reply('❌ Permission refusée.');
    const target = message.mentions.members.first();
    const roleName = args.slice(1).join(' ');
    if (!target || !roleName) return message.reply('❌ Usage : `+unrank @user NomDuRôle`');
    const role = message.guild.roles.cache.find(r => r.name.toLowerCase() === roleName.toLowerCase());
    if (!role) return message.reply(`❌ Rôle **${roleName}** introuvable.`);
    await target.roles.remove(role).catch(() => {});
    return message.reply(`✅ Rôle **${role.name}** retiré à **${target.user.username}**.`);
  }

  if (command === 'giveaway') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.ManageMessages))
      return message.reply('❌ Usage : `+giveaway <durée en min> <lot>`');
    const duration = parseInt(args[0]);
    const prize = args.slice(1).join(' ');
    if (!duration || !prize) return message.reply('❌ Usage : `+giveaway 10 Nitro`');
    const endTime = Math.floor((Date.now() + duration * 60000) / 1000);
    const embed = new EmbedBuilder()
      .setTitle('🎉 GIVEAWAY 🎉')
      .setDescription(`**Lot : ${prize}**\n\nRéagis avec 🎉 pour participer !\nFin : <t:${endTime}:R>`)
      .setColor('#FFD700')
      .setFooter({ text: `Organisé par ${message.author.username}` })
      .setTimestamp(Date.now() + duration * 60000);
    const msg = await message.channel.send({ embeds: [embed] });
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
      const winEmbed = new EmbedBuilder()
        .setTitle('🎉 Giveaway terminé !')
        .setDescription(`Gagnant : <@${winner.id}> 🎊\nLot : **${prize}**`)
        .setColor('#FFD700').setTimestamp();
      message.channel.send({ embeds: [winEmbed] });
    }, duration * 60000);
    return;
  }

  // ══════════════════════════════════════════════════════
  //  TICKETS
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
      .setDescription('Clique sur un bouton pour ouvrir un ticket.')
      .setColor('#5865F2');
    return message.reply({ embeds: [embed], components: [row] });
  }

  // ══════════════════════════════════════════════════════
  //  MUSIQUE
  // ══════════════════════════════════════════════════════
  if (command === 'play') {
    const query = args.join(' ');
    if (!query) return message.reply('❌ Ex : `+play Naruto OST`');
    if (!message.member.voice.channel) return message.reply('❌ Tu dois être dans un salon vocal.');
    let videoUrl;
    try {
      if (query.startsWith('http')) { videoUrl = query; }
      else {
        const res = await yts(query);
        const video = res.videos[0];
        if (!video) return message.reply('❌ Aucun résultat.');
        videoUrl = video.url;
      }
    } catch { return message.reply('❌ Erreur lors de la recherche.'); }
    let queue = queues.get(message.guild.id);
    if (!queue) {
      const connection = joinVoiceChannel({ channelId: message.member.voice.channel.id, guildId: message.guild.id, adapterCreator: message.guild.voiceAdapterCreator });
      const player = createAudioPlayer();
      connection.subscribe(player);
      queue = { connection, player, songs: [], textChannel: message.channel };
      queues.set(message.guild.id, queue);
      player.on(AudioPlayerStatus.Idle, () => { queue.songs.shift(); if (queue.songs.length > 0) playNext(message.guild.id); else { queue.connection.destroy(); queues.delete(message.guild.id); } });
      player.on('error', () => { queue.songs.shift(); if (queue.songs.length > 0) playNext(message.guild.id); else { queue.connection.destroy(); queues.delete(message.guild.id); } });
    }
    queue.songs.push(videoUrl);
    if (queue.songs.length === 1) playNext(message.guild.id);
    else message.reply(`✅ Ajouté à la file : ${videoUrl}`);
    return;
  }

  if (command === 'skip') { const q = queues.get(message.guild.id); if (!q) return message.reply('❌ Rien en cours.'); q.player.stop(); return message.reply('⏭️ Skippé.'); }
  if (command === 'stop') { const q = queues.get(message.guild.id); if (!q) return message.reply('❌ Rien en cours.'); q.songs = []; q.player.stop(); q.connection.destroy(); queues.delete(message.guild.id); return message.reply('⏹️ Arrêté.'); }
  if (command === 'pause') { const q = queues.get(message.guild.id); if (!q) return message.reply('❌ Rien en cours.'); q.player.pause(); return message.reply('⏸️ En pause.'); }
  if (command === 'resume') { const q = queues.get(message.guild.id); if (!q) return message.reply('❌ Rien en cours.'); q.player.unpause(); return message.reply('▶️ Repris.'); }
  if (command === 'queue') { const q = queues.get(message.guild.id); if (!q || q.songs.length === 0) return message.reply('❌ File vide.'); return message.reply(`🎵 **File :**\n${q.songs.slice(0, 10).map((s, i) => `**${i + 1}.** ${s}`).join('\n')}`); }
  if (command === 'nowplaying' || command === 'np') { const q = queues.get(message.guild.id); if (!q || q.songs.length === 0) return message.reply('❌ Rien en cours.'); return message.reply(`🎵 En cours : ${q.songs[0]}`); }

  // ══════════════════════════════════════════════════════
  //  CONFIG
  // ══════════════════════════════════════════════════════
  if (command === 'setwelcome') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply('❌ Admin seulement.');
    const ch = message.mentions.channels.first() || message.channel;
    getGuildConfig(message.guild.id).welcomeChannel = ch.id; saveConfig();
    return message.reply(`✅ Salon de bienvenue : <#${ch.id}>`);
  }
  if (command === 'setleave') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply('❌ Admin seulement.');
    const ch = message.mentions.channels.first() || message.channel;
    getGuildConfig(message.guild.id).leaveChannel = ch.id; saveConfig();
    return message.reply(`✅ Salon de départ : <#${ch.id}>`);
  }
  if (command === 'setmodlogs') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply('❌ Admin seulement.');
    const ch = message.mentions.channels.first() || message.channel;
    getGuildConfig(message.guild.id).modLogsChannel = ch.id; saveConfig();
    return message.reply(`✅ Logs de modération : <#${ch.id}>`);
  }
  if (command === 'setmsglogs') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply('❌ Admin seulement.');
    const ch = message.mentions.channels.first() || message.channel;
    getGuildConfig(message.guild.id).msgLogsChannel = ch.id; saveConfig();
    return message.reply(`✅ Logs messages : <#${ch.id}>`);
  }
  if (command === 'setvoicelogs') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply('❌ Admin seulement.');
    const ch = message.mentions.channels.first() || message.channel;
    getGuildConfig(message.guild.id).voiceLogsChannel = ch.id; saveConfig();
    return message.reply(`✅ Logs vocal : <#${ch.id}>`);
  }
  if (command === 'setboostlogs') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply('❌ Admin seulement.');
    const ch = message.mentions.channels.first() || message.channel;
    getGuildConfig(message.guild.id).boostLogsChannel = ch.id; saveConfig();
    return message.reply(`✅ Logs boosts : <#${ch.id}>`);
  }
  if (command === 'setsuggest') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply('❌ Admin seulement.');
    const ch = message.mentions.channels.first() || message.channel;
    getGuildConfig(message.guild.id).suggestChannel = ch.id; saveConfig();
    return message.reply(`✅ Salon suggestions : <#${ch.id}>`);
  }

  if (command === 'setup') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply('❌ Admin seulement.');
    const embed = new EmbedBuilder()
      .setTitle('⚙️ Configuration du bot')
      .setDescription([
        '`+setwelcome #salon` — bienvenue',
        '`+setleave #salon` — départ',
        '`+setmodlogs #salon` — logs modération (bans/kicks/warns)',
        '`+setmsglogs #salon` — logs messages (édition/suppression)',
        '`+setvoicelogs #salon` — logs vocal (entrée/sortie)',
        '`+setboostlogs #salon` — logs boosts',
        '`+setsuggest #salon` — suggestions',
        '`/setstatus texte` — statut du bot',
      ].join('\n'))
      .setColor('#5865F2').setTimestamp();
    return message.reply({ embeds: [embed] });
  }

  if (command === 'say') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) return message.reply('❌ Permission refusée.');
    const text = args.join(' ');
    if (!text) return message.reply('❌ Donne un message.');
    message.delete().catch(() => {});
    return message.channel.send(text);
  }

  if (command === 'embed') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) return message.reply('❌ Permission refusée.');
    const parts = args.join(' ').split('|');
    const title = parts[0]?.trim(), description = parts[1]?.trim();
    if (!title || !description) return message.reply('❌ Usage : `+embed Titre | Description`');
    const embed = new EmbedBuilder().setTitle(title).setDescription(description).setColor('#FF6B9D').setTimestamp();
    message.delete().catch(() => {});
    return message.channel.send({ embeds: [embed] });
  }
});

// ══════════════════════════════════════════════════════════
//  BOUTONS TICKETS
// ══════════════════════════════════════════════════════════
client.on('interactionCreate', async interaction => {
  if (!interaction.isButton()) return;
  const ticketTypes = { ticket_support: '🎫 Support', ticket_report: '🚨 Report', ticket_question: '❓ Question', ticket_autre: '📝 Autre' };
  if (ticketTypes[interaction.customId]) {
    const label = ticketTypes[interaction.customId];
    const existing = interaction.guild.channels.cache.find(c => c.name === `ticket-${interaction.user.username.toLowerCase()}` && c.type === ChannelType.GuildText);
    if (existing) return interaction.reply({ content: `❌ Ticket déjà ouvert : <#${existing.id}>`, ephemeral: true });
    const channel = await interaction.guild.channels.create({
      name: `ticket-${interaction.user.username.toLowerCase()}`,
      type: ChannelType.GuildText,
      permissionOverwrites: [
        { id: interaction.guild.roles.everyone, deny: [PermissionsBitField.Flags.ViewChannel] },
        { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
      ],
    });
    const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('ticket_close').setLabel('🔒 Fermer').setStyle(ButtonStyle.Danger));
    const embed = new EmbedBuilder().setTitle(`${label} — ${interaction.user.username}`).setDescription('Explique ton problème, un modérateur va te répondre.').setColor('#5865F2').setTimestamp();
    await channel.send({ content: `<@${interaction.user.id}>`, embeds: [embed], components: [row] });
    return interaction.reply({ content: `✅ Ticket créé : <#${channel.id}>`, ephemeral: true });
  }
  if (interaction.customId === 'ticket_close') {
    await interaction.reply('🔒 Fermeture dans 5 secondes...');
    setTimeout(() => interaction.channel.delete().catch(() => {}), 5000);
  }
});

// ══════════════════════════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════════════════════════
async function playNext(guildId) {
  const q = queues.get(guildId);
  if (!q || q.songs.length === 0) return;
  try {
    const stream = ytdl(q.songs[0], { filter: 'audioonly', quality: 'lowestaudio', highWaterMark: 1 << 25 });
    const resource = createAudioResource(stream);
    q.player.play(resource);
    q.textChannel.send(`🎵 Lecture : ${q.songs[0]}`);
  } catch {
    q.textChannel.send('❌ Impossible de lire cette musique.');
    q.songs.shift();
    if (q.songs.length > 0) playNext(guildId);
    else { q.connection.destroy(); queues.delete(guildId); }
  }
}

// ══════════════════════════════════════════════════════════
//  ANTI-CRASH
// ══════════════════════════════════════════════════════════
process.on('unhandledRejection', err => console.error('unhandledRejection:', err));
process.on('uncaughtException', err => console.error('uncaughtException:', err));

// ══════════════════════════════════════════════════════════
//  CONNEXION
// ══════════════════════════════════════════════════════════
client.login(process.env.DISCORD_TOKEN);


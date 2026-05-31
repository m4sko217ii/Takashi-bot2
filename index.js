// ============================================================
//  BOT DISCORD — index.js
//  Préfixe : +
//  Hébergement : Railway 24/7
// ============================================================

const {
  Client, GatewayIntentBits, PermissionsBitField,
  EmbedBuilder, ActionRowBuilder, ButtonBuilder,
  ButtonStyle, ChannelType, ActivityType
} = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource,
  AudioPlayerStatus, VoiceConnectionStatus, entersState, getVoiceConnection } = require('@discordjs/voice');
const ytdl = require('@distube/ytdl-core');
const yts = require('yt-search');
const fs = require('fs');
const http = require('http');

// ─── Keep-alive HTTP server (pour Railway / UptimeRobot) ───
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
let config = loadJSON(CONFIG_FILE); // { guildId: { welcomeChannel, leaveChannel, logsChannel, muteRole, ... } }

function getGuildConfig(guildId) {
  if (!config[guildId]) config[guildId] = {};
  return config[guildId];
}
function saveConfig() { saveJSON(CONFIG_FILE, config); }

// ─── File musicale par serveur ────────────────────────────
const queues = new Map(); // guildId → { connection, player, songs: [], textChannel }

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
//  READY
// ══════════════════════════════════════════════════════════
client.once('ready', () => {
  console.log(`✅ Connecté en tant que ${client.user.tag}`);

  // Slash command /setstatus visible sur le profil
  client.guilds.cache.forEach(guild => {
    guild.commands.create({
      name: 'setstatus',
      description: 'Change le statut du bot',
      options: [{ name: 'texte', description: 'Nouveau statut', type: 3, required: true }]
    }).catch(() => {});
  });

  setInterval(() => {
    const s = statuses[statusIndex % statuses.length];
    client.user.setActivity(s.name, { type: s.type });
    statusIndex++;
  }, 30000);
  const s = statuses[0];
  client.user.setActivity(s.name, { type: s.type });
});

// ══════════════════════════════════════════════════════════
//  SLASH COMMANDS
// ══════════════════════════════════════════════════════════
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'setstatus') {
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator))
      return interaction.reply({ content: '❌ Réservé aux admins.', ephemeral: true });
    const texte = interaction.options.getString('texte');
    client.user.setActivity(texte, { type: ActivityType.Playing });
    interaction.reply({ content: `✅ Statut changé en **${texte}**`, ephemeral: true });
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
//  ANTI-SPAM
// ══════════════════════════════════════════════════════════
client.on('messageCreate', async message => {
  if (message.author.bot || !message.guild) return;

  // Anti-spam check
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

  // ─── Parse commande ──────────────────────────────────
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
        { name: '🎵 Musique', value: '`+play <titre>` `+skip` `+stop` `+queue` `+pause` `+resume` `+nowplaying`', inline: false },
        { name: '🎉 Communauté', value: '`+poll <question>` `+giveaway <durée> <lot>` `+announce <message>` `+suggest <idée>` `+rank @user` `+unrank @user`', inline: false },
        { name: '🎫 Tickets', value: '`+ticket` → ouvre un menu de création', inline: false },
        { name: '⚙️ Config', value: '`+setwelcome` `+setleave` `+setlogs` `+setmuterole` `+setsuggest` `+setup`', inline: false },
      )
      .setFooter({ text: `Préfixe : ${PREFIX}` })
      .setTimestamp();
    return message.reply({ embeds: [embed] });
  }

  // ══════════════════════════════════════════════════════
  //  MODÉRATION
  // ══════════════════════════════════════════════════════

  // BAN
  if (command === 'ban') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.BanMembers))
      return message.reply('❌ Tu n\'as pas la permission.');
    const target = message.mentions.members.first();
    if (!target) return message.reply('❌ Mentionne un membre.');
    const reason = args.slice(1).join(' ') || 'Aucune raison';
    await target.ban({ reason }).catch(() => {});
    log(message.guild, `🔨 **Ban** : ${target.user.tag} par ${message.author.tag} — ${reason}`);
    return message.reply(`✅ **${target.user.tag}** a été banni. Raison : ${reason}`);
  }

  // KICK
  if (command === 'kick') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.KickMembers))
      return message.reply('❌ Tu n\'as pas la permission.');
    const target = message.mentions.members.first();
    if (!target) return message.reply('❌ Mentionne un membre.');
    const reason = args.slice(1).join(' ') || 'Aucune raison';
    await target.kick(reason).catch(() => {});
    log(message.guild, `👢 **Kick** : ${target.user.tag} par ${message.author.tag} — ${reason}`);
    return message.reply(`✅ **${target.user.tag}** a été kické.`);
  }

  // MUTE
  if (command === 'mute') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.ModerateMembers))
      return message.reply('❌ Tu n\'as pas la permission.');
    const target = message.mentions.members.first();
    if (!target) return message.reply('❌ Mentionne un membre.');
    const duration = parseInt(args[1]) || 10;
    await target.timeout(duration * 60 * 1000, 'Mute').catch(() => {});
    log(message.guild, `🔇 **Mute** ${duration}min : ${target.user.tag} par ${message.author.tag}`);
    return message.reply(`✅ **${target.user.tag}** a été mute ${duration} minutes.`);
  }

  // UNMUTE
  if (command === 'unmute') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.ModerateMembers))
      return message.reply('❌ Tu n\'as pas la permission.');
    const target = message.mentions.members.first();
    if (!target) return message.reply('❌ Mentionne un membre.');
    await target.timeout(null).catch(() => {});
    return message.reply(`✅ **${target.user.tag}** a été unmute.`);
  }

  // WARN
  if (command === 'warn') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.ModerateMembers))
      return message.reply('❌ Tu n\'as pas la permission.');
    const target = message.mentions.members.first();
    if (!target) return message.reply('❌ Mentionne un membre.');
    const reason = args.slice(1).join(' ') || 'Aucune raison';
    const key = `${message.guild.id}-${target.id}`;
    if (!warnings[key]) warnings[key] = [];
    warnings[key].push({ reason, date: new Date().toISOString(), by: message.author.tag });
    saveJSON(WARNS_FILE, warnings);
    const count = warnings[key].length;
    message.reply(`⚠️ **${target.user.tag}** a reçu un avertissement. Total : **${count}**\nRaison : ${reason}`);
    log(message.guild, `⚠️ **Warn** (${count}) : ${target.user.tag} par ${message.author.tag} — ${reason}`);
    if (count >= 5) { target.ban({ reason: 'Auto-ban : 5 warns' }).catch(() => {}); message.channel.send(`🔨 **${target.user.tag}** banni automatiquement (5 warns).`); }
    else if (count >= 3) { target.timeout(60 * 60 * 1000, 'Auto-mute : 3 warns').catch(() => {}); message.channel.send(`🔇 **${target.user.tag}** mute 1h automatiquement (3 warns).`); }
    return;
  }

  // WARNINGS
  if (command === 'warnings') {
    const target = message.mentions.members.first() || message.member;
    const key = `${message.guild.id}-${target.id}`;
    const w = warnings[key];
    if (!w || w.length === 0) return message.reply(`✅ **${target.user.username}** n'a aucun avertissement.`);
    const list = w.map((x, i) => `**${i + 1}.** ${x.reason} — par ${x.by}`).join('\n');
    return message.reply(`⚠️ **Warns de ${target.user.username}** (${w.length}) :\n${list}`);
  }

  // CLEARWARNS
  if (command === 'clearwarns') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.ModerateMembers))
      return message.reply('❌ Tu n\'as pas la permission.');
    const target = message.mentions.members.first();
    if (!target) return message.reply('❌ Mentionne un membre.');
    delete warnings[`${message.guild.id}-${target.id}`];
    saveJSON(WARNS_FILE, warnings);
    return message.reply(`✅ Warns de **${target.user.username}** effacés.`);
  }

  // CLEAR
  if (command === 'clear') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.ManageMessages))
      return message.reply('❌ Tu n\'as pas la permission.');
    const amount = Math.min(parseInt(args[0]) || 10, 100);
    await message.channel.bulkDelete(amount + 1, true).catch(() => {});
    message.channel.send(`✅ **${amount}** messages supprimés.`).then(m => setTimeout(() => m.delete().catch(() => {}), 3000));
    return;
  }

  // LOCK / UNLOCK
  if (command === 'lock') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.ManageChannels))
      return message.reply('❌ Tu n\'as pas la permission.');
    await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: false });
    return message.reply('🔒 Salon verrouillé.');
  }
  if (command === 'unlock') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.ManageChannels))
      return message.reply('❌ Tu n\'as pas la permission.');
    await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: null });
    return message.reply('🔓 Salon déverrouillé.');
  }

  // ══════════════════════════════════════════════════════
  //  INFOS
  // ══════════════════════════════════════════════════════

  // USERINFO
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
      )
      .setTimestamp();
    return message.reply({ embeds: [embed] });
  }

  // SERVERINFO
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
      )
      .setTimestamp();
    return message.reply({ embeds: [embed] });
  }

  // BOTINFO
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
      )
      .setTimestamp();
    return message.reply({ embeds: [embed] });
  }

  // AVATAR
  if (command === 'avatar') {
    const target = message.mentions.users.first() || message.author;
    const embed = new EmbedBuilder()
      .setTitle(`🖼️ Avatar de ${target.username}`)
      .setImage(target.displayAvatarURL({ dynamic: true, size: 1024 }))
      .setColor('#FF6B9D');
    return message.reply({ embeds: [embed] });
  }

  // PIC — photo de profil en grand
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
  //  COMMUNAUTÉ
  // ══════════════════════════════════════════════════════

  // POLL
  if (command === 'poll') {
    const question = args.join(' ');
    if (!question) return message.reply('❌ Donne une question. Ex : `+poll Pizza ou burger ?`');
    const embed = new EmbedBuilder()
      .setTitle('📊 Sondage')
      .setDescription(`**${question}**`)
      .setColor('#FFA500')
      .setFooter({ text: `Par ${message.author.username}` })
      .setTimestamp();
    const msg = await message.channel.send({ embeds: [embed] });
    await msg.react('✅');
    await msg.react('❌');
    return;
  }

  // ANNOUNCE
  if (command === 'announce' || command === 'annonce') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.ManageMessages))
      return message.reply('❌ Tu n\'as pas la permission.');
    const text = args.join(' ');
    if (!text) return message.reply('❌ Donne un message à annoncer.');
    const embed = new EmbedBuilder()
      .setTitle('📢 Annonce')
      .setDescription(text)
      .setColor('#FF0000')
      .setFooter({ text: `Par ${message.author.username}` })
      .setTimestamp();
    message.delete().catch(() => {});
    return message.channel.send({ content: '@everyone', embeds: [embed] });
  }

  // SUGGEST
  if (command === 'suggest') {
    const cfg = getGuildConfig(message.guild.id);
    const text = args.join(' ');
    if (!text) return message.reply('❌ Écris ta suggestion. Ex : `+suggest Ajouter un salon gaming`');
    const embed = new EmbedBuilder()
      .setTitle('💡 Nouvelle suggestion')
      .setDescription(text)
      .setColor('#00FF7F')
      .setFooter({ text: `Par ${message.author.username}` })
      .setTimestamp();
    const ch = cfg.suggestChannel ? message.guild.channels.cache.get(cfg.suggestChannel) : message.channel;
    if (!ch) return message.reply('❌ Salon de suggestions non configuré.');
    const msg = await ch.send({ embeds: [embed] });
    await msg.react('👍');
    await msg.react('👎');
    if (ch.id !== message.channel.id) message.reply('✅ Suggestion envoyée !');
    return;
  }

  // RANK / UNRANK
  if (command === 'rank') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.ManageRoles))
      return message.reply('❌ Tu n\'as pas la permission.');
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
      return message.reply('❌ Tu n\'as pas la permission.');
    const target = message.mentions.members.first();
    const roleName = args.slice(1).join(' ');
    if (!target || !roleName) return message.reply('❌ Usage : `+unrank @user NomDuRôle`');
    const role = message.guild.roles.cache.find(r => r.name.toLowerCase() === roleName.toLowerCase());
    if (!role) return message.reply(`❌ Rôle **${roleName}** introuvable.`);
    await target.roles.remove(role).catch(() => {});
    return message.reply(`✅ Rôle **${role.name}** retiré à **${target.user.username}**.`);
  }

  // GIVEAWAY
  if (command === 'giveaway') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.ManageMessages))
      return message.reply('❌ Tu n\'as pas la permission. Usage : `+giveaway <durée en min> <lot>`');
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
      if (!reaction) return message.channel.send('❌ Personne n\'a participé au giveaway.');
      const users = await reaction.users.fetch();
      const participants = users.filter(u => !u.bot);
      if (participants.size === 0) return message.channel.send('❌ Aucun participant.');
      const winner = participants.random();
      const winEmbed = new EmbedBuilder()
        .setTitle('🎉 Giveaway terminé !')
        .setDescription(`Gagnant : <@${winner.id}> 🎊\nLot : **${prize}**`)
        .setColor('#FFD700')
        .setTimestamp();
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
    if (!query) return message.reply('❌ Donne un titre. Ex : `+play Naruto OST`');
    if (!message.member.voice.channel) return message.reply('❌ Tu dois être dans un salon vocal.');

    let videoUrl;
    try {
      if (query.startsWith('http')) {
        videoUrl = query;
      } else {
        const res = await yts(query);
        const video = res.videos[0];
        if (!video) return message.reply('❌ Aucun résultat trouvé.');
        videoUrl = video.url;
      }
    } catch {
      return message.reply('❌ Erreur lors de la recherche.');
    }

    let queue = queues.get(message.guild.id);
    if (!queue) {
      const connection = joinVoiceChannel({
        channelId: message.member.voice.channel.id,
        guildId: message.guild.id,
        adapterCreator: message.guild.voiceAdapterCreator,
      });
      const player = createAudioPlayer();
      connection.subscribe(player);
      queue = { connection, player, songs: [], textChannel: message.channel };
      queues.set(message.guild.id, queue);

      player.on(AudioPlayerStatus.Idle, () => {
        queue.songs.shift();
        if (queue.songs.length > 0) playNext(message.guild.id);
        else { queue.connection.destroy(); queues.delete(message.guild.id); }
      });
      player.on('error', () => {
        queue.songs.shift();
        if (queue.songs.length > 0) playNext(message.guild.id);
        else { queue.connection.destroy(); queues.delete(message.guild.id); }
      });
    }

    queue.songs.push(videoUrl);
    if (queue.songs.length === 1) playNext(message.guild.id);
    else message.reply(`✅ Ajouté à la file : ${videoUrl}`);
    return;
  }

  if (command === 'skip') {
    const q = queues.get(message.guild.id);
    if (!q) return message.reply('❌ Aucune musique en cours.');
    q.player.stop();
    return message.reply('⏭️ Musique skippée.');
  }

  if (command === 'stop') {
    const q = queues.get(message.guild.id);
    if (!q) return message.reply('❌ Aucune musique en cours.');
    q.songs = [];
    q.player.stop();
    q.connection.destroy();
    queues.delete(message.guild.id);
    return message.reply('⏹️ Musique arrêtée.');
  }

  if (command === 'pause') {
    const q = queues.get(message.guild.id);
    if (!q) return message.reply('❌ Aucune musique en cours.');
    q.player.pause();
    return message.reply('⏸️ Musique en pause.');
  }

  if (command === 'resume') {
    const q = queues.get(message.guild.id);
    if (!q) return message.reply('❌ Aucune musique en cours.');
    q.player.unpause();
    return message.reply('▶️ Musique reprise.');
  }

  if (command === 'queue') {
    const q = queues.get(message.guild.id);
    if (!q || q.songs.length === 0) return message.reply('❌ La file est vide.');
    const list = q.songs.slice(0, 10).map((s, i) => `**${i + 1}.** ${s}`).join('\n');
    return message.reply(`🎵 **File musicale** :\n${list}`);
  }

  if (command === 'nowplaying' || command === 'np') {
    const q = queues.get(message.guild.id);
    if (!q || q.songs.length === 0) return message.reply('❌ Aucune musique en cours.');
    return message.reply(`🎵 En cours : ${q.songs[0]}`);
  }

  // ══════════════════════════════════════════════════════
  //  CONFIG
  // ══════════════════════════════════════════════════════

  if (command === 'setwelcome') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator))
      return message.reply('❌ Admin seulement.');
    const ch = message.mentions.channels.first() || message.channel;
    getGuildConfig(message.guild.id).welcomeChannel = ch.id;
    saveConfig();
    return message.reply(`✅ Salon de bienvenue : <#${ch.id}>`);
  }

  if (command === 'setleave') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator))
      return message.reply('❌ Admin seulement.');
    const ch = message.mentions.channels.first() || message.channel;
    getGuildConfig(message.guild.id).leaveChannel = ch.id;
    saveConfig();
    return message.reply(`✅ Salon de départ : <#${ch.id}>`);
  }

  if (command === 'setlogs') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator))
      return message.reply('❌ Admin seulement.');
    const ch = message.mentions.channels.first() || message.channel;
    getGuildConfig(message.guild.id).logsChannel = ch.id;
    saveConfig();
    return message.reply(`✅ Salon de logs : <#${ch.id}>`);
  }

  if (command === 'setsuggest') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator))
      return message.reply('❌ Admin seulement.');
    const ch = message.mentions.channels.first() || message.channel;
    getGuildConfig(message.guild.id).suggestChannel = ch.id;
    saveConfig();
    return message.reply(`✅ Salon de suggestions : <#${ch.id}>`);
  }

  if (command === 'setup') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator))
      return message.reply('❌ Admin seulement.');
    const embed = new EmbedBuilder()
      .setTitle('⚙️ Configuration du bot')
      .setDescription([
        '`+setwelcome #salon` — salon de bienvenue',
        '`+setleave #salon` — salon de départ',
        '`+setlogs #salon` — salon de logs',
        '`+setsuggest #salon` — salon de suggestions',
        '`/setstatus texte` — changer le statut du bot',
      ].join('\n'))
      .setColor('#5865F2')
      .setTimestamp();
    return message.reply({ embeds: [embed] });
  }

  // SAY
  if (command === 'say') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.ManageMessages))
      return message.reply('❌ Tu n\'as pas la permission.');
    const text = args.join(' ');
    if (!text) return message.reply('❌ Donne un message.');
    message.delete().catch(() => {});
    return message.channel.send(text);
  }

  // EMBED
  if (command === 'embed') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.ManageMessages))
      return message.reply('❌ Tu n\'as pas la permission.');
    const parts = args.join(' ').split('|');
    const title = parts[0]?.trim();
    const description = parts[1]?.trim();
    if (!title || !description) return message.reply('❌ Usage : `+embed Titre | Description`');
    const embed = new EmbedBuilder().setTitle(title).setDescription(description).setColor('#FF6B9D').setTimestamp();
    message.delete().catch(() => {});
    return message.channel.send({ embeds: [embed] });
  }
});

// ══════════════════════════════════════════════════════════
//  BOUTONS (tickets)
// ══════════════════════════════════════════════════════════
client.on('interactionCreate', async interaction => {
  if (!interaction.isButton()) return;

  const ticketTypes = {
    ticket_support: '🎫 Support',
    ticket_report: '🚨 Report',
    ticket_question: '❓ Question',
    ticket_autre: '📝 Autre',
  };

  if (ticketTypes[interaction.customId]) {
    const label = ticketTypes[interaction.customId];
    const existing = interaction.guild.channels.cache.find(
      c => c.name === `ticket-${interaction.user.username.toLowerCase()}` && c.type === ChannelType.GuildText
    );
    if (existing) return interaction.reply({ content: `❌ Tu as déjà un ticket ouvert : <#${existing.id}>`, ephemeral: true });

    const channel = await interaction.guild.channels.create({
      name: `ticket-${interaction.user.username.toLowerCase()}`,
      type: ChannelType.GuildText,
      permissionOverwrites: [
        { id: interaction.guild.roles.everyone, deny: [PermissionsBitField.Flags.ViewChannel] },
        { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
      ],
    });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('ticket_close').setLabel('🔒 Fermer').setStyle(ButtonStyle.Danger)
    );
    const embed = new EmbedBuilder()
      .setTitle(`${label} — Ticket de ${interaction.user.username}`)
      .setDescription('Explique ton problème, un modérateur va te répondre.')
      .setColor('#5865F2')
      .setTimestamp();

    await channel.send({ content: `<@${interaction.user.id}>`, embeds: [embed], components: [row] });
    interaction.reply({ content: `✅ Ticket créé : <#${channel.id}>`, ephemeral: true });
    return;
  }

  if (interaction.customId === 'ticket_close') {
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageChannels) &&
      !interaction.channel.name.includes(interaction.user.username.toLowerCase()))
      return interaction.reply({ content: '❌ Tu ne peux pas fermer ce ticket.', ephemeral: true });
    await interaction.reply('🔒 Fermeture dans 5 secondes...');
    setTimeout(() => interaction.channel.delete().catch(() => {}), 5000);
  }
});

// ══════════════════════════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════════════════════════
function log(guild, text) {
  const cfg = getGuildConfig(guild.id);
  if (!cfg.logsChannel) return;
  const ch = guild.channels.cache.get(cfg.logsChannel);
  if (!ch) return;
  const embed = new EmbedBuilder()
    .setDescription(text.substring(0, 4096))
    .setColor('#FF4500')
    .setTimestamp();
  ch.send({ embeds: [embed] }).catch(() => {});
}

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

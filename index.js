require('dotenv').config();
const {
  Client, GatewayIntentBits, PermissionsBitField, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType,
} = require('discord.js');
const fs   = require('fs');
const path = require('path');
const http = require('http');

// ── Keep-alive server (pour UptimeRobot / Render / Railway) ──────────────────
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200);
  res.end('Takashi is alive 🎌');
}).listen(PORT, () => console.log(`🌐 Keep-alive server sur le port ${PORT}`));

// ── Warnings persistants ──────────────────────────────────────────────────────
const WARNS_FILE = path.join(__dirname, 'warnings.json');
function loadWarnings() {
  try { return JSON.parse(fs.readFileSync(WARNS_FILE, 'utf8')); }
  catch { return {}; }
}
function saveWarnings(data) {
  fs.writeFileSync(WARNS_FILE, JSON.stringify(data, null, 2));
}
let warningsDB = loadWarnings();

// ── Client Discord ────────────────────────────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessageReactions,
  ],
});

const PREFIX = '+';

// ── Helpers ───────────────────────────────────────────────────────────────────
function successEmbed(title, description) {
  return new EmbedBuilder().setColor(0x2ecc71).setTitle(`✅ ${title}`).setDescription(description).setTimestamp();
}
function errorEmbed(description) {
  return new EmbedBuilder().setColor(0xe74c3c).setTitle('❌ Erreur').setDescription(description).setTimestamp();
}
function infoEmbed(title, fields) {
  const e = new EmbedBuilder().setColor(0x3498db).setTitle(title).setTimestamp();
  if (fields) e.addFields(fields);
  return e;
}
function hasPermission(member, perm) { return member.permissions.has(perm); }
function parseDuration(str) {
  const match = str?.match(/^(\d+)(s|m|h|d)$/);
  if (!match) return null;
  return parseInt(match[1]) * { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2]];
}
function getLogChannel(guild, name) {
  return guild.channels.cache.find(c => c.name.includes(name) && c.type === ChannelType.GuildText);
}
function formatMs(ms) {
  const d = Math.floor(ms / 86_400_000);
  const h = Math.floor((ms % 86_400_000) / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return [d && `${d}j`, h && `${h}h`, m && `${m}m`, s && `${s}s`].filter(Boolean).join(' ');
}

// ── Commands ──────────────────────────────────────────────────────────────────
const commands = {

  // +help
  async help(message) {
    const embed = new EmbedBuilder()
      .setColor(0x9b59b6)
      .setTitle('🎴 Commandes Takashi')
      .setDescription('Préfixe : `+`')
      .addFields(
        { name: '🔨 Modération', value: '`ban` `unban` `kick` `mute` `unmute` `warn` `warnings` `clearwarns` `clear` `slowmode` `lock` `unlock`', inline: false },
        { name: '🔍 Informations', value: '`userinfo` `serverinfo` `botinfo`', inline: false },
        { name: '🛠️ Utilitaires', value: '`say` `pic` `embed` `poll`', inline: false },
        { name: '🎴 Tickets & Setup', value: '`ticket` `setup`', inline: false },
      )
      .setFooter({ text: 'Takashi 🎌 — +help <commande> pour plus de détails' })
      .setTimestamp();
    message.channel.send({ embeds: [embed] });
  },

  // +ban
  async ban(message, args) {
    if (!hasPermission(message.member, PermissionsBitField.Flags.BanMembers))
      return message.channel.send({ embeds: [errorEmbed('Tu n\'as pas la permission de bannir.')] });
    const target = message.mentions.members.first();
    if (!target) return message.channel.send({ embeds: [errorEmbed('Mentionne un membre à bannir.')] });
    if (!target.bannable) return message.channel.send({ embeds: [errorEmbed('Je ne peux pas bannir ce membre.')] });
    const reason = args.slice(1).join(' ') || 'Aucune raison fournie';
    await target.ban({ reason });
    message.channel.send({ embeds: [successEmbed('Banni', `**${target.user.tag}** a été banni.\n**Raison :** ${reason}`)] });
    const ch = getLogChannel(message.guild, 'mod-logs');
    if (ch) ch.send({ embeds: [new EmbedBuilder().setColor(0xe74c3c).setTitle('🔨 Ban').addFields({ name: 'Membre', value: target.user.tag }, { name: 'Raison', value: reason }, { name: 'Par', value: message.author.tag }).setTimestamp()] });
  },

  // +unban
  async unban(message, args) {
    if (!hasPermission(message.member, PermissionsBitField.Flags.BanMembers))
      return message.channel.send({ embeds: [errorEmbed('Tu n\'as pas la permission de débannir.')] });
    const userId = args[0];
    if (!userId) return message.channel.send({ embeds: [errorEmbed('Fournis l\'ID de l\'utilisateur.')] });
    try {
      const user = await client.users.fetch(userId);
      await message.guild.members.unban(userId);
      message.channel.send({ embeds: [successEmbed('Débanni', `**${user.tag}** (\`${userId}\`) a été débanni.`)] });
    } catch { message.channel.send({ embeds: [errorEmbed('Utilisateur introuvable dans les bannis.')] }); }
  },

  // +kick
  async kick(message, args) {
    if (!hasPermission(message.member, PermissionsBitField.Flags.KickMembers))
      return message.channel.send({ embeds: [errorEmbed('Tu n\'as pas la permission d\'expulser.')] });
    const target = message.mentions.members.first();
    if (!target) return message.channel.send({ embeds: [errorEmbed('Mentionne un membre à expulser.')] });
    if (!target.kickable) return message.channel.send({ embeds: [errorEmbed('Je ne peux pas expulser ce membre.')] });
    const reason = args.slice(1).join(' ') || 'Aucune raison fournie';
    await target.kick(reason);
    message.channel.send({ embeds: [successEmbed('Expulsé', `**${target.user.tag}** a été expulsé.\n**Raison :** ${reason}`)] });
    const ch = getLogChannel(message.guild, 'mod-logs');
    if (ch) ch.send({ embeds: [new EmbedBuilder().setColor(0xe67e22).setTitle('👢 Kick').addFields({ name: 'Membre', value: target.user.tag }, { name: 'Raison', value: reason }, { name: 'Par', value: message.author.tag }).setTimestamp()] });
  },

  // +mute
  async mute(message, args) {
    if (!hasPermission(message.member, PermissionsBitField.Flags.ModerateMembers))
      return message.channel.send({ embeds: [errorEmbed('Tu n\'as pas la permission de mute.')] });
    const target = message.mentions.members.first();
    if (!target) return message.channel.send({ embeds: [errorEmbed('Mentionne un membre.')] });
    const durationStr = args[1] || '10m';
    const duration = parseDuration(durationStr);
    if (!duration) return message.channel.send({ embeds: [errorEmbed('Durée invalide. Ex: `30s`, `10m`, `2h`, `1d`')] });
    if (duration > 2_419_200_000) return message.channel.send({ embeds: [errorEmbed('Durée max : 28 jours.')] });
    await target.timeout(duration, `Mute par ${message.author.tag}`);
    message.channel.send({ embeds: [successEmbed('Muet', `**${target.user.tag}** est muet pendant **${durationStr}**.`)] });
    const ch = getLogChannel(message.guild, 'mod-logs');
    if (ch) ch.send({ embeds: [new EmbedBuilder().setColor(0xf39c12).setTitle('🔇 Mute').addFields({ name: 'Membre', value: target.user.tag }, { name: 'Durée', value: durationStr }, { name: 'Par', value: message.author.tag }).setTimestamp()] });
  },

  // +unmute
  async unmute(message, args) {
    if (!hasPermission(message.member, PermissionsBitField.Flags.ModerateMembers))
      return message.channel.send({ embeds: [errorEmbed('Tu n\'as pas la permission.')] });
    const target = message.mentions.members.first();
    if (!target) return message.channel.send({ embeds: [errorEmbed('Mentionne un membre.')] });
    await target.timeout(null);
    message.channel.send({ embeds: [successEmbed('Unmute', `**${target.user.tag}** n'est plus muet.`)] });
  },

  // +warn
  async warn(message, args) {
    if (!hasPermission(message.member, PermissionsBitField.Flags.ModerateMembers))
      return message.channel.send({ embeds: [errorEmbed('Tu n\'as pas la permission.')] });
    const target = message.mentions.members.first();
    if (!target) return message.channel.send({ embeds: [errorEmbed('Mentionne un membre.')] });
    const reason = args.slice(1).join(' ') || 'Aucune raison fournie';
    if (!warningsDB[message.guild.id]) warningsDB[message.guild.id] = {};
    if (!warningsDB[message.guild.id][target.id]) warningsDB[message.guild.id][target.id] = [];
    warningsDB[message.guild.id][target.id].push({ reason, date: new Date().toISOString(), by: message.author.tag });
    saveWarnings(warningsDB);
    const count = warningsDB[message.guild.id][target.id].length;
    message.channel.send({ embeds: [successEmbed('Avertissement', `**${target.user.tag}** averti.\n**Raison :** ${reason}\n**Total :** ${count} warn(s)`)] });
    // Auto-sanction
    if (count === 3) {
      await target.timeout(3_600_000, 'Auto-mute — 3 warns');
      message.channel.send({ embeds: [errorEmbed(`**${target.user.tag}** a reçu 3 warns → mute automatique 1h.`)] });
    } else if (count === 5) {
      if (target.kickable) await target.kick('Auto-kick — 5 warns');
      message.channel.send({ embeds: [errorEmbed(`**${target.user.tag}** a reçu 5 warns → expulsion automatique.`)] });
    }
    const ch = getLogChannel(message.guild, 'mod-logs');
    if (ch) ch.send({ embeds: [new EmbedBuilder().setColor(0xf1c40f).setTitle('⚠️ Warn').addFields({ name: 'Membre', value: target.user.tag }, { name: 'Raison', value: reason }, { name: 'Total', value: `${count}` }, { name: 'Par', value: message.author.tag }).setTimestamp()] });
  },

  // +warnings
  async warnings(message) {
    const target = message.mentions.members.first() || message.member;
    const warns = warningsDB[message.guild.id]?.[target.id] || [];
    if (warns.length === 0)
      return message.channel.send({ embeds: [infoEmbed(`Avertissements — ${target.user.tag}`, [{ name: 'Résultat', value: 'Aucun avertissement. ✅' }])] });
    message.channel.send({ embeds: [infoEmbed(`⚠️ Avertissements de ${target.user.tag} (${warns.length})`, warns.map((w, i) => ({ name: `#${i + 1} — ${w.date.split('T')[0]}`, value: `**Raison :** ${w.reason}\n**Par :** ${w.by}`, inline: false })))] });
  },

  // +clearwarns
  async clearwarns(message) {
    if (!hasPermission(message.member, PermissionsBitField.Flags.Administrator))
      return message.channel.send({ embeds: [errorEmbed('Tu dois être administrateur.')] });
    const target = message.mentions.members.first();
    if (!target) return message.channel.send({ embeds: [errorEmbed('Mentionne un membre.')] });
    if (warningsDB[message.guild.id]) warningsDB[message.guild.id][target.id] = [];
    saveWarnings(warningsDB);
    message.channel.send({ embeds: [successEmbed('Warns supprimés', `Les avertissements de **${target.user.tag}** ont été effacés.`)] });
  },

  // +clear
  async clear(message, args) {
    if (!hasPermission(message.member, PermissionsBitField.Flags.ManageMessages))
      return message.channel.send({ embeds: [errorEmbed('Tu n\'as pas la permission.')] });
    const amount = parseInt(args[0]);
    if (isNaN(amount) || amount < 1 || amount > 100)
      return message.channel.send({ embeds: [errorEmbed('Indique un nombre entre 1 et 100.')] });
    await message.delete();
    const deleted = await message.channel.bulkDelete(amount, true);
    const reply = await message.channel.send({ embeds: [successEmbed('Messages supprimés', `**${deleted.size}** message(s) supprimé(s).`)] });
    setTimeout(() => reply.delete().catch(() => {}), 4000);
  },

  // +slowmode
  async slowmode(message, args) {
    if (!hasPermission(message.member, PermissionsBitField.Flags.ManageChannels))
      return message.channel.send({ embeds: [errorEmbed('Tu n\'as pas la permission.')] });
    const seconds = parseInt(args[0]);
    if (isNaN(seconds) || seconds < 0 || seconds > 21_600)
      return message.channel.send({ embeds: [errorEmbed('Nombre entre 0 et 21600.')] });
    await message.channel.setRateLimitPerUser(seconds);
    message.channel.send({ embeds: [successEmbed('Slowmode', seconds === 0 ? 'Mode lent désactivé.' : `Mode lent : **${seconds}s**`)] });
  },

  // +lock
  async lock(message) {
    if (!hasPermission(message.member, PermissionsBitField.Flags.ManageChannels))
      return message.channel.send({ embeds: [errorEmbed('Tu n\'as pas la permission.')] });
    await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: false });
    message.channel.send({ embeds: [successEmbed('🔒 Salon verrouillé', 'Plus personne ne peut envoyer de messages.')] });
  },

  // +unlock
  async unlock(message) {
    if (!hasPermission(message.member, PermissionsBitField.Flags.ManageChannels))
      return message.channel.send({ embeds: [errorEmbed('Tu n\'as pas la permission.')] });
    await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: null });
    message.channel.send({ embeds: [successEmbed('🔓 Salon déverrouillé', 'Les membres peuvent de nouveau écrire.')] });
  },

  // +userinfo
  async userinfo(message) {
    const target = message.mentions.members.first() || message.member;
    const roles = target.roles.cache.filter(r => r.name !== '@everyone').sort((a, b) => b.position - a.position);
    message.channel.send({ embeds: [infoEmbed(`👤 ${target.user.tag}`, [
      { name: 'ID', value: target.user.id, inline: true },
      { name: 'Surnom', value: target.nickname || 'Aucun', inline: true },
      { name: 'Bot', value: target.user.bot ? 'Oui' : 'Non', inline: true },
      { name: 'Compte créé', value: `<t:${Math.floor(target.user.createdTimestamp / 1000)}:R>`, inline: true },
      { name: 'A rejoint', value: target.joinedTimestamp ? `<t:${Math.floor(target.joinedTimestamp / 1000)}:R>` : '?', inline: true },
      { name: `Rôles (${roles.size})`, value: roles.size > 0 ? roles.map(r => r.toString()).slice(0, 10).join(' ') : 'Aucun', inline: false },
    ]).setThumbnail(target.user.displayAvatarURL({ size: 256 }))] });
  },

  // +serverinfo
  async serverinfo(message) {
    const g = message.guild;
    await g.members.fetch();
    const bots = g.members.cache.filter(m => m.user.bot).size;
    const humans = g.memberCount - bots;
    message.channel.send({ embeds: [infoEmbed(`🏯 ${g.name}`, [
      { name: 'ID', value: g.id, inline: true },
      { name: 'Propriétaire', value: `<@${g.ownerId}>`, inline: true },
      { name: 'Membres', value: `${humans} humains · ${bots} bots`, inline: true },
      { name: 'Salons', value: `${g.channels.cache.filter(c => c.type === ChannelType.GuildText).size} texte · ${g.channels.cache.filter(c => c.type === ChannelType.GuildVoice).size} vocal`, inline: true },
      { name: 'Rôles', value: `${g.roles.cache.size}`, inline: true },
      { name: 'Boosts', value: `${g.premiumSubscriptionCount} (niveau ${g.premiumTier})`, inline: true },
      { name: 'Créé', value: `<t:${Math.floor(g.createdTimestamp / 1000)}:R>`, inline: true },
    ]).setThumbnail(g.iconURL({ size: 256 }))] });
  },

  // +botinfo
  async botinfo(message) {
    const uptime = formatMs(client.uptime);
    const guilds = client.guilds.cache.size;
    const users = client.guilds.cache.reduce((a, g) => a + g.memberCount, 0);
    message.channel.send({ embeds: [infoEmbed('🤖 Takashi Bot', [
      { name: 'Tag', value: client.user.tag, inline: true },
      { name: 'Uptime', value: uptime, inline: true },
      { name: 'Serveurs', value: `${guilds}`, inline: true },
      { name: 'Utilisateurs', value: `${users}`, inline: true },
      { name: 'Ping', value: `${client.ws.ping}ms`, inline: true },
      { name: 'Version', value: 'v2.0.0', inline: true },
    ]).setThumbnail(client.user.displayAvatarURL())] });
  },

  // +say
  async say(message, args) {
    if (!hasPermission(message.member, PermissionsBitField.Flags.ManageMessages))
      return message.channel.send({ embeds: [errorEmbed('Tu n\'as pas la permission.')] });
    const text = args.join(' ');
    if (!text) return message.channel.send({ embeds: [errorEmbed('Écris un message après +say')] });
    await message.delete().catch(() => {});
    message.channel.send(text);
  },

  // +pic
  async pic(message, args) {
    if (!hasPermission(message.member, PermissionsBitField.Flags.ManageMessages))
      return message.channel.send({ embeds: [errorEmbed('Tu n\'as pas la permission.')] });
    const url = args[0];
    if (!url) return message.channel.send({ embeds: [errorEmbed('Fournis un lien d\'image.')] });
    await message.delete().catch(() => {});
    message.channel.send({ embeds: [new EmbedBuilder().setImage(url).setColor(0x3498db)] });
  },

  // +embed
  async embed(message, args) {
    if (!hasPermission(message.member, PermissionsBitField.Flags.ManageMessages))
      return message.channel.send({ embeds: [errorEmbed('Tu n\'as pas la permission.')] });
    const text = args.join(' ');
    if (!text) return message.channel.send({ embeds: [errorEmbed('Utilisation : `+embed Titre | Description`')] });
    const [title, ...rest] = text.split('|');
    const desc = rest.join('|').trim();
    await message.delete().catch(() => {});
    message.channel.send({ embeds: [new EmbedBuilder().setColor(0x9b59b6).setTitle(title.trim()).setDescription(desc || '\u200b').setTimestamp()] });
  },

  // +poll
  async poll(message, args) {
    if (!hasPermission(message.member, PermissionsBitField.Flags.ManageMessages))
      return message.channel.send({ embeds: [errorEmbed('Tu n\'as pas la permission.')] });
    const question = args.join(' ');
    if (!question) return message.channel.send({ embeds: [errorEmbed('Pose une question après +poll')] });
    await message.delete().catch(() => {});
    const poll = await message.channel.send({ embeds: [new EmbedBuilder().setColor(0x9b59b6).setTitle('📊 Sondage').setDescription(question).setFooter({ text: `Sondage par ${message.author.tag}` }).setTimestamp()] });
    await poll.react('✅');
    await poll.react('❌');
  },

  // +ticket
  async ticket(message) {
    if (!hasPermission(message.member, PermissionsBitField.Flags.ManageChannels))
      return message.channel.send({ embeds: [errorEmbed('Tu n\'as pas la permission.')] });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('ticket_support').setLabel('🆘 Support').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('ticket_staff').setLabel('⚔️ Devenir Staff').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('ticket_partenariat').setLabel('🤝 Partenariat').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('ticket_abus').setLabel('🚨 Signaler un abus').setStyle(ButtonStyle.Danger),
    );

    message.channel.send({
      embeds: [new EmbedBuilder()
        .setColor(0x9b59b6)
        .setTitle('🎴『𝗧𝗜𝗖𝗞𝗘𝗧𝗦』')
        .setDescription('Clique sur un bouton ci-dessous pour ouvrir un ticket.\n\n🆘 **Support** — Un problème sur le serveur\n⚔️ **Devenir Staff** — Candidature staff\n🤝 **Partenariat** — Proposer un partenariat\n🚨 **Signaler un abus** — Signaler un membre')
        .setFooter({ text: 'Takashi 🎌' })
        .setTimestamp()
      ], components: [row],
    });
  },

  // +setup
  async setup(message) {
    if (!hasPermission(message.member, PermissionsBitField.Flags.Administrator))
      return message.channel.send({ embeds: [errorEmbed('Tu dois être administrateur.')] });

    await message.channel.send({ embeds: [new EmbedBuilder().setColor(0xe67e22).setTitle('⚠️ Confirmation').setDescription('Cette commande va **supprimer tous les salons** et les recréer en style anime.\n\nRéponds `confirmer` dans les 15 secondes.')] });

    const filter = m => m.author.id === message.author.id && m.content.toLowerCase() === 'confirmer';
    const collector = message.channel.createMessageCollector({ filter, time: 15_000, max: 1 });

    collector.on('collect', async () => {
      for (const [, channel] of message.guild.channels.cache) await channel.delete().catch(() => {});

      const guild = message.guild;
      const structure = [
        {
          name: "🔱『𝗔𝗗𝗠𝗜𝗡』",
          channels: [
            { name: '🔐『𝘀𝘁𝗮𝗳𝗳-𝗰𝗵𝗮𝘁』', type: 0, private: true },
            { name: '⚙️『𝗰𝗼𝗻𝗳𝗶𝗴』', type: 0, private: true },
            { name: '📲『𝗧𝗶𝗸𝗧𝗼𝗸』', type: 0, private: true },
            { name: '👑『𝗢𝗻𝗹𝘆 𝗮𝗱𝗺𝗶𝗻』', type: 2, private: true },
          ],
        },
        {
          name: "📋『𝗟𝗢𝗚𝗦』",
          channels: [
            { name: '🛡️『𝗺𝗼𝗱-𝗹𝗼𝗴𝘀』', type: 0, private: true },
            { name: '💬『𝗺𝗲𝘀𝘀𝗮𝗴𝗲-𝗹𝗼𝗴𝘀』', type: 0, private: true },
            { name: '🎙️『𝘃𝗼𝗶𝗰𝗲-𝗹𝗼𝗴𝘀』', type: 0, private: true },
            { name: '📥『𝗷𝗼𝗶𝗻-𝗹𝗼𝗴𝘀』', type: 0, private: true },
            { name: '📤『𝗹𝗲𝗮𝘃𝗲-𝗹𝗼𝗴𝘀』', type: 0, private: true },
            { name: '🚀『𝗯𝗼𝗼𝘀𝘁-𝗹𝗼𝗴𝘀』', type: 0, private: true },
          ],
        },
        {
          name: "⛩️『𝗕𝗜𝗘𝗡𝗩𝗘𝗡𝗨𝗘』",
          channels: [
            { name: '⛩️『𝗮𝗰𝗰𝘂𝗲𝗶𝗹』', type: 0 },
            { name: '🌊『𝗮𝘂-𝗿𝗲𝘃𝗼𝗶𝗿』', type: 0 },
            { name: '⚔️『𝗮𝗰𝘁𝘂-𝗴𝗮𝗺𝗶𝗻𝗴』', type: 0 },
            { name: '📯『𝗮𝗻𝗻𝗼𝗻𝗰𝗲𝘀』', type: 0 },
          ],
        },
        {
          name: "🌸『𝗖𝗢𝗠𝗠𝗨𝗡𝗔𝗨𝗧𝗘』",
          channels: [
            { name: '🗡️『𝗿𝗲𝗴𝗹𝗲𝘀』', type: 0 },
            { name: '💬『𝗱𝗶𝘀𝗰𝘂𝘀𝘀𝗶𝗼𝗻』', type: 0 },
            { name: '🎴『𝗺𝗲𝗱𝗶𝗮』', type: 0 },
            { name: '⚙️『𝗰𝗺𝗱𝘀』', type: 0 },
            { name: '🌸『𝘀𝗲𝗹𝗳𝗶𝗲』', type: 0 },
            { name: '💮『𝗹𝗼𝘃𝗲-𝗿𝗼𝗼𝗺』', type: 0 },
            { name: '🎁『𝗴𝗶𝘃𝗲𝗮𝘄𝗮𝘆𝘀』', type: 0 },
            { name: '📜『𝘀𝗼𝗻𝗱𝗮𝗴𝗲𝘀』', type: 0 },
            { name: '🦁『𝗯𝘂𝗺𝗽』', type: 0 },
            { name: '🎭『𝗮𝘂𝘁𝗼-𝗿ô𝗹𝗲𝘀』', type: 0 },
            { name: '📢『𝗮𝗻𝗻𝗼𝗻𝗰𝗲-𝗺𝗲𝗺𝗯𝗿𝗲』', type: 0 },
          ],
        },
        {
          name: "🎴『𝗧𝗜𝗖𝗞𝗘𝗧』",
          channels: [{ name: '🎴『𝘁𝗶𝗰𝗸𝗲𝘁』', type: 0 }],
        },
        {
          name: "🎐『𝗩𝗢𝗖𝗔𝗨𝗫』",
          channels: [
            { name: '🥷『𝗩𝗼𝗰𝗮𝗹 𝟭』', type: 2 },
            { name: '⚔️『𝗩𝗼𝗰𝗮𝗹 𝟮』', type: 2 },
            { name: '🌀『𝗩𝗼𝗰𝗮𝗹 𝟯』', type: 2 },
            { name: '🌑『𝗩𝗼𝗰𝗮𝗹 𝟰』', type: 2 },
            { name: '🔥『𝗩𝗼𝗰𝗮𝗹 𝟱』', type: 2 },
            { name: '🦅『𝗩𝗼𝗰𝗮𝗹 𝟲』', type: 2 },
            { name: '🌸『𝗩𝗼𝗰𝗮𝗹 𝟳』', type: 2 },
            { name: '🌺『𝗩𝗼𝗰𝗮𝗹 𝟴』', type: 2 },
            { name: '🌙『𝗩𝗼𝗰𝗮𝗹 𝟵』', type: 2 },
            { name: '🐉『𝗩𝗼𝗰𝗮𝗹 𝟭𝟬』', type: 2 },
            { name: '💤『𝗟𝗲𝘀 𝗴𝗿𝗮𝗻𝗱𝘀 𝗱𝗼𝗿𝗺𝗲𝘂𝗿𝘀』', type: 2 },
            { name: '🍿『𝗙𝗶𝗹𝗺』', type: 2 },
            { name: '⚽『𝗙𝗼𝗼𝘁𝗯𝗮𝗹𝗹』', type: 2 },
            { name: '🕹️『𝗝𝗲𝘂𝘅 𝘃𝗶𝗱𝗲𝗼』', type: 2 },
            { name: '😴『𝗔𝗳𝗸』', type: 2 },
          ],
        },
      ];

      for (const cat of structure) {
        const category = await guild.channels.create({ name: cat.name, type: 4 });
        for (const ch of cat.channels) {
          const permissionOverwrites = ch.private
            ? [{ id: guild.roles.everyone, deny: [PermissionsBitField.Flags.ViewChannel] }]
            : [];
          await guild.channels.create({ name: ch.name, type: ch.type, parent: category.id, permissionOverwrites });
        }
      }

      const firstChannel = guild.channels.cache.find(c => c.type === ChannelType.GuildText);
      if (firstChannel) firstChannel.send({ embeds: [successEmbed('Setup terminé !', 'Le serveur a été réorganisé en style anime 🎌⛩️')] });
    });

    collector.on('end', (collected) => {
      if (collected.size === 0)
        message.channel.send({ embeds: [errorEmbed('Temps écoulé. Setup annulé.')] }).catch(() => {});
    });
  },
};

// ── Event: ready ──────────────────────────────────────────────────────────────
client.once('ready', () => {
  console.log(`✅ ${client.user.tag} est en ligne sur ${client.guilds.cache.size} serveur(s).`);
  const statuses = [
    { name: '+help | Takashi 🎌', type: 3 },
    { name: `${client.guilds.cache.size} serveurs`, type: 3 },
    { name: 'anime 🎌', type: 0 },
  ];
  let i = 0;
  client.user.setActivity(statuses[0].name, { type: statuses[0].type });
  setInterval(() => {
    i = (i + 1) % statuses.length;
    client.user.setActivity(statuses[i].name, { type: statuses[i].type });
  }, 30_000);
});

// ── Event: messageCreate ──────────────────────────────────────────────────────
client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild || !message.content.startsWith(PREFIX)) return;
  const args = message.content.slice(PREFIX.length).trim().split(/\s+/);
  const commandName = args.shift().toLowerCase();
  const command = commands[commandName];
  if (!command) return;
  try { await command(message, args); }
  catch (err) {
    console.error(`Erreur +${commandName}:`, err);
    message.channel.send({ embeds: [errorEmbed('Une erreur interne s\'est produite.')] }).catch(() => {});
  }
});

// ── Tickets (boutons) ─────────────────────────────────────────────────────────
const ticketTypes = {
  ticket_support:     { label: 'Support',          emoji: '🆘', color: 0x3498db },
  ticket_staff:       { label: 'Devenir Staff',    emoji: '⚔️', color: 0x2ecc71 },
  ticket_partenariat: { label: 'Partenariat',      emoji: '🤝', color: 0x9b59b6 },
  ticket_abus:        { label: 'Signaler un abus', emoji: '🚨', color: 0xe74c3c },
};

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isButton()) return;

  // Fermer ticket
  if (interaction.customId === 'ticket_close') {
    await interaction.reply({ embeds: [new EmbedBuilder().setColor(0xe74c3c).setTitle('🔒 Ticket fermé').setDescription('Ce ticket sera supprimé dans 5 secondes.')], ephemeral: false });
    setTimeout(() => interaction.channel.delete().catch(() => {}), 5000);
    return;
  }

  // Ouvrir ticket
  const type = ticketTypes[interaction.customId];
  if (!type) return;

  const guild = interaction.guild;
  const user  = interaction.user;

  const existing = guild.channels.cache.find(c => c.name === `ticket-${user.username.toLowerCase()}`);
  if (existing) {
    return interaction.reply({ content: `Tu as déjà un ticket ouvert : ${existing}`, ephemeral: true });
  }

  const channel = await guild.channels.create({
    name: `ticket-${user.username.toLowerCase()}`,
    type: ChannelType.GuildText,
    permissionOverwrites: [
      { id: guild.roles.everyone, deny: [PermissionsBitField.Flags.ViewChannel] },
      { id: user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
    ],
  });

  const closeRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ticket_close').setLabel('🔒 Fermer le ticket').setStyle(ButtonStyle.Danger)
  );

  await channel.send({
    content: `${user}`,
    embeds: [new EmbedBuilder()
      .setColor(type.color)
      .setTitle(`${type.emoji} Ticket — ${type.label}`)
      .setDescription(`Bienvenue ${user} !\nUn membre du staff va te répondre rapidement.\n\n**Type :** ${type.label}`)
      .setFooter({ text: 'Takashi 🎌' })
      .setTimestamp()
    ], components: [closeRow],
  });

  interaction.reply({ content: `Ton ticket a été créé : ${channel}`, ephemeral: true });
});

// ── LOGS ──────────────────────────────────────────────────────────────────────
client.on('guildMemberAdd', async (member) => {
  const ch = getLogChannel(member.guild, 'join-logs');
  if (ch) ch.send({ embeds: [new EmbedBuilder().setColor(0x2ecc71).setTitle('👋 Nouveau membre').setDescription(`${member.user} a rejoint le serveur`).addFields({ name: 'Compte créé', value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`, inline: true }, { name: 'ID', value: member.user.id, inline: true }).setThumbnail(member.user.displayAvatarURL()).setTimestamp()] });
});

client.on('guildMemberRemove', async (member) => {
  const ch = getLogChannel(member.guild, 'leave-logs');
  if (ch) ch.send({ embeds: [new EmbedBuilder().setColor(0xe74c3c).setTitle('🚪 Membre parti').setDescription(`**${member.user.tag}** a quitté le serveur`).addFields({ name: 'ID', value: member.user.id, inline: true }).setThumbnail(member.user.displayAvatarURL()).setTimestamp()] });
});

client.on('guildMemberUpdate', async (oldMember, newMember) => {
  const ch = getLogChannel(newMember.guild, 'boost-logs');
  if (!ch) return;
  if (!oldMember.premiumSince && newMember.premiumSince)
    ch.send({ embeds: [new EmbedBuilder().setColor(0xff73fa).setTitle('💎 Nouveau boost !').setDescription(`${newMember.user} a boosted le serveur ! 🚀`).setThumbnail(newMember.user.displayAvatarURL()).setTimestamp()] });
  else if (oldMember.premiumSince && !newMember.premiumSince)
    ch.send({ embeds: [new EmbedBuilder().setColor(0x95a5a6).setTitle('💎 Boost retiré').setDescription(`${newMember.user} a retiré son boost.`).setTimestamp()] });
});

client.on('messageDelete', async (message) => {
  if (!message.guild || message.author?.bot) return;
  const ch = getLogChannel(message.guild, 'message-logs');
  if (ch) ch.send({ embeds: [new EmbedBuilder().setColor(0xe74c3c).setTitle('🗑️ Message supprimé').addFields({ name: 'Auteur', value: message.author?.tag || 'Inconnu', inline: true }, { name: 'Salon', value: `${message.channel}`, inline: true }, { name: 'Contenu', value: message.content?.slice(0, 1024) || '*Aucun contenu*' }).setTimestamp()] });
});

client.on('messageUpdate', async (oldMessage, newMessage) => {
  if (!oldMessage.guild || oldMessage.author?.bot || oldMessage.content === newMessage.content) return;
  const ch = getLogChannel(oldMessage.guild, 'message-logs');
  if (ch) ch.send({ embeds: [new EmbedBuilder().setColor(0xe67e22).setTitle('✏️ Message modifié').setURL(newMessage.url).addFields({ name: 'Auteur', value: oldMessage.author?.tag || 'Inconnu', inline: true }, { name: 'Salon', value: `${oldMessage.channel}`, inline: true }, { name: 'Avant', value: oldMessage.content?.slice(0, 1024) || '*Vide*' }, { name: 'Après', value: newMessage.content?.slice(0, 1024) || '*Vide*' }).setTimestamp()] });
});

client.on('voiceStateUpdate', async (oldState, newState) => {
  const ch = getLogChannel(newState.guild, 'voice-logs');
  if (!ch) return;
  const member = newState.member;
  if (!oldState.channel && newState.channel)
    ch.send({ embeds: [new EmbedBuilder().setColor(0x3498db).setTitle('🎙️ Vocal rejoint').setDescription(`${member.user.tag} a rejoint **${newState.channel.name}**`).setTimestamp()] });
  else if (oldState.channel && !newState.channel)
    ch.send({ embeds: [new EmbedBuilder().setColor(0x95a5a6).setTitle('🎙️ Vocal quitté').setDescription(`${member.user.tag} a quitté **${oldState.channel.name}**`).setTimestamp()] });
  else if (oldState.channel && newState.channel && oldState.channel.id !== newState.channel.id)
    ch.send({ embeds: [new EmbedBuilder().setColor(0x9b59b6).setTitle('🎙️ Vocal changé').setDescription(`${member.user.tag} : **${oldState.channel.name}** → **${newState.channel.name}**`).setTimestamp()] });
});

// ── Anti-crash ────────────────────────────────────────────────────────────────
process.on('unhandledRejection', (err) => console.error('unhandledRejection:', err));
process.on('uncaughtException',  (err) => console.error('uncaughtException:',  err));

// ── Login ─────────────────────────────────────────────────────────────────────
client.login(process.env.DISCORD_TOKEN);

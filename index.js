require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const mongoose = require('mongoose');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// --- MongoDB Schema ---
const projectSchema = new mongoose.Schema({
  name: String,
  roles: [String],
  channelId: String,
  channelIds: [String],
  assignments: { type: Map, of: [String] },
  saisons: { type: Map, of: { debut: Number, fin: Number } },
  chapters: { type: Map, of: Map },
  jour: String,
});

const Project = mongoose.model('Project', projectSchema);

// --- Helpers ---
async function loadData() {
  const projects = await Project.find();
  const data = {};
  for (const p of projects) {
    data[p.name] = {
      roles: p.roles,
      channelId: p.channelId,
      channelIds: p.channelIds || [],
      assignments: Object.fromEntries(p.assignments || new Map()),
      saisons: Object.fromEntries(
        [...(p.saisons || new Map())].map(([k, v]) => [k, { debut: v.debut, fin: v.fin }])
      ),
      chapters: Object.fromEntries(
        [...(p.chapters || new Map())].map(([k, v]) => [k.replace(/·/g, '.'), Object.fromEntries(v)])
      ),
      jour: p.jour || null,
    };
  }
  return data;
}

async function saveProject(name, project) {
  await Project.findOneAndUpdate(
    { name },
    {
      name,
      roles: project.roles,
      channelId: project.channelId,
      channelIds: project.channelIds || [],
      assignments: project.assignments || {},
      saisons: project.saisons || {},
      chapters: Object.fromEntries(
        Object.entries(project.chapters || {}).map(([k, v]) => [k.replace(/\./g, '·'), v])
      ),
      jour: project.jour || null,
    },
    { upsert: true, new: true }
  );
}

async function deleteProject(name) {
  await Project.deleteOne({ name });
}

const ROLES_ORDER = ['raws', 'clean', 'trad', 'check', 'edit', 'qcheck'];

function getAvailableTodos(chapter) {
  const done = r => chapter[r] === true;
  const exists = r => chapter[r] !== undefined;
  const pending = r => chapter[r] === false;
  const available = [];
  if (exists('raws') && pending('raws')) available.push('raws');
  if (exists('clean') && pending('clean') && done('raws')) available.push('clean');
  if (exists('trad') && pending('trad')) available.push('trad');
  if (exists('check') && pending('check') && done('trad')) available.push('check');
  if (exists('edit') && pending('edit') && done('trad') && done('clean')) available.push('edit');
  if (exists('qcheck') && pending('qcheck') && done('edit')) available.push('qcheck');
  return available;
}

function getStatusBar(chapter) {
  return ROLES_ORDER.map(r => {
    if (chapter[r] === undefined) return null;
    if (chapter[r] === true) return `~~${r}~~`;
    const available = getAvailableTodos(chapter);
    if (available.includes(r)) return `**${r}**`;
    return r;
  }).filter(Boolean).join(' → ');
}

function nextTodo(chapter) {
  const available = getAvailableTodos(chapter);
  return available.length ? available[0] : null;
}

function isChapterDone(chapter) {
  return ROLES_ORDER.every(r => chapter[r] === undefined || chapter[r] === true);
}

function findProjectByChannel(data, channelId) {
  return Object.entries(data).find(([, p]) =>
    p.channelId === channelId || (p.channelIds && p.channelIds.includes(channelId))
  )?.[0];
}

client.on('ready', () => {
  console.log(`✅ Bot connecté en tant que ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  const content = message.content.trim();
  const lower = content.toLowerCase();

  // ─── !aide ───────────────────────────────────────────────
  if (lower === '!aide') {
    const embed = new EmbedBuilder()
      .setTitle('📖 Commandes du bot Scantrad')
      .setColor(0xc9a4ff)
      .addFields(
        { name: '⚙️ Setup', value: '`!projet "<nom>" <roles>` — Créer un projet (ex: `!projet "A Saint" raws,trad,clean,edit,qcheck`)\n`!lier <nom>` — Lier ce salon à un projet\n`!delier` — Délier ce salon du projet\n`!ajoutrole <role>` — Ajouter un rôle au projet\n`!supprole <role>` — Supprimer un rôle du projet\n`!projets` — Lister tous les projets\n`!suppprojet <nom>` — Supprimer un projet' },
        { name: '📺 Saisons', value: '`!ajoutsaison <nom> <debut>-<fin>` — Créer une saison (ex: `!ajoutsaison S1 1-54`)\n`!ajoutsaison <nom> <debut>` — Saison sans fin connue (ex: `!ajoutsaison S4 128`)\n`!saisons` — Voir toutes les saisons\n`!chapitres <saison>` — Chapitres d\'une saison (ex: `!chapitres S4`)' },
        { name: '📌 Chapitres', value: '`Chapitre <n> : <role>` — Marquer terminé (ex: `Chapitre 145 : raws, trad`)\n`Chapitre <n>-<n> : <role>` — Plusieurs chapitres (ex: `Chapitre 145-146-147 : raws`)\n`!fait <n> <role>` — Marquer un rôle terminé\n`!majo <debut>-<fin> <role>` — Marquer en masse (ex: `!majo 1-140 raws`)\n`!chapitres` — Les 5 prochains chapitres en cours\n`!chapitre <n>` — Détail d\'un chapitre\n`!suppchap <n>` — Supprimer un chapitre' },
        { name: '📋 Suivi', value: '`!avancement` — Ce qu\'il reste à faire\n`!stats` — Stats globales du projet\n`!mestaches` — Vos tâches assignées\n`!taches @user` — Voir les tâches d\'un membre\n`!mesprojets` — Voir tous vos projets et rôles\n`!assigner <role> @user` — Assigner un rôle\n`!desassigner <role>` — Retirer une assignation\n`!equipe` — Voir l\'équipe du projet' },
        { name: '❓ Aide', value: '`!aide` — Afficher cette aide' }
      )
      .setFooter({ text: 'Cookie Voie Lactée ✨' });
    return message.reply({ embeds: [embed] });
  }

  // ─── !projets ────────────────────────────────────────────
  if (lower === '!projets') {
    const data = await loadData();
    const names = Object.keys(data).sort();
    if (!names.length) return message.reply('Aucun projet créé pour l\'instant.');
    const list = names.map(n => {
      const p = data[n];
      const chapEntries = Object.entries(p.chapters || {});
      const doneNums = new Set(chapEntries.filter(([, c]) => isChapterDone(c)).map(([n]) => n.replace(/[.,]\d+[a-zA-Z]*$/, '').replace(/[a-zA-Z]+$/, '')));
      const done = doneNums.size;
      const saisons = p.saisons || {};
      const lastSaison = Object.values(saisons).sort((a, b) => b.debut - a.debut)[0];
      const total = lastSaison?.fin ?? null;
      return `• **${n}** — ${total ? `${done}/${total}` : `${done}`} chapitres terminés`;
    }).join('\n');
    const embed = new EmbedBuilder()
      .setTitle('📚 Projets en cours')
      .setDescription(list)
      .setColor(0xc9a4ff);
    return message.reply({ embeds: [embed] });
  }

  // ─── !projet <nom> <roles> ───────────────────────────────
  if (lower.startsWith('!projet ')) {
   const projetMatch = content.slice(8).trim().match(/^"([^"]+)"\s+(\S+)|^(\S+)\s+(\S+)|^"([^"]+)"|^(\S+)/);
    const name = projetMatch[1] || projetMatch[3] || projetMatch[5] || projetMatch[6];
    const rolesRaw = projetMatch[2] || projetMatch[4] || 'raws,trad,clean,edit,qcheck';
    const roles = rolesRaw.split(',').map(r => r.trim().toLowerCase());
    const data = await loadData();
    if (data[name]) return message.reply(`Le projet **${name}** existe déjà.`);
    await saveProject(name, { roles, chapters: {}, channelId: null, channelIds: [], assignments: {}, saisons: {} });
    return message.reply(`✅ Projet **${name}** créé avec les rôles : ${roles.join(', ')}\nUtilise \`!lier ${name}\` dans le salon de ce projet.`);
  }

  // ─── !lier <nom> ─────────────────────────────────────────
  if (lower.startsWith('!lier ')) {
    const name = content.slice(6).trim();
    const data = await loadData();
    if (!data[name]) return message.reply(`Projet **${name}** introuvable.`);
    const project = data[name];
    if (!project.channelIds) project.channelIds = [];
    if (project.channelId && !project.channelIds.includes(project.channelId)) {
      project.channelIds.push(project.channelId);
    }
    if (!project.channelIds.includes(message.channelId)) project.channelIds.push(message.channelId);
    project.channelId = message.channelId;
    await saveProject(name, project);
    const count = project.channelIds.length;
    return message.reply(`✅ Ce salon est maintenant lié au projet **${name}**. (${count} salon${count > 1 ? 's' : ''} lié${count > 1 ? 's' : ''})`);
  }

  // ─── !delier ─────────────────────────────────────────────
  if (lower === '!delier') {
    const data = await loadData();
    const projectName = findProjectByChannel(data, message.channelId);
    if (!projectName) return message.reply('Ce salon n\'est pas lié à un projet.');
    const project = data[projectName];
    project.channelIds = (project.channelIds || []).filter(id => id !== message.channelId);
    if (project.channelId === message.channelId) project.channelId = project.channelIds[0] || null;
    await saveProject(projectName, project);
    return message.reply(`✅ Ce salon a été délié du projet **${projectName}**.`);
  }

// ─── Format alternatif : > Chapitre X, Y\n> Role (Fait) ─
  const faitLines = content.match(/>\s*([a-zA-Z]+)\s*\(fait\)/gi);
  const altMatch = faitLines && content.includes('(Fait)') ? content.match(/chapitre\s+([\d,\s]+)/i) : null;
  const isAltFormat = !!(altMatch && faitLines);
  console.log('altMatch:', altMatch, 'faitLines:', faitLines, 'isAltFormat:', isAltFormat);
  if (isAltFormat) {
    const chNums = altMatch[1].split(',').map(s => s.trim()).filter(Boolean);
    const data = await loadData();
    const projectName = findProjectByChannel(data, message.channelId);
    if (!projectName) return;
    const project = data[projectName];
    const roles = faitLines
      .map(l => l.match(/>\s*([a-zA-Z]+)\s*\(fait\)/i)?.[1]?.toLowerCase())
      .filter(r => r && project.roles.includes(r));
    if (!chNums.length || !roles.length) return;
    for (const chNum of chNums) {
      if (!project.chapters[chNum]) {
        project.chapters[chNum] = {};
        project.roles.forEach(r => project.chapters[chNum][r] = false);
      }
      for (const role of roles) {
        if (project.chapters[chNum][role] === undefined) continue;
        project.chapters[chNum][role] = true;
        if (isChapterDone(project.chapters[chNum])) project.chapters[chNum].done = true;
      }
    }
    await saveProject(projectName, project);
    const chList = chNums.join(', ');
    const roleList = roles.join(', ');
    const lastCh = project.chapters[chNums[chNums.length - 1]];
    const available = getAvailableTodos(lastCh);
    const reply = available.length
      ? `✅ **Ch.${chList} — ${roleList}** marqué(s) terminé(s) !\nEn attente : **${available.map(r => r.toUpperCase()).join(', ')}**`
      : `🎉 **Ch.${chList}** entièrement terminé(s) !`;
    return message.reply(reply);
  }

// ─── Format raccourci : role numéro ──────────────────────
  const shortMatch = content.match(/^(raws|clean|trad|check|edit|qcheck|qch|q-check)\s+([\d]+(?:[.,]\d+)?[a-zA-Z]?(?:(?:[,+à]|a\s)[\d]+(?:[.,]\d+)?[a-zA-Z]?)*)\s*$/i);
  if (shortMatch) {
    let role = shortMatch[1].toLowerCase().replace(/-/g, '');
    if (role === 'qch') role = 'qcheck';
    const chNums = shortMatch[2].split(/[,+]/).map(s => s.trim()).filter(Boolean);
    const data = await loadData();
    const projectName = findProjectByChannel(data, message.channelId);
    if (!projectName) return message.reply('Ce salon n\'est pas lié à un projet. Utilise `!lier <nom>`.');
    const project = data[projectName];
    if (!project.roles.includes(role)) return message.reply(`Rôle **${role}** inconnu dans ce projet.`);
    for (const chNum of chNums) {
      if (!project.chapters[chNum]) {
        project.chapters[chNum] = {};
        project.roles.forEach(r => project.chapters[chNum][r] = false);
      }
      if (project.chapters[chNum][role] !== undefined) project.chapters[chNum][role] = true;
    }
    await saveProject(projectName, project);
    const chList = chNums.join(', ');
    const lastCh = project.chapters[chNums[chNums.length - 1]];
    const available = getAvailableTodos(lastCh);
    const reply = available.length
      ? `✅ **Ch.${chList} — ${role}** marqué(s) terminé(s) !\nEn attente : **${available.map(r => r.toUpperCase()).join(', ')}**`
      : `🎉 **Ch.${chList}** entièrement terminé(s) !`;
    return message.reply(reply);
  }

  // ─── Détecter "Chapitre N : role" (format naturel) ───────
  const naturalMatch = content.match(/^(?:chapitre|chap)\s+([\d]+(?:[.,]\d+)?[a-zA-Z]?(?:(?:[-,]|\s*(?:à|a)\s*)[\d]+(?:[.,]\d+)?[a-zA-Z]?)*)\s*(?:[:,]|-\s*(?=[a-zA-Z]))\s*(.+)$/i);
  if (naturalMatch) {
    console.log('naturalMatch:', naturalMatch[1], naturalMatch[2]);
    const rangeMatch = naturalMatch[1].match(/^(\d+)\s*(?:à|a)\s*(\d+)$/i);
    const isDecimal = naturalMatch[1].includes('.');
    let chNums;
    if (rangeMatch) {
      chNums = [];
      for (let i = Number(rangeMatch[1]); i <= Number(rangeMatch[2]); i++) {
        chNums.push(String(i));
      }
    } else {
      chNums = isDecimal ? [naturalMatch[1].trim()] : naturalMatch[1].split(/[-,]/).map(s => s.trim()).filter(Boolean);
    }
    const data = await loadData();
    const projectName = findProjectByChannel(data, message.channelId);
    if (!projectName) return message.reply('Ce salon n\'est pas lié à un projet. Utilise `!lier <nom>`.');
    const project = data[projectName];
    const roles = naturalMatch[2].split(',').map(r => {
      let role = r.trim().toLowerCase().split(' ')[0].replace(/-/g, '');
      if (role === 'qch') role = 'qcheck';
      return role;
    }).filter(r => project.roles.includes(r));
    for (const chNum of chNums) {
      if (!project.chapters[chNum]) {
        project.chapters[chNum] = {};
        project.roles.forEach(r => project.chapters[chNum][r] = false);
      }
      for (const role of roles) {
        if (project.chapters[chNum][role] === undefined) continue;
        project.chapters[chNum][role] = true;
        if (isChapterDone(project.chapters[chNum])) project.chapters[chNum].done = true;
      }
    }
    await saveProject(projectName, project);
    const chList = chNums.join(', ');
    const roleList = roles.join(', ');
    const lastCh = project.chapters[chNums[chNums.length - 1]];
    const available = getAvailableTodos(lastCh);
    const reply = available.length
      ? `✅ **Ch.${chList} — ${roleList}** marqué(s) terminé(s) !\nEn attente : **${available.map(r => r.toUpperCase()).join(', ')}**`
      : `🎉 **Ch.${chList}** entièrement terminé(s) !`;
    return message.reply(reply);
  }

  // ─── !fait <n> <role> ────────────────────────────────────
  if (lower.startsWith('!fait ')) {
    const parts = content.slice(6).trim().split(' ');
    const chNum = parts[0];
    const role = parts[1]?.toLowerCase();
    if (!chNum || !role) return message.reply('Usage : `!fait <chapitre> <role>`');
    const data = await loadData();
    const projectName = findProjectByChannel(data, message.channelId);
    if (!projectName) return message.reply('Ce salon n\'est pas lié à un projet.');
    const project = data[projectName];
    if (!project.chapters[chNum]) {
      project.chapters[chNum] = {};
      project.roles.forEach(r => project.chapters[chNum][r] = false);
    }
    if (project.chapters[chNum][role] === undefined) return message.reply(`Rôle **${role}** inconnu.`);
    project.chapters[chNum][role] = true;
    if (isChapterDone(project.chapters[chNum])) project.chapters[chNum].done = true;
    await saveProject(projectName, project);
    const available = getAvailableTodos(project.chapters[chNum]);
    return message.reply(available.length
      ? `✅ Ch.${chNum} — ${role} terminé ! En attente : **${available.map(r => r.toUpperCase()).join(', ')}**`
      : `🎉 Ch.${chNum} entièrement terminé !`);
  }

  // ─── !chapitre <n> ───────────────────────────────────────
  if (lower.startsWith('!chapitre ')) {
    const chNum = content.slice(10).trim();
    const data = await loadData();
    const projectName = findProjectByChannel(data, message.channelId);
    if (!projectName) return message.reply('Ce salon n\'est pas lié à un projet.');
    const project = data[projectName];
    const ch = project.chapters[chNum];
    if (!ch) return message.reply(`Ch.${chNum} non trouvé. Utilise \`Chapitre ${chNum} : raws\` pour commencer.`);
    const available = getAvailableTodos(ch);
    const lines = project.roles.map(r => {
      if (ch[r] === true) return `✅ ${r}`;
      if (available.includes(r)) return `🔄 ${r}`;
      return `⬜ ${r}`;
    }).join('\n');
    const embed = new EmbedBuilder()
      .setTitle(`📖 ${projectName} — Chapitre ${chNum}`)
      .setDescription(lines)
      .setColor(isChapterDone(ch) ? 0x22c55e : 0xc9a4ff);
    return message.reply({ embeds: [embed] });
  }

  // ─── !chapitres ──────────────────────────────────────────
  if (lower === '!chapitres' || lower === '!chapitres all') {
    const data = await loadData();
    const projectName = findProjectByChannel(data, message.channelId);
    if (!projectName) return message.reply('Ce salon n\'est pas lié à un projet.');
    const project = data[projectName];
    const chapters = Object.entries(project.chapters)
      .sort(([a], [b]) => {
        const numA = parseFloat(a);
        const numB = parseFloat(b);
        if (numA !== numB) return numA - numB;
        return a.localeCompare(b);
      });
    const pending = chapters.filter(([, ch]) => !isChapterDone(ch)).slice(0, 5);
    if (!pending.length && !chapters.length) return message.reply('🎉 Tous les chapitres sont terminés !');
    const toShow = [...pending];
    if (toShow.length < 5 && chapters.length) {
      const lastKnown = Math.floor(parseFloat(chapters[chapters.length - 1][0]));
      for (let i = 1; toShow.length < 5; i++) {
        toShow.push([String(lastKnown + i), null]);
      }
    }
    const premiers = ['raws', 'trad'].filter(r => project.roles.includes(r));
    const lines = toShow.map(([n, ch]) => {
      if (!ch) return `🔄 **Ch.${n}** — en attente : **${premiers.map(r => r.toUpperCase()).join(', ')}**`;
      const available = getAvailableTodos(ch);
      const attente = available.length ? `— en attente : **${available.map(r => r.toUpperCase()).join(', ')}**` : '— terminé !';
      return `🔄 **Ch.${n}** ${attente}`;
    }).join('\n');
    const embed = new EmbedBuilder()
      .setTitle(`📚 ${projectName} — Chapitres en cours`)
      .setDescription(lines)
      .setColor(0xc9a4ff);
    return message.reply({ embeds: [embed] });
  }

  // ─── !avancement ─────────────────────────────────────────
  if (lower === '!avancement') {
    const data = await loadData();
    const projectName = findProjectByChannel(data, message.channelId);
    if (!projectName) return message.reply('Ce salon n\'est pas lié à un projet.');
    const project = data[projectName];
    const allChapters = Object.entries(project.chapters)
      .sort(([a], [b]) => {
        const numA = parseFloat(a);
        const numB = parseFloat(b);
        if (numA !== numB) return numA - numB;
        return a.localeCompare(b);
      });
    const pending = allChapters.filter(([, ch]) => !isChapterDone(ch)).slice(0, 5);
    if (!pending.length) return message.reply('🎉 Tout est à jour ! Aucun chapitre en attente.');
    const toShow = [...pending];
    if (toShow.length < 5) {
      const lastKnown = Math.floor(parseFloat(allChapters[allChapters.length - 1][0]));
      for (let i = 1; toShow.length < 5; i++) {
        toShow.push([String(lastKnown + i), null]);
      }
    }
    const premiers = ['raws', 'trad'].filter(r => project.roles.includes(r));
    const lines = toShow.map(([n, ch]) => {
      if (!ch) {
        const fakeCh = {};
        project.roles.forEach(r => fakeCh[r] = false);
        const bar = getStatusBar(fakeCh);
        return `**Ch.${n}** — en attente : **${premiers.map(r => r.toUpperCase()).join(', ')}**\n${bar}`;
      }
      const available = getAvailableTodos(ch);
      const bar = getStatusBar(ch);
      return `**Ch.${n}** — en attente : **${available.map(r => r.toUpperCase()).join(', ')}**\n${bar}`;
    }).join('\n\n');
    const embed = new EmbedBuilder()
      .setTitle(`📋 ${projectName} — Ce qu'il reste à faire`)
      .setDescription(lines)
      .setColor(0xc9a4ff);
    return message.reply({ embeds: [embed] });
  }

  // ─── !stats ──────────────────────────────────────────────
  if (lower === '!stats') {
    const data = await loadData();
    const projectName = findProjectByChannel(data, message.channelId);
    if (!projectName) return message.reply('Ce salon n\'est pas lié à un projet.');
    const project = data[projectName];
    const chapters = Object.entries(project.chapters);
    const doneNums = new Set(
      chapters
        .filter(([, c]) => isChapterDone(c))
        .map(([n]) => n.replace(/[.,]\d+[a-zA-Z]*$/, '').replace(/[a-zA-Z]+$/, ''))
    );
    const done = doneNums.size;
    const saisons = project.saisons || {};
    const dernierTermine = Math.max(...chapters.filter(([, c]) => isChapterDone(c)).map(([n]) => parseFloat(n)));
    const saisonEnCours = Object.values(saisons)
      .sort((a, b) => b.fin - a.fin)
      .find(s => s.fin !== null);
    const total = saisonEnCours?.fin ?? null;
    const roleLines = ROLES_ORDER.filter(r => project.roles.includes(r)).map(r => {
      const doneForRole = new Set(
        chapters
          .filter(([, c]) => c[r] === true)
          .map(([n]) => n.replace(/[.,]\d+[a-zA-Z]*$/, '').replace(/[a-zA-Z]+$/, ''))
      );
      const count = doneForRole.size;
      return `**${r.toUpperCase()}** : ${count}${total ? `/${total}` : ''}`;
    }).join('\n');
    const embed = new EmbedBuilder()
      .setTitle(`📊 ${projectName} — ${total ? `${done}/${total} terminés` : `${done} terminés`}`)
      .setDescription(roleLines)
      .setColor(0xc9a4ff);
    return message.reply({ embeds: [embed] });
  }

  // ─── !assigner <role> @user ──────────────────────────────
  if (lower.startsWith('!assigner ')) {
    const parts = content.slice(10).trim().split(' ');
    const role = parts[0]?.toLowerCase();
    const userId = message.mentions.users.first()?.id;
    if (!role || !userId) return message.reply('Usage : `!assigner <role> @user`');
    const data = await loadData();
    const projectName = findProjectByChannel(data, message.channelId);
    if (!projectName) return message.reply('Ce salon n\'est pas lié à un projet.');
    const project = data[projectName];
    if (!project.assignments[userId]) project.assignments[userId] = [];
    if (!project.assignments[userId].includes(role)) project.assignments[userId].push(role);
    await saveProject(projectName, project);
    return message.reply(`✅ <@${userId}> assigné(e) au rôle **${role}** sur **${projectName}**.`);
  }

  // ─── !mestaches ──────────────────────────────────────────
  if (lower === '!mestaches') {
    const data = await loadData();
    const userId = message.author.id;
    const lines = [];
    for (const [name, project] of Object.entries(data)) {
      const userRoles = project.assignments[userId] || [];
      if (!userRoles.length) continue;
      const pending = Object.entries(project.chapters)
        .filter(([, ch]) => {
          const available = getAvailableTodos(ch);
          return userRoles.some(r => ch[r] === false && available.includes(r));
        })
        .sort(([a], [b]) => {
          const numA = parseFloat(a);
          const numB = parseFloat(b);
          if (numA !== numB) return numA - numB;
          return a.localeCompare(b);
        });
      const notStarted = [];
      for (const [, saison] of Object.entries(project.saisons || {})) {
        const fin = saison.fin ?? Math.max(...Object.keys(project.chapters).map(n => parseInt(n)).filter(n => !isNaN(n)));
        for (let i = saison.debut; i <= fin; i++) {
          const n = String(i);
          if (!project.chapters[n] && userRoles.some(r => ['raws', 'trad'].includes(r))) {
            notStarted.push(n);
          }
        }
      }
      if (pending.length || notStarted.length) {
        lines.push(`**${name}** :`);
        const grouped = [];
        console.log('pending Honey:', pending.map(([n]) => n));
        pending.forEach(([n, ch]) => {
          const available = getAvailableTodos(ch);
          const todo = userRoles.filter(r => ch[r] === false && available.includes(r)).map(r => r.toUpperCase()).join(', ');
          if (!todo) return;
          const last = grouped[grouped.length - 1];
          const hasLetter = n.match(/[a-zA-Z]/);
          const lastHasLetter = last?.end?.match(/[a-zA-Z]/);
          const isConsecutive = last && last.todo === todo
            && !hasLetter
            && !lastHasLetter
            && Number(n) === Number(last.end) + 1;
          if (isConsecutive) {
            last.end = n;
          } else {
            grouped.push({ start: n, end: n, todo });
          }
        });
        grouped.forEach(({ start, end, todo }) => {
          lines.push(start === end ? `  • Ch.${start} — ${todo}` : `  • Ch.${start}~${end} — ${todo}`);
        });
        if (notStarted.length) {
          const first = notStarted[0];
          const last = notStarted[notStarted.length - 1];
          const todoRoles = userRoles.filter(r => ['raws', 'trad'].includes(r)).map(r => r.toUpperCase()).join(', ');
          lines.push(`  • Ch.${first}~${last} — ${todoRoles}`);
        }
      }
    }
    if (!lines.length) return message.reply('✅ Tu n\'as aucune tâche en attente !');
    const embed = new EmbedBuilder()
      .setTitle(`📋 Tâches de ${message.author.username}`)
      .setDescription(lines.join('\n'))
      .setColor(0xc9a4ff);
    return message.reply({ embeds: [embed] });
  }

  // ─── !suppchap <n> ───────────────────────────────────────
  if (lower.startsWith('!suppchap ')) {
    const chNum = content.slice(10).trim();
    const data = await loadData();
    const projectName = findProjectByChannel(data, message.channelId);
    if (!projectName) return message.reply('Ce salon n\'est pas lié à un projet.');
    const project = data[projectName];
    if (!project.chapters[chNum]) return message.reply(`Chapitre **${chNum}** introuvable.`);
    delete project.chapters[chNum];
    await saveProject(projectName, project);
    return message.reply(`✅ Chapitre **${chNum}** supprimé.`);
  }

  // ─── !ajoutrole <role> ───────────────────────────────────
  if (lower.startsWith('!ajoutrole ')) {
    const role = content.slice(11).trim().toLowerCase();
    const data = await loadData();
    const projectName = findProjectByChannel(data, message.channelId);
    if (!projectName) return message.reply('Ce salon n\'est pas lié à un projet.');
    const project = data[projectName];
    if (project.roles.includes(role)) return message.reply(`Le rôle **${role}** existe déjà.`);
    project.roles.push(role);
    Object.values(project.chapters).forEach(ch => ch[role] = false);
    await saveProject(projectName, project);
    return message.reply(`✅ Rôle **${role}** ajouté au projet **${projectName}** et à tous les chapitres existants.`);
  }

  // ─── !supprole <role> ────────────────────────────────────
  if (lower.startsWith('!supprole ')) {
    const role = content.slice(10).trim().toLowerCase();
    const data = await loadData();
    const projectName = findProjectByChannel(data, message.channelId);
    if (!projectName) return message.reply('Ce salon n\'est pas lié à un projet.');
    const project = data[projectName];
    if (!project.roles.includes(role)) return message.reply(`Rôle **${role}** introuvable.`);
    project.roles = project.roles.filter(r => r !== role);
    Object.values(project.chapters).forEach(ch => delete ch[role]);
    await saveProject(projectName, project);
    return message.reply(`✅ Rôle **${role}** supprimé du projet **${projectName}**.`);
  }

  // ─── !ajoutsaison <nom> <debut>-<fin> ────────────────────
  if (lower.startsWith('!ajoutsaison ')) {
    const parts = content.slice(13).trim().split(' ');
    const nom = parts[0];
    const range = parts[1];
    const match = range?.match(/^(\d+)(?:-(\d+))?$/);
    if (!match) return message.reply('Usage : `!ajoutsaison S1 1-54` ou `!ajoutsaison S4 128` si fin inconnue');
    const data = await loadData();
    const projectName = findProjectByChannel(data, message.channelId);
    if (!projectName) return message.reply('Ce salon n\'est pas lié à un projet.');
    const project = data[projectName];
    if (!project.saisons) project.saisons = {};
    project.saisons[nom] = { debut: Number(match[1]), fin: match[2] ? Number(match[2]) : null };
    await saveProject(projectName, project);
    return message.reply(`✅ Saison **${nom}** enregistrée : chapitres ${match[1]} à ${match[2] ?? '?'}.`);
  }

// ─── !taches @user ────────────────────────────────────────
  if (lower.startsWith('!taches ')) {
    const userId = message.mentions.users.first()?.id;
    if (!userId) return message.reply('Usage : `!taches @user`');
    const data = await loadData();
    const lines = [];
    for (const [name, project] of Object.entries(data)) {
      const userRoles = project.assignments[userId] || [];
      if (!userRoles.length) continue;
      const pending = Object.entries(project.chapters)
        .filter(([, ch]) => {
          const available = getAvailableTodos(ch);
          return userRoles.some(r => ch[r] === false && available.includes(r));
        })
        .sort(([a], [b]) => parseFloat(a) - parseFloat(b));
      const notStarted = [];
      for (const [, saison] of Object.entries(project.saisons || {})) {
        const fin = saison.fin ?? Math.max(...Object.keys(project.chapters).map(n => parseInt(n)).filter(n => !isNaN(n)));
        for (let i = saison.debut; i <= fin; i++) {
          const n = String(i);
          if (!project.chapters[n] && userRoles.some(r => ['raws', 'trad'].includes(r))) {
            notStarted.push(n);
          }
        }
      }
      if (pending.length || notStarted.length) {
        lines.push(`**${name}** :`);
        const grouped = [];
        console.log('pending Honey:', pending.map(([n]) => n));
        pending.forEach(([n, ch]) => {
          const available = getAvailableTodos(ch);
          const todo = userRoles.filter(r => ch[r] === false && available.includes(r)).map(r => r.toUpperCase()).join(', ');
          if (!todo) return;
          const last = grouped[grouped.length - 1];
          const nextNum = Number(last?.end) + 1;
          if (last && last.todo === todo && !n.match(/[a-zA-Z]/) && !last.end?.match(/[a-zA-Z]/) && Number(n) === nextNum) {
            last.end = n;
          } else {
            grouped.push({ start: n, end: n, todo });
          }
        });
        grouped.forEach(({ start, end, todo }) => {
          lines.push(start === end ? `  • Ch.${start} — ${todo}` : `  • Ch.${start}~${end} — ${todo}`);
        });
        if (notStarted.length) {
          const first = notStarted[0];
          const last = notStarted[notStarted.length - 1];
          const todoRoles = userRoles.filter(r => ['raws', 'trad'].includes(r)).map(r => r.toUpperCase()).join(', ');
          lines.push(`  • Ch.${first}~${last} — ${todoRoles}`);
        }
      }
    }
    if (!lines.length) return message.reply(`✅ <@${userId}> n'a aucune tâche en attente !`);
    const embed = new EmbedBuilder()
      .setTitle(`📋 Tâches de <@${userId}>`)
      .setDescription(lines.join('\n'))
      .setColor(0xc9a4ff);
    return message.reply({ embeds: [embed] });
  }

  // ─── !saisons ────────────────────────────────────────────
  if (lower === '!saisons') {
    const data = await loadData();
    const projectName = findProjectByChannel(data, message.channelId);
    if (!projectName) return message.reply('Ce salon n\'est pas lié à un projet.');
    const saisons = data[projectName].saisons || {};
    if (!Object.keys(saisons).length) return message.reply('Aucune saison enregistrée. Utilise `!ajoutsaison S1 1-54`');
    const lines = Object.entries(saisons).map(([nom, s]) => `**${nom}** : Ch.${s.debut} ~ Ch.${s.fin ?? '?'}`).join('\n');
    const embed = new EmbedBuilder()
      .setTitle(`📺 Saisons de **${projectName}**`)
      .setDescription(lines)
      .setColor(0xc9a4ff);
    return message.reply({ embeds: [embed] });
  }

  // ─── !chapitres <saison> ─────────────────────────────────
  if (lower.startsWith('!chapitres ')) {
    const saisonNom = content.slice(11).trim();
    const data = await loadData();
    const projectName = findProjectByChannel(data, message.channelId);
    if (!projectName) return message.reply('Ce salon n\'est pas lié à un projet.');
    const project = data[projectName];
    const saison = project.saisons?.[saisonNom];
    if (!saison) return message.reply(`Saison **${saisonNom}** introuvable. Vérifie avec \`!saisons\``);
    const finReelle = saison.fin ?? Math.max(...Object.keys(project.chapters).map(n => parseInt(n)).filter(n => n >= saison.debut && !isNaN(n)));
    const allChaps = [];
    for (let i = saison.debut; i <= finReelle; i++) {
      const variants = [String(i)];
      Object.keys(project.chapters).forEach(k => {
        if (k.match(new RegExp(`^${i}[a-zA-Z]$`))) variants.push(k);
      });
      variants.sort((a, b) => a.localeCompare(b));
      const hasLetterVariants = variants.length > 1;
      for (const v of variants) {
        if (hasLetterVariants && v === String(i)) continue;
        const ch = project.chapters[v];
        allChaps.push([v, ch || null]);
      }
    }
    const premiers = ['raws', 'trad'].filter(r => project.roles.includes(r));
    const lines = allChaps.map(([n, ch]) => {
      if (!ch) return `🔄 **Ch.${n}** — en attente : **${premiers.map(r => r.toUpperCase()).join(', ')}**`;
      const available = getAvailableTodos(ch);
      const attente = available.length ? `— en attente : **${available.map(r => r.toUpperCase()).join(', ')}**` : '— terminé !';
      return `${isChapterDone(ch) ? '✅' : '🔄'} **Ch.${n}** ${attente}`;
    }).join('\n');
    if (!lines) return message.reply(`Aucun chapitre pour la saison **${saisonNom}**.`);
    const embed = new EmbedBuilder()
      .setTitle(`📺 ${projectName} — ${saisonNom.toUpperCase() === 'SS' ? 'Side Story' : `Saison ${saisonNom.replace(/^S/i, '')}`} (Ch.${saison.debut}~${saison.fin ?? '?'})`)
      .setDescription(lines + (saison.fin ? `\n\n🏁 **${saisonNom.toUpperCase() === 'SS' ? 'Fin des Side Story' : `Fin de la saison ${saisonNom.replace(/^S/i, '')}`}**` : ''))
      .setColor(0xc9a4ff);
    return message.reply({ embeds: [embed] });
  }

  // ─── !majo <debut>-<fin> <role> ──────────────────────────
  if (lower.startsWith('!majo ')) {
    const parts = content.slice(6).trim().split(' ');
    const range = parts[0];
    const role = parts[1]?.toLowerCase();
    const match = range.match(/^(\d+)-(\d+)$/);
    if (!match || !role) return message.reply('Usage : `!majo 1-140 raws`');
    const start = Number(match[1]);
    const end = Number(match[2]);
    if (end - start > 500) return message.reply('Maximum 500 chapitres à la fois.');
    const data = await loadData();
    const projectName = findProjectByChannel(data, message.channelId);
    if (!projectName) return message.reply('Ce salon n\'est pas lié à un projet.');
    const project = data[projectName];
    for (let i = start; i <= end; i++) {
      const n = String(i);
      if (!project.chapters[n]) {
        project.chapters[n] = {};
        project.roles.forEach(r => project.chapters[n][r] = false);
      }
      if (project.chapters[n][role] !== undefined) {
        const available = getAvailableTodos(project.chapters[n]);
        if (available.includes(role) || project.chapters[n][role] === true) {
          project.chapters[n][role] = true;
        }
      }
    }
    await saveProject(projectName, project);
    return message.reply(`✅ Chapitres ${start} à ${end} — **${role}** marqués comme terminés !`);
  }

// ─── !suppprojet <nom> ───────────────────────────────────
  if (lower.startsWith('!suppprojet ')) {
    const name = content.slice(12).trim();
    const data = await loadData();
    if (!data[name]) return message.reply(`Projet **${name}** introuvable.`);
    await deleteProject(name);
    return message.reply(`✅ Projet **${name}** supprimé.`);
  }

// ─── !desassigner <role> ─────────────────────────────────
  if (lower.startsWith('!desassigner ')) {
    const role = content.slice(13).trim().toLowerCase();
    const data = await loadData();
    const projectName = findProjectByChannel(data, message.channelId);
    if (!projectName) return message.reply('Ce salon n\'est pas lié à un projet.');
    const project = data[projectName];
    const userId = message.author.id;
    if (!project.assignments[userId]) return message.reply('Tu n\'as aucune assignation sur ce projet.');
    project.assignments[userId] = project.assignments[userId].filter(r => r !== role);
    await saveProject(projectName, project);
    return message.reply(`✅ Rôle **${role}** retiré de tes assignations sur **${projectName}**.`);
  }

// ─── !equipe ─────────────────────────────────────────────
  if (lower === '!equipe') {
    const data = await loadData();
    const projectName = findProjectByChannel(data, message.channelId);
    if (!projectName) return message.reply('Ce salon n\'est pas lié à un projet.');
    const project = data[projectName];
    const assignments = project.assignments || {};
    const lines = ROLES_ORDER.filter(r => project.roles.includes(r)).map(r => {
      const membres = Object.entries(assignments)
        .filter(([, roles]) => roles.includes(r))
        .map(([userId]) => `<@${userId}>`)
        .join(', ');
      return `**${r.toUpperCase()}** : ${membres || '*non assigné*'}`;
    }).join('\n');
    const embed = new EmbedBuilder()
      .setTitle(`👥 Équipe — ${projectName}`)
      .setDescription(lines)
      .setColor(0xc9a4ff);
    return message.reply({ embeds: [embed] });
  }

  // ─── !mesprojets ─────────────────────────────────────────
  if (lower === '!mesprojets') {
    const data = await loadData();
    const userId = message.author.id;
    const lines = [];
    for (const [name, project] of Object.entries(data)) {
      const userRoles = project.assignments[userId] || [];
      if (!userRoles.length) continue;
      lines.push(`**${name}** : ${userRoles.join(', ')}`);
    }
    if (!lines.length) return message.reply('Tu n\'es assigné(e) à aucun projet.');
    const embed = new EmbedBuilder()
      .setTitle(`🗂️ Mes projets`)
      .setDescription(lines.join('\n'))
      .setColor(0xc9a4ff);
    return message.reply({ embeds: [embed] });
  }
  });

// ─── !setjour <jour> ─────────────────────────────────────
  if (lower.startsWith('!setjour ')) {
    const jour = content.slice(9).trim().toLowerCase();
    const jours = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
    if (!jours.includes(jour)) return message.reply(`Jour invalide. Utilise : ${jours.join(', ')}`);
    const data = await loadData();
    const projectName = findProjectByChannel(data, message.channelId);
    if (!projectName) return message.reply('Ce salon n\'est pas lié à un projet.');
    const project = data[projectName];
    project.jour = jour;
    await saveProject(projectName, project);
    return message.reply(`✅ Jour de sortie de **${projectName}** défini : **${jour}**`);
  }

  // ─── !ajouterplanning <jour> <projet> ────────────────────
  if (lower.startsWith('!ajouterplanning ')) {
    const parts = content.slice(17).trim().split(' ');
    const jour = parts[0].toLowerCase();
    const projectName = parts.slice(1).join(' ');
    const jours = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
    if (!jours.includes(jour)) return message.reply(`Jour invalide. Utilise : ${jours.join(', ')}`);
    const data = await loadData();
    if (!data[projectName]) return message.reply(`Projet **${projectName}** introuvable.`);
    // Stocker dans un planning temporaire (cette semaine)
    const planningSchema = mongoose.models.Planning || mongoose.model('Planning', new mongoose.Schema({
      semaine: String,
      entries: [{ jour: String, projectName: String }]
    }));
    const now = new Date();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay() + 1);
    const semaine = startOfWeek.toISOString().split('T')[0];
    await planningSchema.findOneAndUpdate(
      { semaine },
      { $push: { entries: { jour, projectName } } },
      { upsert: true }
    );
    return message.reply(`✅ **${projectName}** ajouté au planning du **${jour}** pour cette semaine !`);
  }

  // ─── !planning ───────────────────────────────────────────
  if (lower === '!planning') {
    const data = await loadData();
    const jours = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
    const now = new Date();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay() + 1);
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 6);
    const fmt = d => d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
    // Récupérer le planning temporaire de la semaine
    const planningSchema = mongoose.models.Planning || mongoose.model('Planning', new mongoose.Schema({
      semaine: String,
      entries: [{ jour: String, projectName: String }]
    }));
    const semaine = startOfWeek.toISOString().split('T')[0];
    const planningDoc = await planningSchema.findOne({ semaine });
    const tempEntries = planningDoc?.entries || [];
    // Construire le planning par jour
    const planningByDay = {};
    for (const jour of jours) planningByDay[jour] = [];
    // Projets avec jour fixe
    for (const [name, project] of Object.entries(data)) {
      if (project.jour) planningByDay[project.jour].push(name);
    }
    // Projets ajoutés manuellement cette semaine
    for (const { jour, projectName } of tempEntries) {
      if (!planningByDay[jour].includes(projectName)) planningByDay[jour].push(projectName);
    }
    const lines = [];
    for (const jour of jours) {
      const projets = planningByDay[jour];
      if (!projets.length) continue;
      lines.push(`**${jour.charAt(0).toUpperCase() + jour.slice(1)}**`);
      for (const name of projets) {
        const project = data[name];
        if (!project) continue;
        // Trouver le premier chapitre en cours (ordre numérique)
        const chapEntries = Object.entries(project.chapters)
          .sort(([a], [b]) => {
            const numA = parseFloat(a), numB = parseFloat(b);
            if (numA !== numB) return numA - numB;
            return a.localeCompare(b);
          });
        const firstPending = chapEntries.find(([, ch]) => !isChapterDone(ch));
        if (!firstPending) {
          lines.push(`✅ **${name}** — tout terminé !`);
          continue;
        }
        const [chNum, ch] = firstPending;
        const roleLines = ROLES_ORDER.filter(r => project.roles.includes(r) && ch[r] !== undefined).map(r => {
          const isDone = ch[r] === true;
          const responsables = Object.entries(project.assignments || {})
            .filter(([, roles]) => roles.includes(r))
            .map(([userId]) => `<@${userId}>`)
            .join(', ');
          return `${isDone ? '✅' : '❌'} ${r.toUpperCase()}${responsables ? ` — ${responsables}` : ''}`;
        }).join('\n');
        lines.push(`📖 **${name}** — Ch.${chNum}\n${roleLines}`);
      }
      lines.push('');
    }
    if (!lines.length) return message.reply('Aucun projet dans le planning cette semaine.');
    const embed = new EmbedBuilder()
      .setTitle(`📅 Planning du ${fmt(startOfWeek)} au ${fmt(endOfWeek)}`)
      .setDescription(lines.join('\n'))
      .setColor(0xc9a4ff);
    return message.reply({ embeds: [embed] });
  }

const TOKEN = process.env.DISCORD_TOKEN;
const MONGO_URI = process.env.MONGO_URI;

if (!TOKEN) {
  console.error('❌ DISCORD_TOKEN manquant !');
  process.exit(1);
}
if (!MONGO_URI) {
  console.error('❌ MONGO_URI manquant !');
  process.exit(1);
}

mongoose.connect(MONGO_URI)
  .then(() => {
    console.log('✅ MongoDB connecté !');
    client.login(TOKEN);
  })
  .catch(err => {
    console.error('❌ Erreur MongoDB :', err);
    process.exit(1);
  });

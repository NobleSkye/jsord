console.log('WARNING: You are about to give the script access to your account. \x1b[31mDO USE YOUR MAIN ACCOUNT\x1b[0m')
require('dotenv').config();

const { Client } = require('discord.js-selfbot-v13');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const guilds = [];
const alreadySeen = JSON.parse(fs.readFileSync('cache.json'));
const devFolder = path.join(os.homedir(), 'Documents');
const treeKill = require('tree-kill');

let child;

const client = new Client({
	checkUpdate: false,
});

client.once('ready', user => {
	console.log(`Ready! Logged in as ${user.user.tag}`);

	user.guilds.cache.forEach(guild => {
		if (guild.ownerId === client.user.id) guilds.push(guild.id);

		const projectPath = path.resolve(devFolder, guild.name);

		if (fs.existsSync(projectPath)) return;

		fs.mkdirSync(projectPath);

	});
});

client.on('guildCreate', guild => {
	if (guild.ownerId !== client.user.id) return console.log('[GUILD_CREATE] Joined guild, not owned.');

	let projectPath = path.resolve(devFolder, guild.name);

	if (fs.existsSync(projectPath)) projectPath += '-copy-' + Math.floor(Math.random() * 1000);

	fs.mkdirSync(projectPath);

	console.log(`[GUILD_CREATE] Created project "${guild.name}".`);

	guild.channels.cache.forEach(channel => {
		channel.delete().catch(() => {});
	});

	console.log('[GUILD_CREATE] Purged all channels.');

	guilds.push(guild.id);
});

client.on('guildDelete', guild => {
	if (guild.ownerId !== client.user.id) return console.log('[GUILD_DELETE] Left guild, not owned.');

	fs.rmSync(path.resolve(devFolder, guild.name), { recursive: true, force: true });

	console.log(`[GUILD_DELETE] Deleted project "${guild.name}".`);

	guilds.splice(guilds.indexOf(guild.id), 1);
});

client.on('channelCreate', channel => {
	if (!guilds.includes(channel.guildId)) return console.log('[CHANNEL_CREATE] Channel was created, not owned.');

	if (channel.type === 'GUILD_TEXT') {
		const { fileName, projectPath } = getProps(channel);

		fs.writeFileSync(projectPath, '');

		console.log(`[CHANNEL_CREATE] Created file "${fileName}"`);
	}
	else if (channel.type === 'GUILD_VOICE') {
		if (channel.name.startsWith('Pkgs:')) {
			console.log(`[CHANNEL_CREATE] Set required packages to "${channel.name.slice(5)}"`);

			const options = { cwd: path.resolve(devFolder, channel.guild.name) };
			exec(`cargo install ${channel.name.slice(5)}`, options);
		}
		else {
			const commandToRun = channel.name;

			fs.writeFileSync(path.resolve(devFolder, channel.guild.name, 'main_command.txt'), commandToRun);
			console.log(`[CHANNEL_CREATE] Set main_command to "${commandToRun}"`);
		}
	}
});

client.on('channelUpdate', (oldChannel, newChannel) => {
	if (!guilds.includes(newChannel.guildId)) return console.log('[CHANNEL_UPDATE] Channel was updated, not owned.');

	if (oldChannel.type === 'GUILD_TEXT') {
		const { projectPath, fileName } = getProps(oldChannel);
		const newPath = getProps(newChannel);


		if (fs.existsSync(projectPath)) {
			fs.renameSync(projectPath, newPath.projectPath);

			console.log(`[CHANNEL_UPDATE] Renamed file "${fileName}" to "${newPath.fileName}"`);
		}
	}
	else if (oldChannel.type === 'GUILD_VOICE') {
		const commandToRun = newChannel.name;

		fs.writeFileSync(path.resolve(devFolder, oldChannel.guild.name, 'main_command.txt'), commandToRun);
		console.log(`[CHANNEL_UPDATE] Set main_command to "${commandToRun}"`);
	}
});
client.on('messageCreate', async (message) => {
	if (
		message.channel.type !== 'GUILD_TEXT' ||
		!message?.content?.startsWith('```')
	) return;

	if (alreadySeen.messages.includes(message.id)) return;
	alreadySeen.messages.push(message.id);

	fs.writeFileSync('cache.json', JSON.stringify(alreadySeen));

	handleMessage(message, 'messageCreate');
});
client.on('messageUpdate', async (oldMessage, newMessage) => {
	newMessage = newMessage.channel.messages.fetch(newMessage.id);

	if (oldMessage.content === newMessage.content) return;

	handleMessage(newMessage, 'messageUpdate');
});
client.on('messageDelete', async (message) => {
	handleMessage(message, 'messageDelete');
});

function getProps(channel) {
	const fileName = channel.name.replace(/-/g, '.');
	const projectName = channel.guild.name;
	const projectPath = path.resolve(devFolder, projectName, fileName);

	return { fileName, projectName, projectPath };
}

async function handleMessage(message, reason) {
	console.log(reason);
	const { projectPath, projectName } = getProps(message.channel);

	if (
		!fs.existsSync(projectPath)
	) return;

	// to do: alreadySeen makes it so the message can only be edited once, fix it.

	const messages = await message.channel.messages.fetch({ limit: 100 });

	const allMessages = messages.map(msg => msg.content
		.replace(/```/g, '')?.split('\n')?.splice(1)?.join('\n'),
	).reverse().join('\n');

	fs.writeFileSync(projectPath, allMessages);

	await runCommand(message, path.resolve(devFolder, projectName), reason);
}

async function runCommand(message, folderPath, reason) {
	if (child) {
		treeKill(child.pid, 'SIGTERM', (err) => {
			if (err) {
				console.error('Failed to terminate the child process:', err);
			}
			else {
				console.log('Child process terminated successfully.');
			}
		});
	}

	const commandFilePath = path.resolve(folderPath, 'main_command.txt');
	const command = fs.readFileSync(commandFilePath, 'utf8').trim();

	if (reason === 'messageDelete') return;

	await message?.thread?.delete?.()?.catch?.(() => {});

	const channel = await message.startThread({
		name: 'Output',
		reason: 'Code output.',
	});

	const options = { cwd: folderPath };
	child = exec(command, options);

	child.stdout.on('data', async (data) => {
		console.log({ data });
		channel.send(`\`\`\`\n${data.toString()}\n\`\`\``).catch(() => {});
	});

	child.stderr.on('data', async (data) => {
		console.log({ data });
		channel.send(`\`\`\`\n${data.toString()}\n\`\`\``).catch(() => {});
	});

	child.on('close', (code) => {
		channel.send(`Process exited with code \`${code}\`.`).catch(() => {});
	});
}
client.login('MTEyNDU4ODk5NzUwMzYxNTA3OA.GHfObn.fP2j0nS9TdQXSc7MA3qw4-2RXGOstk2EBD1QNA');

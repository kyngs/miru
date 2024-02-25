import { Client } from 'discord-rpc'
import { ipcMain } from 'electron'
import { debounce } from '@/modules/util.js'

export default class {
  defaultStatus = {
    activity: {
      timestamps: { start: Date.now() },
      details: 'Stream anime torrents, real-time.',
      state: 'Watching anime',
      assets: {
        small_image: 'logo',
        small_text: 'https://github.com/ThaUnknown/miru'
      },
      buttons: [
        {
          label: 'Download app',
          url: 'https://github.com/ThaUnknown/miru/releases/latest'
        }
      ],
      instance: true,
      type: 3
    }
  }

  discord
  allowDiscordDetails
  allowDiscord
  cachedPresence

  /**
   * @param {import('electron').BrowserWindow} window
   */
  constructor (window) {
    ipcMain.on('show-discord-status', (event, data) => {
      this.allowDiscordDetails = data
      this.debouncedDiscordRPC(this.allowDiscordDetails ? this.cachedPresence : undefined)
    })

    ipcMain.on('show-discord', async (event, data) => {
      console.log('show-discord', data)
      this.allowDiscord = data
      this.debouncedDiscordRPC(this.allowDiscord ? this.cachedPresence : undefined)
    });

    ipcMain.on('discord', (event, data) => {
      this.cachedPresence = data
      this.debouncedDiscordRPC(this.allowDiscordDetails ? this.cachedPresence : undefined)
    })

    this.debouncedDiscordRPC = debounce(async status => await this.setDiscordRPC(status), 4500)
    this.allowDiscord = false;
  }

  async loginRPC () {
    if (this.discord) return
    this.discord = new Client({
      transport: 'ipc'
    })

    this.discord.on('ready', async () => {
      await this.setDiscordRPC(this.cachedPresence || this.defaultStatus)
      this.discord.subscribe('ACTIVITY_JOIN_REQUEST')
      this.discord.subscribe('ACTIVITY_JOIN')
      this.discord.subscribe('ACTIVITY_SPECTATE')
    })

    this.discord.on('ACTIVITY_JOIN', ({ secret }) => {
      window.webContents.send('w2glink', secret)
    })

    await this.discord.login({ clientId: '954855428355915797' }).catch(() => {
      setTimeout(() => this.loginRPC(), 5000).unref()
    })
  }

  async disableRPC () {
    if (this.discord) {
      await this.discord.destroy()
      this.discord = null
    }
  }

  async setDiscordRPC (data = this.defaultStatus) {
    if (this.allowDiscord) {
      await this.loginRPC()
    } else {
      await this.disableRPC()
      return
    }

    if (this.discord.user && data) {
      data.pid = process.pid
      this.discord.request('SET_ACTIVITY', data)
    }
  }
}

import {Client} from 'discord-rpc'
import {ipcMain} from 'electron'

export default class {
  window
  status
  discord
  requestedAllowDiscordDetails
  allowDiscordDetails
  requestedAllowRPC
  allowRPC
  rpcStarted
  cachedPresence

  /**
   * @param {import('electron').BrowserWindow} window
   */
  constructor(window) {
    this.window = window
    this.allowRPC = false;

    ipcMain.on('discord_status', (event, data) => {
      this.requestedAllowDiscordDetails = data
      if (!this.rpcStarted) {
        this.handleRPC()
        setInterval(this.handleRPC.bind(this), 5000) // According to Discord documentation, clients can only update their presence 5 times per 20 seconds. We will add an extra second to be safe.
        this.rpcStarted = true
      }
    })

    ipcMain.on('discord_enabled', (event, enable) => {
      this.requestedAllowRPC = enable
    })

    ipcMain.on('discord', (event, data) => {
      this.cachedPresence = data
      if (this.allowDiscordDetails) {
        this.setDiscordRPC(data)
      }
    })
  }

  async disableRPC() {
    if (this.discord) {
      await this.discord.destroy()
      this.discord = null
    }
  }

  async loginRPC() {
    await this.disableRPC()

    this.discord = new Client({
      transport: 'ipc'
    })

    this.discord.on('ready', async () => {
      this.discord.subscribe('ACTIVITY_JOIN_REQUEST')
      this.discord.subscribe('ACTIVITY_JOIN')
      this.discord.subscribe('ACTIVITY_SPECTATE')
    })
    this.discord.on('ACTIVITY_JOIN', ({ secret }) => {
      this.window.webContents.send('w2glink', secret)
    })

    await this.discord.login({clientId: '954855428355915797'}).catch(() => {
      setTimeout(this.loginRPC.bind(this), 5000).unref()
    })
  }

  setDiscordRPC(data = {
    activity: {
      timestamps: {
        start: Date.now()
      },
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
  }) {
    this.status = data
    if (this.discord && this.discord.user && this.status) {
      this.status.pid = process.pid
      this.discord.request('SET_ACTIVITY', this.status)
    }
  }

  async handleRPC() {
    if (this.allowRPC !== this.requestedAllowRPC) {
      this.allowRPC = this.requestedAllowRPC
      if (this.allowRPC) {
        await this.loginRPC()
      } else {
        await this.disableRPC()
      }
    }

    this.allowDiscordDetails = this.requestedAllowDiscordDetails
    if (!this.allowDiscordDetails) {
      this.setDiscordRPC()
    } else if (this.cachedPresence) {
      this.setDiscordRPC(this.cachedPresence)
    }
  }
}
